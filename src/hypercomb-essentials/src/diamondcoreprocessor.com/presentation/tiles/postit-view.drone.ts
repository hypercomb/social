// Post-it — a VIEWER. The tile is an asset; the post-it is its presence.
//
// A cell carrying `visual:postit:note` does not render as a hexagon at all
// (`replacesTileRender` — the hex renderer drops the label). Instead:
//
//   1. STICKIES (hexagons mode): every post-it on the current layer — the
//      cell you are standing at plus its children — is a small sticky note
//      docked top-left. The sticky IS the cell on screen: it shows the
//      note's title and is the only ordinary way in. It never intercepts
//      the canvas (pointer events live on the notes alone).
//
//   2. THE POST (postit view): opening a sticky (or the tile's view-enter
//      icon) mounts the cell's CONTENT full-viewport. The viewer is
//      content-agnostic: a payload `htmlSig` mounts that resource in a
//      shadow root with its <script>s re-executed (HTML, Pixi, three.js —
//      whatever the page carries); a `text` payload renders as one large
//      sticky; with neither, the tile's own image shows. Escape / × returns
//      to the hexagons.

import { Drone, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { hasDecorationKindAt, titleForLabel } from '../../commands/decoration-kind-index.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { isKindGloballyOff } from '../../sharing/behavior-enablement.js'
import { listDecorations, replaceDecoration } from '../../commands/decoration-manifest.js'
import { rewritePageRefs } from '../../sharing/decoration-closure.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../history/layer-placement.js'
import { POSTIT_KIND, POSTIT_VIEW, type PostitPayload } from '../../commands/postit.queen.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
const SIG_RE = /^[0-9a-f]{64}$/
type StoreShape = { getResource(sig: string): Promise<Blob | null> }

const STICKY_LIMIT = 5

export class PostitViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Post-it renderer — small stickies for decorated tiles on the current layer; opening one mounts its page full-viewport.'

  #stickies: HTMLElement | null = null
  #post: HTMLElement | null = null
  #targetSegments: string[] | null = null
  #bound = false
  #active = false
  /** Re-entrancy generation for both reconcilers — latest wins. */
  #gen = 0
  /** A sticky is mid-drag: reconciles hold off so the node under the pointer
   *  is never torn down (the drop's own decoration write reconciles after). */
  #dragging = false
  /** The pointer gesture that just ended MOVED — the click that follows it
   *  must not open the post. Cleared on the next pointerdown. */
  #justDragged = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      window.addEventListener('synchronize', this.#change)
      this.onEffect('decorations:changed', this.#change)
      // Cold session: the mark is discovered by the post-paint hydration walk,
      // which fires no decorations:changed — without this the stickies wait
      // for the next synchronize (first pan/zoom) to appear.
      this.onEffect('takeover:indexed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== POSTIT_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(POSTIT_VIEW)
        void this.#reconcile()
      })
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.removeEventListener('keydown', this.#key, true)
    window.removeEventListener('synchronize', this.#change)
    this.#stickies?.remove()
    this.#stickies = null
    this.#teardownPost()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== POSTIT_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#vm()?.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    if (this.#dragging) return
    const gen = ++this.#gen
    const mode = this.#vm()?.mode
    if (mode === POSTIT_VIEW) {
      this.#stickies?.remove()
      this.#stickies = null
      await this.#mountPost(gen)
      return
    }
    this.#targetSegments = null
    this.#teardownPost()
    if (mode === 'hexagons') await this.#renderStickies(gen)
    else { this.#stickies?.remove(); this.#stickies = null }
  }

  // ── Surface 1: the small stickies ────────────────────────────────────

  async #renderStickies(gen: number): Promise<void> {
    if (isKindGloballyOff(POSTIT_KIND)) { this.#stickies?.remove(); this.#stickies = null; return }
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const segments = [...(lineage?.explorerSegments?.() ?? [])]

    // Candidates: the cell we stand AT, then its children in layer order.
    const candidates: Array<{ label: string; path: string[] }> = []
    const own = segments.at(-1)
    if (own) candidates.push({ label: own, path: [...segments] })
    if (history) {
      try {
        const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
        if (layer) {
          for (const label of await childNamesOf(history as unknown as PlacementHistory, layer as unknown as PlacementLayer)) {
            candidates.push({ label, path: [...segments, label] })
          }
        }
      } catch { /* no layer here — root of an empty hive */ }
    }
    if (gen !== this.#gen) return

    const decorated: Array<{ label: string; path: string[]; payload?: PostitPayload }> = []
    for (const candidate of candidates) {
      // Path-keyed lookup: a bare label resolves against the CURRENT page, so
      // for the standing cell it would name the phantom child `…/own/own` and
      // its sticky would never show.
      if (!hasDecorationKindAt(candidate.path, POSTIT_KIND)) continue
      if (await isFeatureHidden(candidate.path, POSTIT_KIND)) continue
      // The payload rides along for the PIN — where the participant dragged
      // this note. Read only for cells that passed the gates above.
      const records = await listDecorations<PostitPayload>({ kind: POSTIT_KIND, segments: candidate.path })
      decorated.push({ ...candidate, payload: records.at(-1)?.record.payload })
      if (decorated.length >= STICKY_LIMIT) break
    }
    if (gen !== this.#gen) return

    if (!decorated.length) { this.#stickies?.remove(); this.#stickies = null; return }

    const host = document.createElement('aside')
    host.className = 'hc-postit-stickies'
    host.innerHTML = `<style>${STICKY_CSS}</style>`
    decorated.forEach((cell, index) => {
      const note = document.createElement('button')
      note.type = 'button'
      note.className = 'postit-sticky'
      note.style.setProperty('--postit-tilt', `${index % 2 ? 1.6 : -2.2}deg`)
      const title = titleForLabel(cell.label, navigator.language) || cell.label
      note.title = `Open the post-it on "${title}"`
      const heading = document.createElement('span')
      heading.className = 'postit-sticky-title'
      heading.textContent = title
      const cue = document.createElement('span')
      cue.className = 'postit-sticky-cue'
      cue.textContent = 'open ›'
      note.append(heading, cue)
      // A PINNED note sits where it was dropped — viewport fractions from the
      // payload, clamped so a resize can never strand it out of reach. No pin
      // = the docked column, exactly as before.
      const pin = cell.payload?.pin
      if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) {
        note.classList.add('postit-pinned')
        const w = window.innerWidth, h = window.innerHeight
        note.style.left = `${Math.min(Math.max(0, pin.x * w), Math.max(0, w - 72))}px`
        note.style.top = `${Math.min(Math.max(0, pin.y * h), Math.max(0, h - 48))}px`
      }
      note.onclick = () => {
        // The click that tails a drag gesture is the drop, not an open.
        // Consume the flag here too — a later KEYBOARD activation fires no
        // pointerdown, so parking the reset there alone would deaden it.
        if (this.#justDragged) { this.#justDragged = false; return }
        this.#targetSegments = cell.path
        this.#vm()?.setMode(POSTIT_VIEW)
        void this.#reconcile()
      }
      this.#wireDrag(note, cell)
      host.append(note)
    })
    this.#stickies?.remove()
    this.#stickies = host
    document.body.appendChild(host)
  }

  // ── Dragging: pick a sticky up, and it stays where you leave it ──────
  //
  // The pin is PART OF THE NOTE (payload `pin`, viewport fractions), not
  // shell state: it survives reloads, travels with the tile to whoever
  // adopts it, and undoes like any other layer edit. A sub-threshold press
  // stays a click (open); pointer capture keeps the gesture on the note so
  // the canvas underneath never sees it.

  #wireDrag(note: HTMLButtonElement, cell: { label: string; path: string[]; payload?: PostitPayload }): void {
    note.addEventListener('pointerdown', down => {
      if (down.pointerType === 'mouse' && down.button !== 0) return
      this.#justDragged = false
      const from = note.getBoundingClientRect()
      const sx = down.clientX, sy = down.clientY
      let moved = false
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy
        if (!moved) {
          if (Math.hypot(dx, dy) < 5) return
          moved = true
          this.#dragging = true
          // Capture keeps the gesture on the note even at speed; a pointer
          // that has already retired throws here, and the drag works anyway.
          try { note.setPointerCapture(down.pointerId) } catch { /* retired pointer */ }
          note.classList.add('postit-dragging')
        }
        note.style.position = 'fixed'
        note.style.left = `${from.x + dx}px`
        note.style.top = `${from.y + dy}px`
        ev.preventDefault()
      }
      const done = (ev: PointerEvent): void => {
        note.removeEventListener('pointermove', move)
        note.removeEventListener('pointerup', done)
        note.removeEventListener('pointercancel', done)
        if (!moved) return
        this.#dragging = false
        this.#justDragged = true
        note.classList.remove('postit-dragging')
        if (ev.type === 'pointercancel') { void this.#reconcile(); return }
        const rect = note.getBoundingClientRect()
        void this.#persistPin(cell, rect.x, rect.y)
      }
      note.addEventListener('pointermove', move)
      note.addEventListener('pointerup', done)
      note.addEventListener('pointercancel', done)
    })
  }

  /** Write the drop position into the note's decoration payload — the same
   *  replace-one-live-record path `/postit here` uses, so a pin is one
   *  ordinary layer edit and the reconcile that follows re-renders the
   *  sticky already pinned. On a failed write, reconcile snaps it back to
   *  the last committed truth rather than leaving a lie on screen. */
  async #persistPin(cell: { path: string[] }, left: number, top: number): Promise<void> {
    const w = window.innerWidth, h = window.innerHeight
    // A collapsed viewport (hidden tab, mid-rotation) would mint a garbage
    // fraction and teleport the note on the next real render — drop the
    // write and let reconcile snap back to the last committed spot.
    if (w < 50 || h < 50) { void this.#reconcile(); return }
    const pin = {
      x: Math.min(1, Math.max(0, left / w)),
      y: Math.min(1, Math.max(0, top / h)),
    }
    try {
      const prior = (await listDecorations<PostitPayload>({ kind: POSTIT_KIND, segments: cell.path }))
        .at(-1)?.record.payload
      await replaceDecoration({
        kind: POSTIT_KIND,
        appliesTo: cell.path,
        segments: cell.path,
        payload: { ...(prior ?? { version: 1 }), pin },
        mark: 'persistent',
      })
    } catch { void this.#reconcile() }
  }

  // ── Surface 2: the opened post ───────────────────────────────────────

  async #mountPost(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    if (await isFeatureHidden(segments, POSTIT_KIND)) {
      // OFF means the ordinary hive owns the surface (see living-brief).
      this.#targetSegments = null
      this.#teardownPost()
      this.#vm()?.setMode('hexagons')
      return
    }
    const records = await listDecorations<PostitPayload>({ kind: POSTIT_KIND, segments })
    if (gen !== this.#gen || this.#vm()?.mode !== POSTIT_VIEW) return
    // Newest record wins — the slot appends, so the live one is last.
    const payload = records.at(-1)?.record.payload
    const label = segments.at(-1) ?? ''
    const title = payload?.title
      || (label ? titleForLabel(label, navigator.language) || label : 'Post-it')

    this.#teardownPost()
    const host = document.createElement('section')
    host.className = 'hc-postit-view'
    host.innerHTML = `<style>${POST_CSS}</style>`

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'postit-close'
    close.setAttribute('aria-label', 'Return to hexagons')
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')

    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    if (payload?.htmlSig) {
      const blob = await store?.getResource(payload.htmlSig)
      if (gen !== this.#gen || this.#vm()?.mode !== POSTIT_VIEW) { host.remove(); return }
      const paper = document.createElement('article')
      paper.className = 'postit-page'
      // Shadow root: the page is a standalone artifact — its CSS stays its
      // own, the shell's never reaches in, and `resource:` refs resolve
      // through the same document interception the site view relies on.
      const shadow = paper.attachShadow({ mode: 'open' })
      shadow.innerHTML = blob
        ? rewritePageRefs(await blob.text(), RESOURCE_URL_PREFIX)
        : '<p style="padding:2rem;font-family:system-ui">This post-it\'s page has not arrived yet.</p>'
      // The viewer is content-agnostic — a page may carry behaviour (Pixi,
      // three.js, plain JS). innerHTML never executes <script>, so re-create
      // each one in place; a created script element runs on connection (the
      // same trick the site view uses on inline mounts).
      shadow.querySelectorAll('script').forEach(inert => {
        const live = document.createElement('script')
        for (const attr of Array.from(inert.attributes)) live.setAttribute(attr.name, attr.value)
        live.textContent = inert.textContent
        inert.replaceWith(live)
      })
      host.append(paper)
    } else if (payload?.text) {
      const note = document.createElement('article')
      note.className = 'postit-paper'
      const heading = document.createElement('h1')
      heading.textContent = title
      const body = document.createElement('p')
      body.textContent = payload.text
      note.append(heading, body)
      host.append(note)
    } else {
      // No authored content — the tile's own image IS the asset to show.
      const imageSig = await this.#tileImageSig(segments)
      if (gen !== this.#gen || this.#vm()?.mode !== POSTIT_VIEW) { host.remove(); return }
      const frame = document.createElement('article')
      frame.className = 'postit-image'
      if (imageSig) {
        const img = document.createElement('img')
        img.src = RESOURCE_URL_PREFIX + imageSig
        img.alt = title
        frame.append(img)
      } else {
        const note = document.createElement('p')
        note.className = 'postit-empty'
        note.textContent = 'Nothing on this post-it yet — `/postit here <text>` writes it.'
        frame.append(note)
      }
      host.append(frame)
    }

    host.append(close)
    document.body.appendChild(host)
    this.#post = host
    this.#setActive(true)
  }

  /** The tile's own picture, resolved from its `properties` slot — the
   *  asset the viewer falls back to when the post-it carries no page/text. */
  async #tileImageSig(segments: readonly string[]): Promise<string | null> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    if (!history || !store) return null
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
      const propsSig = Array.isArray((layer as { properties?: unknown })?.properties)
        ? String(((layer as { properties?: unknown[] }).properties as unknown[])[0] ?? '')
        : ''
      if (!SIG_RE.test(propsSig)) return null
      const blob = await store.getResource(propsSig)
      if (!blob) return null
      const props = JSON.parse(await blob.text()) as { small?: { image?: string } }
      const imageSig = String(props?.small?.image ?? '')
      return SIG_RE.test(imageSig) ? imageSig : null
    } catch { return null }
  }

  #teardownPost(): void {
    this.#post?.remove()
    this.#post = null
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'postit-view')
    else modes?.exit('view:active', 'postit-view')
  }
}

// Sticky yellows deliberately read as PAPER pinned over the hive, not as
// chrome — the one warm object in a cold shell. No text lives in tile art;
// the sticky is DOM and carries the note's title.
//
// z 59990: the reparented Pixi canvas (#pixi-host, pixi-host.worker.ts) sits
// at z 59989 with a pointer-events:auto <canvas> — anything below it still
// PAINTS (the canvas is transparent) but has every click eaten. 59990 is the
// established "above canvas, below chrome" slab (activity log, format
// painter). Top rides --hc-header-anchor so header zoom or a wrapped icon
// rail pushes the stack down instead of over it (never a bare rem — see
// _header-size.scss). Left adds --hc-controls-left, the side-docked control
// bar's edge reservation (the anchor every docked panel lays out against) —
// without it the column sits under the bar, which is chrome at 59999.
const STICKY_CSS = `
.hc-postit-stickies{position:fixed;left:calc(0.9rem + var(--hc-controls-left,0px) + var(--hc-inset-left,0px) + env(safe-area-inset-left,0px));top:calc(var(--hc-header-anchor,3.5rem) + 1rem);z-index:59990;display:flex;flex-direction:column;gap:.55rem;pointer-events:none}
.postit-sticky{pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;width:8.5rem;min-height:4.6rem;padding:.6rem .65rem .95rem;border:0;text-align:left;cursor:pointer;background:linear-gradient(178deg,#fef9c3 0%,#fde68a 100%);color:#4a3f0f;box-shadow:0 6px 14px rgba(0,0,0,.35),inset 0 -1.4rem 1rem -1.2rem rgba(120,90,10,.18);transform:rotate(var(--postit-tilt,-2deg));transition:transform .14s ease,box-shadow .14s ease;font-family:'Segoe Print','Comic Sans MS',cursive,system-ui}
.postit-sticky.postit-pinned{position:fixed}
.postit-sticky.postit-dragging{transform:rotate(0deg) scale(1.05);box-shadow:0 16px 30px rgba(0,0,0,.5);cursor:grabbing;transition:none}
.postit-sticky::before{content:'';position:absolute;top:-.34rem;left:50%;width:2.2rem;height:.7rem;transform:translateX(-50%) rotate(-1deg);background:rgba(255,255,255,.45);border:1px solid rgba(0,0,0,.07)}
.postit-sticky{position:relative}
.postit-sticky:hover{transform:rotate(0deg) scale(1.04);box-shadow:0 10px 20px rgba(0,0,0,.42)}
.postit-sticky-title{display:block;font-size:.8rem;font-weight:700;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.postit-sticky-cue{position:absolute;right:.55rem;bottom:.3rem;font-size:.62rem;opacity:.55}
@media(max-width:640px){.postit-sticky{width:7rem;min-height:4rem}}
`

// z 59992: above the canvas (59989) and its riders (activity log 59990,
// preview banner / atomizer sidebar 59991), below edit-actions (59995) and
// the header (60000). At the old 150 the mounted page painted through the
// transparent canvas but every click and scroll inside it hit the canvas.
const POST_CSS = `
.hc-postit-view{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:59992;overflow:auto;background:#101418}
.postit-page{min-height:100%;background:#fff}
.postit-paper{box-sizing:border-box;width:min(680px,calc(100% - 2rem));margin:8vh auto;padding:3.2rem 3rem 4.4rem;background:linear-gradient(178deg,#fef9c3 0%,#fde68a 100%);color:#3f350c;box-shadow:0 22px 60px rgba(0,0,0,.5),inset 0 -2.5rem 2rem -2rem rgba(120,90,10,.16);transform:rotate(-.6deg);font-family:'Segoe Print','Comic Sans MS',cursive,system-ui}
.postit-paper h1{margin:0 0 1.2rem;font-size:1.6rem;line-height:1.25}
.postit-paper p{margin:0;font-size:1.08rem;line-height:1.75;white-space:pre-wrap}
.postit-image{min-height:100%;display:flex;align-items:center;justify-content:center;padding:2rem;box-sizing:border-box}
.postit-image img{max-width:min(94vw,1100px);max-height:88vh;box-shadow:0 22px 60px rgba(0,0,0,.55)}
.postit-empty{color:#8fa3b3;font-family:system-ui;font-size:1rem}
.postit-close{position:fixed;z-index:2147483600;right:calc(0.75rem + env(safe-area-inset-right,0px));top:calc(0.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(12,17,24,.82);border:1px solid rgba(126,182,214,.42);backdrop-filter:blur(6px);color:#cfe2ee;cursor:pointer;font:1.3rem/1 serif;padding:0;opacity:.55;transition:opacity .16s ease}
.postit-close:hover{opacity:1}
`

const _postitView = new PostitViewDrone()
window.ioc.register('@diamondcoreprocessor.com/PostitViewDrone', _postitView)

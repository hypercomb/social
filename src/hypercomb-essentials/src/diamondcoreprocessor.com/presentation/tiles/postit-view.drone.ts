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
import { isBehaviorDormant, isPublishedVisitorShell, ENABLEMENT_CHANGED } from '../../sharing/behavior-enablement.js'
import { listDecorations, replaceDecoration } from '../../commands/decoration-manifest.js'
import { rewritePageRefs } from '../../sharing/decoration-closure.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../history/layer-placement.js'
import { readTilePropertiesAt, tilePictureCandidates } from '../../editor/tile-properties.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'
import { trackScrollGutter } from './scroll-gutter.js'
import { POSTIT_KIND, POSTIT_VIEW, POSTIT_SIZE_KEY, type PostitPayload } from '../../commands/postit.queen.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'

/** This drone's name in the owner-counted `view:active` mode. */
const POSTIT_OWNER = 'postit-view'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
const SIG_RE = /^[0-9a-f]{64}$/
type StoreShape = {
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}

const STICKY_LIMIT = 5

/** A stored pin fraction, held to where a corner of the note is still
 *  grabbable inside a box of `span` px. `out` is how far past the near edge
 *  the note may hang, `keep` how much must stay inside the far one. Returns
 *  a fraction, so the caller stays in percentages of the box and never
 *  converts back to viewport pixels. */
function clampFraction(fraction: number, span: number, out: number, keep: number): number {
  const size = Math.max(1, span)
  return Math.min(Math.max(-out / size, fraction), Math.max(0, (size - keep) / size))
}

/** Smallest a sticky may be dragged to — below this the title has nowhere to
 *  live and the grip starts to eat the note. */
const STICKY_MIN = { w: 84, h: 64 }

/** The size the participant last dragged a sticky to, which becomes the
 *  default for every note that carries no size of its own. A malformed or
 *  absent value reads as "no preference" so the CSS default stands. */
function lastChosenSize(): { w: number; h: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(POSTIT_SIZE_KEY) ?? 'null') as { w?: unknown; h?: unknown } | null
    const w = Number(raw?.w), h = Number(raw?.h)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null
    return { w: Math.max(STICKY_MIN.w, w), h: Math.max(STICKY_MIN.h, h) }
  } catch { return null }
}

export class PostitViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Post-it renderer — small stickies for decorated tiles on the current layer; opening one mounts its page full-viewport.'

  #stickies: HTMLElement | null = null
  #noteByKey = new Map<string, HTMLButtonElement>()
  #post: HTMLElement | null = null
  /** Stops the scrollbar-width tracker that keeps the × clear of the post's
   *  own scrollbar (scroll-gutter.ts). */
  #gutterOff: (() => void) | null = null
  #targetSegments: string[] | null = null
  #bound = false
  #active = false
  /** Re-entrancy generation for both reconcilers — latest wins. */
  #gen = 0
  /** A sticky is mid-drag: reconciles hold off so the node under the pointer
   *  is never torn down (the drop's own decoration write reconciles after). */
  #dragging = false
  /** A pin write is in flight. `replaceDecoration` is removeSig THEN append,
   *  and a reconcile landing in that gap reads a cell with NO post-it: the
   *  column tore itself down and rebuilt fresh nodes a beat later, which is
   *  what threw a just-dropped note back to the dock until the next pass. */
  #writing = false
  /** The pointer gesture that just ended MOVED — the click that follows it
   *  must not open the post. Cleared on the next pointerdown. */
  #justDragged = false
  /** Unregisters the right-click way out (back-gesture.service.ts). */
  #backOff: (() => void) | null = null
  /** A COVERING surface is up — any owner of `view:active` other than this
   *  drone itself. The stickies deliberately sit above the docked toolwindow
   *  layer so a note dropped over a side panel stays grabbable, and that same
   *  z-index left them floating over anything full-screen. Covered is a
   *  VISIBILITY flag, not a teardown: the notes (and an opened post) keep
   *  their nodes and come back exactly as they were. */
  #covered = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      // Navigation changes which location a bare on-screen sticky belongs to.
      // Reconcile on the navigation event itself so the generation advances
      // immediately: otherwise an async render from the previous layer can
      // finish after the move, leave its stale sticky on the glass, and a
      // click opens that old path in post-it mode before the destination's
      // synchronize pass gets a chance to draw its real note.
      window.addEventListener('navigate', this.#navigate)
      window.addEventListener('synchronize', this.#change)
      this.onEffect('decorations:changed', this.#change)
      // Cold session: the mark is discovered by the post-paint hydration walk,
      // which fires no decorations:changed — without this the stickies wait
      // for the next synchronize (first pan/zoom) to appear.
      this.onEffect('takeover:indexed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      // The roster switch writes localStorage and emits — nothing else. Without
      // this the stickies stayed on screen after the behavior was switched off
      // (and stayed missing after it was switched back on) until some unrelated
      // pass happened to reconcile.
      this.onEffect(ENABLEMENT_CHANGED, this.#change)
      // WHO HAS THE SURFACE, asked of the one registry that knows. This used
      // to read `chat:window-state` — the chat window by name — which was
      // right about the only cover that existed and wrong in two ways since:
      // it could not see any OTHER full-screen surface, and it could not see
      // the chat window FOLDED AWAY (peek), where the whole point is that the
      // hive underneath is live and its post-its belong on screen.
      //
      // `view:active` answers both. It is owner-counted, so a closing overlay
      // can never uncover a still-open one; and it is re-read from the
      // registry rather than taken from the payload, because the payload
      // names only the owner that caused the transition. This drone's OWN
      // owner is excluded: the post-it view holds `view:active` while it is
      // showing, and hiding the surface it just opened is exactly backwards.
      this.onEffect('view:active', () => this.#recheckCover())
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== POSTIT_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(POSTIT_VIEW)
        void this.#reconcile()
      })
      // Right-click closes the post the same way its × does.
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: 'postit-view', back: () => {
          if (this.#sealedOpen()) return   // publish mode: nothing to go back to
          this.#vm()?.setMode('hexagons')
        } }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.removeEventListener('keydown', this.#key, true)
    window.removeEventListener('navigate', this.#navigate)
    window.removeEventListener('synchronize', this.#change)
    this.#backOff?.()
    this.#backOff = null
    this.#stickies?.remove()
    this.#stickies = null
    this.#teardownPost()
  }

  #changeTimer = 0
  readonly #navigate = (): void => {
    // Do not leave the old layer interactive during the trailing/coalesced
    // read. Advancing the generation cancels any in-flight render, and taking
    // its host off the glass closes the stale-click window synchronously.
    ++this.#gen
    if (this.#vm()?.mode === 'hexagons') {
      this.#stickies?.remove()
      this.#stickies = null
    }
    this.#change()
  }
  readonly #change = (): void => {
    // Coalesce event bursts into ONE trailing pass. replaceDecoration lands
    // as removeSig THEN append: reconciling on the removeSig half saw no
    // decorated cells, so every pin drop tore the column down and rebuilt
    // it a beat later — a visible blink, on a node that could also read the
    // mid-write record. Sixty ms trailing reads settled state instead.
    clearTimeout(this.#changeTimer)
    this.#changeTimer = window.setTimeout(() => { void this.#reconcile() }, 60)
  }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== POSTIT_VIEW) return
    if (this.#sealedOpen()) return   // publish mode: the page IS the site
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#vm()?.setMode('hexagons')
  }

  /** True when the mounted post is a published site's ROOT surface. There is
   *  no hive behind it for a visitor — no ×, no Escape, no back gesture: the
   *  page is the whole experience, exactly what the publisher deployed. */
  #sealedOpen(): boolean {
    if (!isPublishedVisitorShell()) return false
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    return segments.length <= 1
  }

  /** Show or hide both surfaces for the covering window. `display` rather
   *  than a teardown: the opened post keeps its scroll position and its
   *  mounted page (a shadow root with live scripts), so closing the chat
   *  brings back what was there instead of remounting it. */
  /** Re-read the cover from the registry and repaint if it moved. */
  #recheckCover(): void {
    const modes = window.ioc?.get<{ ownersOf(mode: string): readonly string[] }>(
      '@diamondcoreprocessor.com/ModeRegistry')
    const covered = (modes?.ownersOf('view:active') ?? []).some(owner => owner !== POSTIT_OWNER)
    if (covered === this.#covered) return
    this.#covered = covered
    this.#applyCover()
  }

  #applyCover(): void {
    for (const surface of [this.#stickies, this.#post]) {
      if (surface) surface.style.display = this.#covered ? 'none' : ''
    }
  }

  /** The sticky box's own geometry. Every position on this surface — the
   *  docked column's flow spot and a pinned note's fractions alike — is
   *  measured INSIDE this box, so the box is the only thing that has to
   *  know where the free area is. */
  #boxSize(): { w: number; h: number } {
    const rect = this.#stickies?.getBoundingClientRect()
    return { w: rect?.width ?? window.innerWidth, h: rect?.height ?? window.innerHeight }
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }


  async #reconcile(): Promise<void> {
    if (this.#dragging || this.#writing) return
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
    // A pass that mints FRESH nodes mints them visible, so the cover has to be
    // re-stated over them — otherwise any reconcile while a surface is up
    // (a synchronize, a decoration landing) puts the stickies back on top of
    // it. Re-read first: this is also how a cold mount under an already-open
    // surface learns it is covered.
    this.#recheckCover()
    this.#applyCover()
  }

  // ── Surface 1: the small stickies ────────────────────────────────────

  async #renderStickies(gen: number): Promise<void> {
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
      // Dormancy is PER CELL, not global: a global off can be overridden by a
      // wake here, and an adopted root can carry the publisher's withheld mark.
      // (This was a bare global-off check, which read neither.)
      if (isBehaviorDormant(POSTIT_KIND, candidate.path)) continue
      if (await isFeatureHidden(candidate.path, POSTIT_KIND)) continue
      // The payload rides along for the PIN — where the participant dragged
      // this note. Read only for cells that passed the gates above.
      const records = await listDecorations<PostitPayload>({ kind: POSTIT_KIND, segments: candidate.path })
      decorated.push({ ...candidate, payload: records.at(-1)?.record.payload })
      if (decorated.length >= STICKY_LIMIT) break
    }
    if (gen !== this.#gen) return

    if (!decorated.length) { this.#stickies?.remove(); this.#stickies = null; return }

    // KEYED, IN-PLACE update — the column is long-lived. Tearing every note
    // down each pass (every synchronize) reset hover/settle transitions and
    // made a drop land as a node swap mid-settle — the "clips into place"
    // pop. Reusing the node by cell path keeps the paper continuous on
    // screen; a re-render is a ≤1px nudge, not a rebuild.
    let host = this.#stickies
    if (!host) {
      host = document.createElement('aside')
      host.className = 'hc-postit-stickies'
      host.innerHTML = `<style>${STICKY_CSS}</style>`
      document.body.appendChild(host)
      this.#stickies = host
      this.#applyCover()
    }
    const keep = new Set<string>()
    decorated.forEach((cell, index) => {
      // NUL join — the one character a tile name can never carry (same
      // convention as the decoration index's location keys).
      const key = cell.path.join('\u0000')
      keep.add(key)
      let note = this.#noteByKey.get(key)
      if (!note || !note.isConnected) {
        note = document.createElement('button')
        note.type = 'button'
        note.className = 'postit-sticky'
        this.#noteByKey.set(key, note)
        // The note is a SMALL STACK: a second sheet peeking out behind
        // (the button's ::before), the written face on top, and a pink
        // pushpin holding the pair to the glass.
        const face = document.createElement('span')
        face.className = 'postit-face'
        const heading = document.createElement('span')
        heading.className = 'postit-sticky-title'
        const cue = document.createElement('span')
        cue.className = 'postit-sticky-cue'
        cue.textContent = 'open ›'
        face.append(heading, cue)
        const pin = document.createElement('span')
        pin.className = 'postit-pin'
        pin.setAttribute('aria-hidden', 'true')
        // The bottom-right grip — the corner of the paper you pull. Its own
        // gesture, so grabbing it resizes instead of moving the note.
        const grip = document.createElement('span')
        grip.className = 'postit-grip'
        grip.setAttribute('aria-hidden', 'true')
        note.append(face, pin, grip)
        this.#wireDrag(note, cell)
        this.#wireResize(note, grip, cell)
        host.append(note)
      }
      note.style.setProperty('--postit-tilt', `${index % 2 ? 1.6 : -2.2}deg`)
      // The note's OWN size wins; otherwise the size this participant last
      // pulled a sticky to; otherwise the CSS default.
      const size = cell.payload?.size ?? lastChosenSize()
      if (size && Number.isFinite(size.w) && Number.isFinite(size.h)) {
        note.style.width = `${Math.max(STICKY_MIN.w, size.w)}px`
        note.style.height = `${Math.max(STICKY_MIN.h, size.h)}px`
      } else {
        note.style.width = ''
        note.style.height = ''
      }
      const title = titleForLabel(cell.label, navigator.language) || cell.label
      note.title = `Open the post-it on "${title}"`
      const heading = note.querySelector('.postit-sticky-title')
      if (heading && heading.textContent !== title) heading.textContent = title
      // A PINNED note sits where it was dropped — viewport fractions from
      // the payload, applied EXACTLY. The only clamp is a rescue: keep a
      // grabbable corner inside the viewport so a resize can never strand
      // the note out of reach. No pin = the docked column.
      const pin = cell.payload?.pin
      if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) {
        note.classList.add('postit-pinned')
        // A PIN IS A FRACTION OF THE BOX — percentages, absolute inside the
        // host. Nothing here knows about toolwindows: the box is already the
        // free area, so a panel coming in from the left moves the note the
        // same way it moves the tiles, with no listener and no second sum.
        // The only clamp is a rescue: keep a grabbable corner in reach.
        const box = this.#boxSize()
        note.style.left = `${clampFraction(pin.x, box.w, 112, 24) * 100}%`
        note.style.top = `${clampFraction(pin.y, box.h, 56, 24) * 100}%`
      } else {
        note.classList.remove('postit-pinned')
        note.style.left = ''
        note.style.top = ''
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
    })
    for (const [key, note] of this.#noteByKey) {
      if (keep.has(key)) continue
      note.remove()
      this.#noteByKey.delete(key)
    }
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
      // The note's LAYOUT position, transform-free and BOX-RELATIVE:
      // offsetLeft/Top against the host (its offsetParent, positioned) reads
      // the docked note's flex spot and the pinned note's own percentage
      // alike — a bounding rect would be the tilted box's AABB, a few px off.
      // The drop lands at base + pointer delta, exactly under the hand.
      const baseLeft = note.offsetLeft
      const baseTop = note.offsetTop
      const sx = down.clientX, sy = down.clientY
      let dx = 0, dy = 0
      let moved = false
      const move = (ev: PointerEvent): void => {
        dx = ev.clientX - sx; dy = ev.clientY - sy
        if (!moved) {
          if (Math.hypot(dx, dy) < 5) return
          moved = true
          this.#dragging = true
          // Capture keeps the gesture on the note even at speed; a pointer
          // that has already retired throws here, and the drag works anyway.
          try { note.setPointerCapture(down.pointerId) } catch { /* retired pointer */ }
          note.classList.add('postit-dragging')
        }
        // Compositor-only while the paper is in hand: a translate, no layout
        // pass, no transition — the note tracks the pointer 1:1. Same lift
        // as the .postit-dragging class (inline transform overrides it).
        note.style.transform = `translate(${dx}px, ${dy - 7}px) rotate(0deg) scale(1.055)`
        ev.preventDefault()
      }
      const done = (ev: PointerEvent): void => {
        note.removeEventListener('pointermove', move)
        note.removeEventListener('pointerup', done)
        note.removeEventListener('pointercancel', done)
        if (!moved) return
        this.#dragging = false
        this.#justDragged = true
        if (ev.type === 'pointercancel') {
          note.style.transform = ''
          note.classList.remove('postit-dragging')
          void this.#reconcile()
          return
        }
        // Bake the delta into fixed left/top and drop the translate in the
        // same frame — net visual movement zero. The transform TRANSITION
        // must be off across that swap: left/top jump instantly while
        // transform would animate from the drag offset, so for 140ms the
        // note painted at position+offset (a visible leap to double the
        // distance) before sliding back. Settle the tilt on the next frame,
        // once the new position is the one being transitioned FROM.
        const left = baseLeft + dx, top = baseTop + dy
        note.classList.add('postit-settling')
        note.classList.add('postit-pinned')
        const box = this.#boxSize()
        note.style.left = `${(left / Math.max(1, box.w)) * 100}%`
        note.style.top = `${(top / Math.max(1, box.h)) * 100}%`
        note.style.transform = ''
        note.classList.remove('postit-dragging')
        // rAF is the right moment, but a hidden/throttled tab never fires it
        // — and a stuck `settling` leaves that note's transitions dead for
        // the rest of the session. Whichever lands first wins.
        const settled = (): void => note.classList.remove('postit-settling')
        requestAnimationFrame(settled)
        window.setTimeout(settled, 120)
        void this.#persistPin(cell, left, top)
      }
      note.addEventListener('pointermove', move)
      note.addEventListener('pointerup', done)
      note.addEventListener('pointercancel', done)
    })
  }

  /** The bottom-right grip: pull the corner, the paper grows. The size is
   *  remembered on the note AND as this participant's default, so the next
   *  note you stick comes up the size you last chose. */
  #wireResize(
    note: HTMLButtonElement,
    grip: HTMLElement,
    cell: { label: string; path: string[]; payload?: PostitPayload },
  ): void {
    grip.addEventListener('pointerdown', down => {
      if (down.pointerType === 'mouse' && down.button !== 0) return
      // The grip lives inside the note, whose own pointerdown starts a MOVE.
      // Stop here: one corner, one meaning.
      down.stopPropagation()
      down.preventDefault()
      const rect = note.getBoundingClientRect()
      const w0 = note.offsetWidth, h0 = note.offsetHeight
      const sx = down.clientX, sy = down.clientY
      let w = w0, h = h0
      let moved = false
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy
        if (!moved) {
          if (Math.hypot(dx, dy) < 4) return
          moved = true
          this.#dragging = true
          try { grip.setPointerCapture(down.pointerId) } catch { /* retired pointer */ }
          note.classList.add('postit-settling')
        }
        // Cap at the viewport so the paper can't grow past the glass; the
        // note keeps its top-left, exactly like a window resized by its
        // bottom-right corner.
        w = Math.min(Math.max(STICKY_MIN.w, w0 + dx), Math.max(STICKY_MIN.w, window.innerWidth - rect.x))
        h = Math.min(Math.max(STICKY_MIN.h, h0 + dy), Math.max(STICKY_MIN.h, window.innerHeight - rect.y))
        note.style.width = `${w}px`
        note.style.height = `${h}px`
        ev.preventDefault()
      }
      const done = (): void => {
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', done)
        grip.removeEventListener('pointercancel', done)
        if (!moved) return
        this.#dragging = false
        // The grip's press ends on the NOTE's click too — suppress that open.
        this.#justDragged = true
        const settled = (): void => note.classList.remove('postit-settling')
        requestAnimationFrame(settled)
        window.setTimeout(settled, 120)
        try { localStorage.setItem(POSTIT_SIZE_KEY, JSON.stringify({ w, h })) } catch { /* private mode — the note still keeps its own size */ }
        void this.#persistPatch(cell, { size: { w, h } })
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', done)
      grip.addEventListener('pointercancel', done)
    })
  }

  /** Write the drop position into the note's decoration payload — the same
   *  replace-one-live-record path `/postit here` uses, so a pin is one
   *  ordinary layer edit and the reconcile that follows re-renders the
   *  sticky already pinned. On a failed write, reconcile snaps it back to
   *  the last committed truth rather than leaving a lie on screen. */
  async #persistPin(cell: { path: string[] }, left: number, top: number): Promise<void> {
    // `left`/`top` are already box coordinates — the drop is stored as the
    // fraction of the box it landed in, which is what the render side reads
    // back. Room reserved by a toolwindow never enters the arithmetic.
    const { w, h } = this.#boxSize()
    // A collapsed viewport (hidden tab, mid-rotation) would mint a garbage
    // fraction and teleport the note on the next real render — drop the
    // write and let reconcile snap back to the last committed spot.
    if (w < 50 || h < 50) { void this.#reconcile(); return }
    // UNCLAMPED — the note stops where the hand stops, a half-off-the-edge
    // drop included. Fractions may run outside [0,1]; the render side keeps
    // only a grabbable corner in reach, so nothing is ever stranded.
    await this.#persistPatch(cell, { pin: { x: left / w, y: top / h } })
  }

  /** Fold a change into the note's live decoration payload — the same
   *  replace-one-live-record path `/postit here` uses, so a pin or a size is
   *  one ordinary layer edit. Reads the prior payload first and spreads over
   *  it, so moving a note never forgets its size (or its text). On a failed
   *  write, reconcile snaps back to the last committed truth rather than
   *  leaving a lie on screen. */
  async #persistPatch(cell: { path: string[] }, patch: Partial<PostitPayload>): Promise<void> {
    this.#writing = true
    try {
      const prior = (await listDecorations<PostitPayload>({ kind: POSTIT_KIND, segments: cell.path }))
        .at(-1)?.record.payload
      await replaceDecoration({
        kind: POSTIT_KIND,
        appliesTo: cell.path,
        segments: cell.path,
        payload: { ...(prior ?? { version: 1 }), ...patch },
        mark: 'persistent',
      })
      this.#writing = false
      // A reconcile that fell inside the window above returned early, so ask
      // for one now that the record is settled — otherwise the note keeps
      // only its inline styling and the next unrelated pass is the first to
      // read the change back.
      this.#change()
    } catch {
      this.#writing = false
      void this.#reconcile()
    }
  }

  // ── Surface 2: the opened post ───────────────────────────────────────

  async #mountPost(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    if (isBehaviorDormant(POSTIT_KIND, segments) || await isFeatureHidden(segments, POSTIT_KIND)) {
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

    // Publish mode: the page IS the site — no × to fall out of it.
    if (!this.#sealedOpen()) host.append(close)
    document.body.appendChild(host)
    // The post scrolls, so on Windows it wears a real scrollbar — measure it
    // and let the × step aside by that much (scroll-gutter.ts).
    this.#gutterOff = trackScrollGutter(host)
    this.#post = host
    this.#applyCover()
    this.#setActive(true)
  }

  /** The tile's own picture, resolved from its `properties` slot — the
   *  asset the viewer falls back to when the post-it carries no page/text. */
  async #tileImageSig(segments: readonly string[]): Promise<string | null> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    if (!history || !store || segments.length === 0) return null
    try {
      const props = await readTilePropertiesAt(segments.slice(0, -1), segments[segments.length - 1])
      // A post-it shows the asset as a RECTANGLE, so it wants the picture
      // itself — not the hexagon-shaped capture with the gold rim baked
      // across it. First candidate whose bytes are actually here: a tile
      // can name an original it does not hold (adoption carries the props
      // blob, not the heavy original), and a broken image is worse than a
      // framed one.
      const candidates = tilePictureCandidates(props)
      for (const sig of candidates) {
        const bytes = store.getResourceLocal
          ? await resolveLocalResourceReference(store as StoreShape & { getResourceLocal(sig: string): Promise<Blob | null> }, sig)
          : await store.getResource(sig)
        if (bytes && bytes.size > 0) return sig
      }
      return candidates[0] ?? null
    } catch { return null }
  }

  #teardownPost(): void {
    this.#gutterOff?.()
    this.#gutterOff = null
    this.#post?.remove()
    this.#post = null
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', POSTIT_OWNER)
    else modes?.exit('view:active', POSTIT_OWNER)
  }
}

// Sticky yellows deliberately read as PAPER pinned over the hive, not as
// chrome — the one warm object in a cold shell. No text lives in tile art;
// the sticky is DOM and carries the note's title.
//
// z 100005: a post-it sits ON TOP OF ANY LOCATION, like paper on the glass —
// above the reparented Pixi canvas (59989, whose pointer-events:auto
// <canvas> eats clicks below it), above shell chrome (controls 59999,
// header 60000) and above the docked toolwindow layer (100002), so a note
// dropped over a panel or the header stays visible and grabbable there.
// The host stays pointer-events:none — only the notes themselves are solid.
// Top rides --hc-header-anchor so header zoom or a wrapped icon rail pushes
// the DOCKED stack down instead of over it (never a bare rem — see
// _header-size.scss); left adds --hc-controls-left, the side-docked control
// bar's edge reservation, so the dock clears the bar.
const STICKY_CSS = `
.hc-postit-stickies{position:fixed;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);top:var(--hc-inset-top,0px);bottom:var(--hc-inset-bottom,0px);z-index:100005;display:flex;flex-direction:column;align-items:flex-start;gap:.75rem;pointer-events:none;padding:calc(var(--hc-header-anchor,3.5rem) + 1rem) 0 0 calc(0.9rem + var(--hc-controls-left,0px) + env(safe-area-inset-left,0px))}
.postit-sticky{position:relative;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;box-sizing:border-box;width:7.4rem;aspect-ratio:1/.94;padding:0;border:0;background:none;text-align:left;cursor:pointer;color:#4a3f0f;transform:rotate(var(--postit-tilt,-2deg)) translateZ(0);transition:transform .14s ease;font-family:'Segoe Print','Comic Sans MS',cursive,system-ui}
.postit-sticky.postit-pinned{position:absolute;margin:0}
.postit-sticky.postit-settling{transition:none}
.postit-sticky[style*="height"]{aspect-ratio:auto}
/* The sheet UNDER the top one — a pale second note peeking out bottom-right,
   the way a pad sits when the top leaf is lifted a little askew. */
.postit-sticky::before{content:'';position:absolute;left:8%;top:10%;right:-6%;bottom:-8%;background:linear-gradient(168deg,#fdf3b4 0%,#f2dd8a 100%);transform:rotate(5deg);box-shadow:2px 4px 6px rgba(0,0,0,.32),6px 12px 18px rgba(0,0,0,.26)}
/* The written face — the note you actually read. Ruled lines sit under the
   title so an empty note still reads as PAPER WITH WRITING on it. */
.postit-face{position:absolute;left:0;top:0;right:8%;bottom:6%;box-sizing:border-box;padding:.8rem .7rem 1rem;background:linear-gradient(168deg,#fdf6b8 0%,#f7e58f 68%,#eed469 100%);box-shadow:1px 2px 2px rgba(48,36,3,.24),4px 8px 9px rgba(0,0,0,.3),10px 16px 22px rgba(0,0,0,.22),inset 0 -1.4rem 1rem -1.2rem rgba(120,90,10,.22),inset 0 1px rgba(255,255,255,.8);transform:rotate(-3deg)}
.postit-face::after{content:'';position:absolute;left:.8rem;right:1.1rem;bottom:1.05rem;height:1.1rem;background:repeating-linear-gradient(to bottom,rgba(96,80,20,.5) 0 2px,transparent 2px 7px);opacity:.7}
/* The pushpin — a steel dome head, narrow and tall, standing off the paper
   with NO visible stem: the soft ellipse of shadow underneath (::after) is
   what says it is pressed in. Chosen from the colorway strip (the steel
   one); the flat-cap push_pin build and the tilted variant were tried and
   retired. Lit from the upper left — a white streak on the shoulder
   (::before), chrome falling to near-black where the head turns away. */
.postit-pin{position:absolute;left:50%;top:.06rem;width:.92rem;height:1.12rem;margin-left:-.46rem;border-radius:46% 46% 40% 40% / 58% 58% 42% 42%;
background:linear-gradient(168deg,#ffffff 0%,#cfd8df 30%,#8d979f 66%,#4c545b 100%);
box-shadow:0 .3rem .36rem -.16rem rgba(14,20,26,.55),0 .1rem .14rem rgba(0,0,0,.32),inset 0 .06rem .1rem rgba(255,255,255,.55),inset -.07rem -.12rem .2rem rgba(50,58,64,.5)}
.postit-pin::before{content:'';position:absolute;left:26%;top:12%;width:.2rem;height:.42rem;border-radius:50%;background:linear-gradient(160deg,rgba(255,255,255,.9),rgba(255,255,255,0))}
.postit-pin::after{content:'';position:absolute;left:50%;bottom:-.16rem;width:.8rem;height:.24rem;transform:translateX(-46%);border-radius:50%;background:radial-gradient(ellipse at 50% 50%,rgba(60,42,6,.5),rgba(60,42,6,0) 70%)}
.postit-grip{position:absolute;right:8%;bottom:6%;width:1.15rem;height:1.15rem;cursor:nwse-resize;touch-action:none;opacity:0;transition:opacity .14s ease}
.postit-grip::after{content:'';position:absolute;right:.2rem;bottom:.2rem;width:.5rem;height:.5rem;border-right:2px solid rgba(74,63,15,.5);border-bottom:2px solid rgba(74,63,15,.5)}
.postit-sticky:hover .postit-grip,.postit-sticky:focus-within .postit-grip{opacity:1}
@media(pointer:coarse){.postit-grip{opacity:.75;width:1.5rem;height:1.5rem}}
.postit-sticky.postit-dragging{transform:translateY(-7px) rotate(0deg) scale(1.055);cursor:grabbing;transition:none}
.postit-sticky:hover{transform:translateY(-4px) rotate(0deg) scale(1.045)}
.postit-sticky-title{display:block;position:relative;z-index:1;margin-top:.85rem;font-size:.76rem;font-weight:700;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.postit-sticky-cue{position:absolute;right:.5rem;bottom:.25rem;font-size:.6rem;opacity:.55}
@media(max-width:640px){.postit-sticky{width:6.6rem}}
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
.postit-close{position:fixed;z-index:2147483600;right:calc(0.75rem + env(safe-area-inset-right,0px) + var(--hc-scroll-gutter,0px));top:calc(0.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(12,17,24,.82);border:1px solid rgba(126,182,214,.42);backdrop-filter:blur(6px);color:#cfe2ee;cursor:pointer;font:1.3rem/1 serif;padding:0;opacity:.55;transition:opacity .16s ease}
.postit-close:hover{opacity:1}
`

const _postitView = new PostitViewDrone()
window.ioc.register('@diamondcoreprocessor.com/PostitViewDrone', _postitView)

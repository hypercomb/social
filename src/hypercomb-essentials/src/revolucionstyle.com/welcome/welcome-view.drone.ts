// The Revolución threshold — a daylight welcome page built from the layer.
//
// The decorated cell's CHILDREN are the elements of the page: each child
// tile is a plate in a bright ATELIER — warm ivory paper, espresso ink,
// gold hairlines — laid out as a clean centred gallery grid. Every element
// visible at once, obviously clickable, nothing floating and nothing to
// learn: hovering lifts a plate, stepping through one opens that child's
// own view (the room mounts its page; a bespoke view takes over when the
// child earns one). This drone renders exactly ONE layer; children are
// doorways. Depth is garnish here — soft shadows, a staggered entrance —
// never a scene the visitor has to navigate.
//
// No dependencies, no canvases, no fetching beyond the hive's own
// sig-addressed tile art. Earlier concepts are recorded in the behaviour's
// hive notes: the dark colonnade hid the layer, the dark 3D wall read as
// heavy — the interface is light now, in both senses.

import { Drone } from '@hypercomb/core'
import { titleForLabel, defaultViewForSegments } from '../../diamondcoreprocessor.com/commands/decoration-kind-index.js'
import { isFeatureHidden } from '../../diamondcoreprocessor.com/sharing/feature-hidden.js'
import { isKindGloballyOff } from '../../diamondcoreprocessor.com/sharing/behavior-enablement.js'
import { listDecorations } from '../../diamondcoreprocessor.com/commands/decoration-manifest.js'
import { tilePictureCandidates } from '../../diamondcoreprocessor.com/editor/tile-properties.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../diamondcoreprocessor.com/history/layer-placement.js'
import { WELCOME_KIND, WELCOME_VIEW, type WelcomePayload } from './welcome.queen.js'
import { ROOM_VIEW } from './room-view.drone.js'
import type { BackGesture } from '../../diamondcoreprocessor.com/navigation/back-gesture.service.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
type StoreShape = {
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
}
const SIG_RE = /^[0-9a-f]{64}$/

interface PanelData { label: string; title: string; imageUrl: string | null }

const revokeAll = (urls: readonly string[]): void => {
  for (const url of urls) URL.revokeObjectURL(url)
}

export class WelcomeViewDrone extends Drone {
  readonly namespace = 'revolucionstyle.com'
  override genotype = 'presentation'
  override description =
    'Revolución welcome renderer — the decorated cell opens into a daylight atelier whose plates are its children.'

  #host: HTMLElement | null = null
  #targetSegments: string[] | null = null
  #bound = false
  #active = false
  #gen = 0
  /** Unregisters the right-click way out (back-gesture.service.ts). */
  #backOff: (() => void) | null = null
  /** Object URLs handed to the plates — process-wide until revoked. */
  #objectUrls: string[] = []

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      // A REAL RENDERER FOLLOWS THE LINEAGE. The plate click is the same
      // click a hexagon gets — navigate, nothing more — so when the
      // destination's own face is this same atelier, no mode change and no
      // suggestion ever fires: the lineage moving IS the render trigger.
      // (#targetSegments was the pre-navigation override; once the lineage
      // has moved, the lineage is the truth.)
      window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
        ?.addEventListener?.('change', this.#lineageChange)
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== WELCOME_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(WELCOME_VIEW)
        void this.#reconcile()
      })
      // Right-click is the way out of the atelier, the same as Escape — the
      // entry is keyed by this view's `view:active` owner, so it only answers
      // while the wall is actually up.
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: 'welcome-view', back: () => this.#vm()?.setMode('hexagons') }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
      ?.removeEventListener?.('change', this.#lineageChange)
    window.removeEventListener('keydown', this.#key, true)
    this.#backOff?.()
    this.#backOff = null
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #lineageChange = (): void => {
    this.#targetSegments = null
    void this.#reconcile()
  }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== WELCOME_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#vm()?.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === WELCOME_VIEW) { await this.#mount(gen); return }
    this.#targetSegments = null
    this.#teardown()
  }

  async #mount(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    if (isKindGloballyOff(WELCOME_KIND) || await isFeatureHidden(segments, WELCOME_KIND)) {
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }

    const records = await listDecorations<WelcomePayload>({ kind: WELCOME_KIND, segments })
    if (gen !== this.#gen || this.#vm()?.mode !== WELCOME_VIEW) return
    const payload = records.at(-1)?.record.payload
    const label = segments.at(-1) ?? ''
    const title = payload?.title
      || (label ? titleForLabel(label, navigator.language) || label : 'Welcome')

    // The plates' bytes are handed over as object URLs, so this pass's URLs
    // are collected apart from the live set and only adopted AFTER the old
    // host is torn down — teardown revokes what it owns, and revoking a URL
    // the new plates are about to use would blank the page it just built.
    const fresh: string[] = []
    const panels = await this.#panels(segments, fresh)
    if (gen !== this.#gen || this.#vm()?.mode !== WELCOME_VIEW) { revokeAll(fresh); return }

    this.#teardown()
    this.#objectUrls = fresh
    this.#host = this.#build(title, payload?.tagline ?? '', segments, panels)
    document.body.appendChild(this.#host)
    this.#setActive(true)
  }

  /** The layer's children, in layer order — the elements of the page. */
  async #panels(segments: readonly string[], sink: string[]): Promise<PanelData[]> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    let labels: string[] = []
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
      if (layer) labels = await childNamesOf(history as unknown as PlacementHistory, layer as unknown as PlacementLayer)
    } catch { /* no layer here */ }
    return Promise.all(labels.map(async child => ({
      label: child,
      title: titleForLabel(child, navigator.language) || child,
      imageUrl: await this.#tileImageUrl([...segments, child], sink),
    })))
  }

  async #tileImageUrl(segments: readonly string[], sink: string[]): Promise<string | null> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    if (!history || !store) return null
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
      const propsSig = Array.isArray((layer as { properties?: unknown })?.properties)
        ? String(((layer as { properties?: unknown[] }).properties as unknown[])[0] ?? '')
        : ''
      if (!SIG_RE.test(propsSig)) return null
      const blob = await store.getResource(propsSig)
      if (!blob) return null
      // The PICTURE, not the hex capture: a plate is a rectangle, and the
      // capture carries the hexagon's crop — and, on anything saved
      // through the tile editor before the frame stopped being baked, the
      // gold hex stroke straight across the middle of the image.
      //
      // The original has to be one we actually HOLD. A tile can name an
      // original it does not have (adoption carries the props blob, not
      // the heavy bytes), and a plate showing a broken image is worse
      // than a plate showing a framed one — so take the first candidate
      // whose bytes are here, and hand the browser those bytes rather
      // than making it fetch them a second time through /@resource/.
      // Local reads only: sixteen plates must not each wait on the host.
      for (const sig of tilePictureCandidates(JSON.parse(await blob.text()))) {
        const bytes = await (store.getResourceLocal?.(sig) ?? store.getResource(sig))
        if (!bytes || bytes.size === 0) continue
        const url = URL.createObjectURL(bytes)
        sink.push(url)
        return url
      }
      return null
    } catch { return null }
  }

  // ── The page ─────────────────────────────────────────────────────────

  #build(title: string, tagline: string, segments: readonly string[], panels: PanelData[]): HTMLElement {
    const host = document.createElement('section')
    host.className = 'hc-welcome-view'
    host.innerHTML = `<style>${SCENE_CSS}</style>`
    // The page scrolls like a page; the hex wheel-zoom handler must not
    // preventDefault our wheel events (same hatch the site view uses).
    host.setAttribute('data-consumes-wheel', '')

    const sheet = document.createElement('div')
    sheet.className = 'wv-sheet'
    host.appendChild(sheet)

    const crest = document.createElement('header')
    crest.className = 'wv-crest'
    const heading = document.createElement('h1')
    heading.className = 'wv-title'
    heading.textContent = title
    crest.appendChild(heading)
    const rule = document.createElement('div')
    rule.className = 'wv-rule'
    crest.appendChild(rule)
    if (tagline) {
      const sub = document.createElement('p')
      sub.className = 'wv-tagline'
      sub.textContent = tagline
      crest.appendChild(sub)
    }
    sheet.appendChild(crest)

    const grid = document.createElement('main')
    grid.className = 'wv-grid'
    panels.forEach((panel, index) => {
      const plate = document.createElement('button')
      plate.type = 'button'
      plate.className = 'wv-plate'
      plate.style.setProperty('--i', String(index))
      plate.title = panel.title
      const mat = document.createElement('span')
      mat.className = 'wv-mat'
      if (panel.imageUrl) {
        const img = document.createElement('img')
        img.className = 'wv-art'
        img.src = panel.imageUrl
        img.alt = ''
        img.draggable = false
        mat.appendChild(img)
      } else {
        const blank = document.createElement('span')
        blank.className = 'wv-art wv-art-blank'
        mat.appendChild(blank)
      }
      plate.appendChild(mat)
      const caption = document.createElement('span')
      caption.className = 'wv-caption'
      caption.textContent = panel.title
      plate.appendChild(caption)
      plate.onclick = () => this.#enter([...segments, panel.label])
      grid.appendChild(plate)
    })
    sheet.appendChild(grid)

    const hint = document.createElement('p')
    hint.className = 'wv-hint'
    hint.textContent = panels.length
      ? 'step through a plate'
      : 'nothing behind the threshold yet'
    sheet.appendChild(hint)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'wv-close'
    close.setAttribute('aria-label', 'Return to hexagons')
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')
    host.appendChild(close)

    return host
  }

  /** Step through a doorway: real navigation into the child, then the
   *  child's OWN view — the room mounts the cell's page as its presence,
   *  and falls through to the hexagons when the cell has none. */
  #enter(segments: readonly string[]): void {
    // THE TILE'S CLICK IS THE TILE'S CLICK — the same one a hexagon gets:
    // navigate, and let the ARRIVAL system open whatever face the
    // destination declares (its view:default mark). Forcing the room here
    // was a second, private road that overrode the tile's own face — the
    // room is only the atelier's FALLBACK presentation for a child that
    // declares none.
    window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(segments)
    if (defaultViewForSegments(segments)) return
    this.emitEffect('view:open-for-tile', { view: ROOM_VIEW, segments: [...segments] })
  }

  #teardown(): void {
    this.#host?.remove()
    this.#host = null
    revokeAll(this.#objectUrls)
    this.#objectUrls = []
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'welcome-view')
    else modes?.exit('view:active', 'welcome-view')
  }
}

// Daylight atelier: warm ivory paper, espresso ink, gold hairlines. The
// plates are the only pictures on the sheet; everything else is type and
// air. Depth is garnish — soft shadows and a staggered entrance — never a
// scene to navigate.
const SCENE_CSS = `
.hc-welcome-view{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:150;overflow:auto;background:
 radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.75),transparent 60%),
 linear-gradient(180deg,#f8f3e8 0%,#f3ecdd 60%,#ede4d1 100%);
 color:#31241a}
.wv-sheet{box-sizing:border-box;max-width:1180px;margin:0 auto;padding:clamp(2.2rem,6vh,4.5rem) clamp(1.2rem,4vw,3rem) 4rem;min-height:100%;display:flex;flex-direction:column}
.wv-crest{text-align:center;margin-bottom:clamp(1.8rem,4.5vh,3.2rem);animation:wv-rise .7s cubic-bezier(.2,.7,.2,1) backwards}
.wv-title{margin:0;font:italic 700 clamp(2.6rem,6vw,4.2rem)/1.08 Georgia,'Times New Roman',serif;letter-spacing:.04em;color:#3a2a1c}
.wv-rule{width:7.5rem;height:2px;margin:1.05rem auto 0;background:linear-gradient(90deg,transparent,#b8933f 18%,#d9b96a 50%,#b8933f 82%,transparent)}
.wv-tagline{margin:.95rem 0 0;color:#8a7657;font:400 .95rem/1.5 Georgia,serif;letter-spacing:.24em;text-transform:uppercase}
.wv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:clamp(1rem,2.4vw,1.8rem);justify-items:stretch;align-content:start;max-width:980px;margin:0 auto;width:100%}
.wv-plate{display:flex;flex-direction:column;gap:.7rem;padding:0;border:0;background:none;cursor:pointer;text-align:center;animation:wv-rise .6s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(.05s * var(--i,0));transition:transform .18s ease}
.wv-plate:hover,.wv-plate:focus-visible{transform:translateY(-5px);outline:none}
.wv-mat{display:block;background:#fffdf7;border:1px solid rgba(184,147,63,.55);padding:9px;box-shadow:0 1px 2px rgba(58,42,28,.08),0 10px 24px -12px rgba(58,42,28,.28);transition:box-shadow .18s ease,border-color .18s ease}
.wv-plate:hover .wv-mat,.wv-plate:focus-visible .wv-mat{border-color:#b8933f;box-shadow:0 2px 3px rgba(58,42,28,.1),0 18px 34px -14px rgba(58,42,28,.4),0 0 0 1px rgba(184,147,63,.35)}
.wv-art{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#efe7d6}
.wv-plate:hover .wv-art{filter:saturate(1.05) brightness(1.03)}
.wv-art-blank{background:
 radial-gradient(42% 42% at 50% 46%,rgba(184,147,63,.22),transparent 72%),
 conic-gradient(from 30deg,rgba(184,147,63,.14) 0 60deg,transparent 0 120deg,rgba(184,147,63,.14) 0 180deg,transparent 0 240deg,rgba(184,147,63,.14) 0 300deg,transparent 0),#f4edde}
.wv-caption{color:#5c4630;font:600 .78rem/1.3 Georgia,'Times New Roman',serif;letter-spacing:.14em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-plate:hover .wv-caption{color:#3a2a1c}
.wv-hint{margin:auto auto 0;padding-top:2.6rem;text-align:center;color:rgba(138,118,87,.75);font:400 .74rem/1 Georgia,serif;letter-spacing:.26em;text-transform:uppercase;animation:wv-fade 1s ease .6s backwards}
.wv-close{position:fixed;z-index:2147483600;right:calc(.75rem + env(safe-area-inset-right,0px));top:calc(.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,253,247,.85);border:1px solid rgba(184,147,63,.5);backdrop-filter:blur(6px);color:#5c4630;cursor:pointer;font:1.3rem/1 serif;padding:0;opacity:.6;transition:opacity .16s ease}
.wv-close:hover{opacity:1}
@keyframes wv-rise{from{opacity:0;translate:0 14px}to{opacity:1;translate:0 0}}
@keyframes wv-fade{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.wv-plate,.wv-crest{animation:none}.wv-hint{animation:none}}
@media(max-width:560px){.wv-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr))}.wv-mat{padding:6px}.wv-caption{font-size:.68rem;letter-spacing:.1em}}
`

const _welcomeView = new WelcomeViewDrone()
window.ioc.register('@revolucionstyle.com/WelcomeViewDrone', _welcomeView)

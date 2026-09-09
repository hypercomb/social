// presentation/tiles/layer-list.drone.ts
//
// THE LAYER LIST — the phone's reading of a layer.
//
// The hexagon grid is a MAP: its worth is seeing many things at once and
// where they sit. A phone is 375px wide; three across is the ceiling, and at
// three across a hexagon has room for a picture OR a name, not both. A layer
// is mostly a DIRECTORY, and the map fails as one. So on a phone the layer
// reads as a COLUMN OF ROWS — the hexagon becomes the tile's thumbnail —
// with the conventions every thumb already knows: tap to open, ‹ to go
// back, one + to add. Design: documentation/mobile-one-column.md.
//
// IT IS THE PHONE'S CANVAS, NOT A VIEW. It never enters `view:active` (BACK
// must go UP A LAYER, never "out of the list"); it stands down while a view
// holds the screen, and it is phone-only by the one definition of a phone
// (`MobileModeService`), never a media query of its own. The Pixi stage
// keeps running underneath — its replayed `render:cell-count` is what feeds
// the rows — and this surface simply paints over it and takes the touches.
//
// NOTHING IS WRITTEN BY LOOKING. Rows are the layer's index order exactly as
// the spiral and the rails read it (`labels` is dense, ascending slot order);
// every door a row opens is one the hexagons already use:
//
//   branch row  → `tile:enter-request {label}`   (the overlay's #navigateInto)
//   leaf row    → `openTileMenu(label)`           (the close-up — the tile page)
//   ‹           → `Navigation.back()`             (history-true, like the bar)
//   title       → the path, root → here; a tap is `Navigation.goRaw(...)`
//   ⋯           → `layer:deck-open`               (More — the layer deck)
//
// CONTROLS PAINT BEFORE THEY WRITE: rows paint from the replayed payload at
// once; pictures and note peeks fill in per row afterwards.
//
// CONTRIBUTED THE DOCTRINE WAY: a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html.

import { Drone, EffectBus, I18N_IOC_KEY, RESOURCE_URL_PREFIX, type I18nProvider } from '@hypercomb/core'
import { openTileMenu } from './viewer-walk.js'
import { readTilePropertiesAt, recoverableTileImageSig, tilePictureCandidates } from '../../editor/tile-properties.js'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../../preferences/mobile-pheromones.js'

export const LAYER_LIST_SURFACE = 'hc-layer-list'
export const LAYER_LIST_KEY = '@diamondcoreprocessor.com/LayerListDrone'
/** One above the Pixi host (59989) and level with the tile close-up (59990),
 *  which is appended to <body> on open and therefore paints over us; the
 *  controls bar (60000), every tool window (100002) and the deck (100003)
 *  sit above. The activity toast shares 59990 and is a later surface. */
const LIST_Z = 59990
/** Registry order — before the activity log (360) so its toast paints over
 *  the rows at the same z. */
const LIST_ORDER = 300
const ROW_HEIGHT = '3.75rem'
const HEX = 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)'
const STYLE_ID = 'hc-layer-list-css'

type CellCountPayload = {
  count?: number
  labels?: string[]
  branchLabels?: string[]
  externalLabels?: string[]
  linkLabels?: string[]
  noImageLabels?: string[]
  hiddenLabels?: string[]
  filterBlocked?: string[]
  locationKey?: string
  settled?: boolean
}
type Row = {
  label: string
  branch: boolean
  link: boolean
  picture: boolean
  hidden: boolean
  blocked: boolean
}
type LineageShape = { explorerSegments?: () => readonly string[] }
type NavigationShape = { goRaw?: (segments: readonly string[]) => void; back?: () => unknown }
type ModesShape = { isActive?: (mode: string) => boolean }
type NotesShape = { getNotes?: (label: string) => Promise<{ text?: string }[]> }
type SnapshotShape = { snapshotCells?: () => { label: string; imageSig?: string }[] }

/** The element the registry mounts — it exists at the registry's order and
 *  tells the drone where it is. */
export class LayerListElement extends HTMLElement {
  connectedCallback(): void {
    this.style.cssText = `position:fixed;z-index:${LIST_Z};display:none;`
    this.setAttribute('data-hc-layer-list', '')
    window.ioc?.get?.<LayerListDrone>(LAYER_LIST_KEY)?.attach(this)
  }

  disconnectedCallback(): void {
    window.ioc?.get?.<LayerListDrone>(LAYER_LIST_KEY)?.detach(this)
  }
}

export class LayerListDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override listens = ['render:cell-count', MOBILE_MODE_EFFECT, 'view:active']
  protected override emits = ['tile:enter-request', 'tile:view-open', 'layer:deck-open']

  #registered = false
  #bound = false
  #element: HTMLElement | null = null
  #mobile = false
  #viewActive = false
  #rows: Row[] = []
  /** The location the rows describe; a navigate marks them stale until the
   *  next pass lands, so the previous page never flashes under a new title. */
  #stale = false
  #pathOpen = false
  /** Fills that outlived their row (a fast back-and-forth) must not land. */
  #generation = 0

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register(LAYER_LIST_KEY, this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      this.#mobile = payload?.active === true
      this.#sync()
    })
    // A view took the screen (a slideshow, the scroller, a picture): the
    // list is chrome around the hive, and it gets out of the way exactly as
    // the bar does.
    this.onEffect<{ active?: boolean }>('view:active', payload => {
      this.#viewActive = payload?.active === true
      this.#sync()
    })
    this.onEffect<CellCountPayload>('render:cell-count', payload => {
      if (!payload || payload.settled === false) return
      this.#rows = this.#rowsFrom(payload)
      this.#stale = false
      this.#pathOpen = false
      this.#render()
    })
    window.addEventListener('navigate', this.#onNavigate)
  }

  /** Called by the element when the registry mounts it. */
  attach(el: HTMLElement): void {
    this.#element = el
    this.#sync()
  }

  detach(el: HTMLElement): void {
    if (this.#element === el) this.#element = null
  }

  /** Is the list on screen? */
  get showing(): boolean {
    return this.#mobile && !this.#viewActive && !!this.#element && this.#element.style.display !== 'none'
  }

  /** The rows as last read — the harness's and the spec's window. */
  get rows(): readonly Row[] { return this.#rows }

  #onNavigate = (): void => {
    this.#stale = true
    this.#pathOpen = false
    this.#render()
  }

  #sync(): void {
    const el = this.#element
    if (!el) return
    const modes = window.ioc?.get?.<ModesShape>('@diamondcoreprocessor.com/ModeRegistry')
    const underView = this.#viewActive || modes?.isActive?.('view:active') === true
    const show = this.#mobile && !underView
    if (!show) {
      el.style.display = 'none'
      el.replaceChildren()
      return
    }
    this.#render()
  }

  #rowsFrom(p: CellCountPayload): Row[] {
    const labels = Array.isArray(p.labels) ? p.labels : []
    const branch = new Set([...(p.branchLabels ?? []), ...(p.externalLabels ?? [])])
    const link = new Set(p.linkLabels ?? [])
    const noImage = new Set(p.noImageLabels ?? [])
    const hidden = new Set(p.hiddenLabels ?? [])
    const blocked = new Set(p.filterBlocked ?? [])
    return labels.filter(Boolean).map(label => ({
      label,
      branch: branch.has(label),
      link: link.has(label),
      picture: !noImage.has(label),
      hidden: hidden.has(label),
      blocked: blocked.has(label),
    }))
  }

  // ── DOM ────────────────────────────────────────────────────

  #render(): void {
    const el = this.#element
    if (!el || !this.#mobile || this.#viewActive) return
    installLayerListCss()
    const gen = ++this.#generation
    el.replaceChildren()
    el.style.display = 'flex'
    el.style.cssText +=
      // Under the revealed composer (the bar measures the header's bottom
      // edge and removes the var while it is collapsed), above the bar.
      'top:var(--hc-header-bottom,0px);left:0;right:0;' +
      'bottom:max(var(--hc-controls-bottom,0px),env(safe-area-inset-bottom,0px));' +
      'flex-direction:column;'

    const segments = this.#segments()
    const here = segments[segments.length - 1] ?? ''

    // ── title bar: ‹ · where I am · ⋯ ──
    const bar = document.createElement('div')
    bar.dataset['role'] = 'list-title'
    const back = document.createElement('button')
    back.type = 'button'
    back.dataset['action'] = 'back'
    back.className = 'hc-ll-glyph'
    back.textContent = '‹'
    back.setAttribute('aria-label', this.#t('controls.back', 'back'))
    back.disabled = segments.length === 0
    back.addEventListener('click', () => this.#back())
    const title = document.createElement('button')
    title.type = 'button'
    title.dataset['action'] = 'path'
    title.className = 'hc-ll-title'
    title.textContent = here || this.#t('layer-list.root', 'your hive')
    title.setAttribute('aria-expanded', String(this.#pathOpen))
    title.addEventListener('click', () => { this.#pathOpen = !this.#pathOpen; this.#render() })
    const more = document.createElement('button')
    more.type = 'button'
    more.dataset['action'] = 'more'
    more.className = 'hc-ll-glyph'
    more.textContent = '⋯'
    more.setAttribute('aria-label', this.#t('controls.more', 'more'))
    more.addEventListener('click', () => EffectBus.emit('layer:deck-open', {}))
    bar.append(back, title, more)
    el.appendChild(bar)

    // ── the path, root → here, dropped under the title ──
    if (this.#pathOpen) {
      const path = document.createElement('div')
      path.dataset['role'] = 'list-path'
      const crumbs = ['', ...segments]
      crumbs.forEach((name, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset['action'] = 'jump'
        b.dataset['depth'] = String(i)
        b.className = 'hc-ll-crumb'
        b.style.paddingLeft = `${0.9 + i * 0.8}rem`
        b.textContent = name || this.#t('layer-list.root', 'your hive')
        if (i === crumbs.length - 1) b.setAttribute('aria-current', 'location')
        b.addEventListener('click', () => this.#jump(segments.slice(0, i)))
        path.appendChild(b)
      })
      el.appendChild(path)
    }

    // ── the rows ──
    const list = document.createElement('div')
    list.dataset['role'] = 'list-rows'
    list.setAttribute('data-consumes-wheel', '')
    if (this.#stale) {
      // Between a navigate and its first pass: nothing, never the old page.
    } else if (this.#rows.length === 0) {
      const empty = document.createElement('div')
      empty.dataset['role'] = 'list-empty'
      const line = document.createElement('p')
      line.textContent = this.#t('layer-list.empty', 'Nothing here yet.')
      const hint = document.createElement('p')
      hint.className = 'hc-ll-hint'
      hint.textContent = this.#t('layer-list.empty-hint', 'Add puts the first tile here.')
      empty.append(line, hint)
      list.appendChild(empty)
    } else {
      const pictures = this.#pictureSigs()
      for (const row of this.#rows) list.appendChild(this.#rowEl(row, pictures.get(row.label), gen))
    }
    el.appendChild(list)
  }

  #rowEl(row: Row, imageSig: string | undefined, gen: number): HTMLElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'hc-ll-row'
    el.dataset['role'] = 'list-row'
    el.dataset['label'] = row.label
    el.dataset['kind'] = row.branch ? 'branch' : 'leaf'
    if (row.hidden || row.blocked) el.classList.add('is-dim')

    const thumb = document.createElement('span')
    thumb.className = 'hc-ll-hex'
    if (imageSig) this.#paint(thumb, imageSig)
    else if (row.picture) void this.#fillPicture(row.label, thumb, gen)

    const text = document.createElement('span')
    text.className = 'hc-ll-text'
    const name = document.createElement('span')
    name.className = 'hc-ll-name'
    name.textContent = row.label
    const sub = document.createElement('span')
    sub.className = 'hc-ll-sub'
    sub.textContent = this.#holds(row)
    text.append(name, sub)

    const tail = document.createElement('span')
    tail.className = 'hc-ll-tail'
    tail.textContent = row.branch ? '›' : ''
    tail.setAttribute('aria-hidden', 'true')

    el.append(thumb, text, tail)
    el.addEventListener('click', () => this.#open(row))
    void this.#fillNote(row.label, sub, gen)
    return el
  }

  /** The second line at rest — what the leaf holds, before its note lands. */
  #holds(row: Row): string {
    if (row.branch) return this.#t('layer-list.inside', 'inside')
    if (row.link) return this.#t('layer-list.link', 'link')
    if (row.picture) return this.#t('layer-list.picture', 'picture')
    return ''
  }

  #paint(thumb: HTMLElement, sig: string): void {
    const img = document.createElement('img')
    img.alt = ''
    img.decoding = 'async'
    img.loading = 'lazy'
    img.src = RESOURCE_URL_PREFIX + sig
    // A picture that will not come (an uncontrolled page, bytes not local
    // yet) leaves the steel hexagon, never a broken-image glyph.
    img.addEventListener('error', () => img.remove())
    thumb.replaceChildren(img)
  }

  /** The renderer had no capture yet (props still cold when it painted, or
   *  an adopted tile whose hex capture never existed): read the tile's own
   *  properties and take the hex capture, else the rectangle picture. */
  async #fillPicture(label: string, thumb: HTMLElement, gen: number): Promise<void> {
    let sig: string | undefined
    try {
      const props = await readTilePropertiesAt(this.#segments(), label)
      sig = recoverableTileImageSig(props) ?? tilePictureCandidates(props)[0]
    } catch { return }
    if (!sig || gen !== this.#generation || !thumb.isConnected) return
    this.#paint(thumb, sig)
  }

  /** The first line of the tile's first note, when it has one. */
  async #fillNote(label: string, sub: HTMLElement, gen: number): Promise<void> {
    const notes = window.ioc?.get?.<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.getNotes) return
    let first = ''
    try {
      const list = await notes.getNotes(label)
      first = String(list?.[0]?.text ?? '').split('\n').find(l => l.trim()) ?? ''
    } catch { return }
    if (gen !== this.#generation || !first.trim() || !sub.isConnected) return
    sub.textContent = first.trim()
  }

  /** What the hexagons paint for each tile — the same capture, as a thumbnail. */
  #pictureSigs(): Map<string, string> {
    const out = new Map<string, string>()
    try {
      const cells = window.ioc?.get?.<SnapshotShape>('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.() ?? []
      for (const c of cells) if (c.imageSig) out.set(c.label, c.imageSig)
    } catch { /* no renderer yet — rows paint without pictures */ }
    return out
  }

  // ── the doors ──────────────────────────────────────────────

  #open(row: Row): void {
    if (row.blocked) return
    if (row.branch) {
      EffectBus.emit('tile:enter-request', { label: row.label })
      return
    }
    openTileMenu(row.label)
  }

  #back(): void {
    if (this.#segments().length === 0) return
    window.ioc?.get?.<NavigationShape>('@hypercomb.social/Navigation')?.back?.()
  }

  #jump(segments: readonly string[]): void {
    // Fold the path before the move: the navigate that follows repaints, but
    // a jump to the page we are already on would not.
    this.#pathOpen = false
    this.#render()
    window.ioc?.get?.<NavigationShape>('@hypercomb.social/Navigation')?.goRaw?.(segments)
  }

  #segments(): string[] {
    try {
      const lineage = this.resolve<LineageShape>('lineage')
      return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    } catch { return [] }
  }

  /** A caption, or the plain-English stand-in. `t()` ECHOES THE KEY BACK when
   *  it cannot resolve one — guard, so no key ever reaches the screen. */
  #t(key: string, fallback: string): string {
    if (!key) return fallback
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      const text = i18n?.t(key)
      return text && text !== key ? text : fallback
    } catch { return fallback }
  }
}

/** One stylesheet, installed once, scoped to the surface's tag. Colours are
 *  the chrome's own tokens so the list follows the theme the bar follows. */
export function installLayerListCss(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = LAYER_LIST_SURFACE
  style.textContent = `
${S}{background:rgb(var(--hc-chrome-glass,250,251,253));color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-plain,0.92));font-family:var(--hc-read,var(--hc-font,system-ui,sans-serif));font-size:1rem;overscroll-behavior:contain;}
${S} [data-role="list-title"]{flex:0 0 auto;display:grid;grid-template-columns:2.75rem 1fr 2.75rem;align-items:center;min-height:2.75rem;padding:max(0.2rem,env(safe-area-inset-top,0px)) 0.3rem 0.2rem;border-bottom:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.22);}
${S} .hc-ll-glyph{appearance:none;border:0;background:none;color:rgba(var(--hc-chrome-accent,20,96,180),0.95);font:inherit;font-size:1.6rem;line-height:1;min-height:2.75rem;cursor:pointer;}
${S} .hc-ll-glyph:disabled{opacity:0.28;}
${S} .hc-ll-title{appearance:none;border:0;background:none;color:inherit;font:inherit;font-weight:600;font-size:1.05rem;min-height:2.75rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
${S} [data-role="list-path"]{flex:0 0 auto;display:flex;flex-direction:column;border-bottom:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.22);background:rgba(var(--hc-chrome-rule,62,74,94),0.06);}
${S} .hc-ll-crumb{appearance:none;border:0;background:none;color:inherit;font:inherit;text-align:left;min-height:2.6rem;padding-right:0.9rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hc-ll-crumb[aria-current]{font-weight:600;color:rgba(var(--hc-chrome-accent,20,96,180),0.95);}
${S} [data-role="list-rows"]{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding-bottom:0.5rem;}
${S} .hc-ll-row{appearance:none;border:0;border-bottom:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.16);background:none;color:inherit;font:inherit;width:100%;display:grid;grid-template-columns:2.9rem 1fr auto;align-items:center;gap:0.65rem;min-height:${ROW_HEIGHT};padding:0.35rem 0.9rem 0.35rem 0.75rem;text-align:left;cursor:pointer;}
${S} .hc-ll-row:active{background:rgba(var(--hc-chrome-accent,20,96,180),0.08);}
${S} .hc-ll-row.is-dim{opacity:0.42;}
${S} .hc-ll-hex{display:block;width:2.4rem;height:2.7rem;clip-path:${HEX};background:rgba(var(--hc-chrome-rule,62,74,94),0.55);justify-self:center;overflow:hidden;}
${S} .hc-ll-hex img{display:block;width:100%;height:100%;object-fit:cover;}
${S} .hc-ll-text{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.15rem;}
${S} .hc-ll-name{display:block;font-weight:600;font-size:1rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hc-ll-sub{display:block;font-size:0.8rem;line-height:1.25;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:1em;}
${S} .hc-ll-tail{font-size:1.5rem;line-height:1;color:rgba(var(--hc-chrome-accent,20,96,180),0.9);}
${S} [data-role="list-empty"]{padding:2.5rem 1.4rem;text-align:center;}
${S} [data-role="list-empty"] p{margin:0 0 0.5rem;}
${S} .hc-ll-hint{color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));font-size:0.9rem;}
`
  document.head.appendChild(style)
}

const _layerList = new LayerListDrone()
window.ioc.register(LAYER_LIST_KEY, _layerList)

// Contribute the surface the doctrine way: define the element, then add it
// to the registry — never a template tag in either app.html.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(LAYER_LIST_SURFACE)) {
    customElements.define(LAYER_LIST_SURFACE, LayerListElement)
  }
  try {
    registry.add({
      name: LAYER_LIST_SURFACE,
      owner: LAYER_LIST_KEY,
      element: LAYER_LIST_SURFACE,
      order: LIST_ORDER,
    })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

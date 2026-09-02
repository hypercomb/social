// presentation/tiles/layer-deck.drone.ts
//
// THE LAYER DECK — the phone's Views sheet.
//
// A phone had no per-layer view icons at all. ViewBee computes the current
// layer's available views (`view-toggles:changed`) and the desktop header
// rail draws them; the phone's command line handed that list an empty array,
// and the bottom bar's pop-up row was six hand-listed how-you-see toggles.
// The only door to a view on a phone was the per-TILE close-up, which needs a
// hold-and-release on one tile. So: the bar's VIEWS disc emits
// `layer:deck-open`, and this sheet answers with BIG PLATES — the close-up's
// own plate language (`app-deck.ts`), so a hand that learned one screen
// already knows the other.
//
// THREE GROUPS, NOTHING HAND-LISTED:
//
//   open as   — the layer's available views, exactly the replayed
//               `view-toggles:changed` list (default view accented). A tap is
//               `view:toggle {view, mode:'on'}`, the same door the header rail
//               uses.
//   add here  — what `VisualBeeRegistry.forPlatform('mobile')` offers as an
//               ATTACHABLE behaviour this layer does not yet carry; a tap is
//               `feature:apply` at the current lineage — the same write the
//               Beehaviors panel and `name@view` make. Plus the CAMERA and the
//               LIBRARY: a feed can be FILLED from the phone's photo library,
//               not only from the live camera, through the same
//               `createTileFromImage` seam the shutter uses.
//   see       — the lane rung (3 / 2 / 1, a lens, never a commit), fullscreen
//               where the platform has it (iPhone has no element fullscreen;
//               an inert button is worse than none), pheromones, and UNDO ·
//               REDO — every phone gesture writes truth and the phone had no
//               way back at all.
//
// IT IS CHROME. It never enters `view:active`: the hive stays painted above
// it, the bar stays where it is, and a tap outside, the back plate, the
// hardware BACK button (one synthetic history entry, popped on close — the
// close-up's own trap) and `layer:deck-close` all put it away. Phone only,
// by the one definition of a phone (`MobileModeService`), never a media
// query of its own.
//
// CONTRIBUTED THE DOCTRINE WAY: a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  APP_COLS, APP_LANDSCAPE_COLS, APP_LANDSCAPE_ROWS, APP_ROWS, DIM, STEEL, TIGHT_GAP,
  appDeckPage, buildAppDeck, installAppDeckCss, type AppChip, type AppDeckGroup,
} from './app-deck.js'
import type { VisualBeeDescriptor, VisualBeeRegistry } from '../../commands/visual-bee-registry.js'
import { isKindGloballyOff } from '../../sharing/behavior-enablement.js'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../../preferences/mobile-pheromones.js'

export const LAYER_DECK_SURFACE = 'hc-layer-deck'
export const LAYER_DECK_KEY = '@diamondcoreprocessor.com/LayerDeckDrone'
/** Above the controls bar (60000) and every tool window: a sheet the bar
 *  opened sits over the bar. It is chrome, so there is nothing above it that
 *  it should be under. */
const SHEET_Z = 100003
const SHEET_BG = 'rgba(8,10,16,0.97)'
const SHEET_EDGE = 'rgba(126,182,214,0.34)'
const BACKDROP = 'rgba(0,0,0,0.42)'
/** The lane rung's ceiling — `lanes:step -1` from 1 wraps back up here. */
const LANES_FULL = 3

type ViewToggle = { view: string; icon?: string; label?: string; active?: boolean; isDefault?: boolean }
type Lanes = { active?: boolean; lanes?: number }
type LineageShape = { explorerSegments?: () => readonly string[] }
type ImagePasteShape = { createTileFromImage?: (blob: Blob) => Promise<void> }
type ModesShape = { isActive?: (mode: string) => boolean }

/** The element the registry mounts. Its whole job is to exist in the DOM at
 *  the registry's order and to tell the drone where it is. */
export class LayerDeckElement extends HTMLElement {
  connectedCallback(): void {
    this.style.cssText = `position:fixed;inset:0;z-index:${SHEET_Z};display:none;pointer-events:none;`
    this.setAttribute('data-hc-layer-deck', '')
    window.ioc?.get?.<LayerDeckDrone>(LAYER_DECK_KEY)?.attach(this)
  }

  disconnectedCallback(): void {
    window.ioc?.get?.<LayerDeckDrone>(LAYER_DECK_KEY)?.detach(this)
  }
}

export class LayerDeckDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override listens = [
    'layer:deck-open', 'layer:deck-close', 'view-toggles:changed', 'lanes:changed',
    MOBILE_MODE_EFFECT, 'view:active',
  ]
  protected override emits = [
    'view:toggle', 'feature:apply', 'camera:capture-open', 'tags:view-open',
    'keymap:invoke', 'lanes:step', 'lanes:set',
  ]

  #registered = false
  #bound = false
  #element: HTMLElement | null = null
  #open = false
  /** True while we hold the synthetic history entry that catches BACK. */
  #historyTrap = false
  #toggles: ViewToggle[] = []
  #lanes: Lanes = {}
  #fileInput: HTMLInputElement | null = null
  #resizeQueued = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register(LAYER_DECK_KEY, this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    // The disc's tap. A second tap on the disc that opened it closes it —
    // a sheet a button can open but not close is a trap.
    this.onEffect('layer:deck-open', () => { this.#open ? this.close() : this.open() })
    this.onEffect('layer:deck-close', () => this.close())

    // The layer's own views, as ViewBee computes them — recomputed on every
    // lineage change, decoration change and enablement flip, replayed to us.
    this.onEffect<{ toggles?: unknown }>('view-toggles:changed', payload => {
      const list = Array.isArray(payload?.toggles) ? payload.toggles : []
      this.#toggles = list
        .filter((t): t is ViewToggle => !!t && typeof (t as ViewToggle).view === 'string')
        .map(t => ({ ...t }))
      if (this.#open) this.#render()
    })
    this.onEffect<Lanes>('lanes:changed', payload => {
      this.#lanes = { active: payload?.active === true, lanes: Number(payload?.lanes) || undefined }
      if (this.#open) this.#render()
    })
    // The phone stopped being a phone (`/mobile off`, a resize past the
    // gate): the sheet has no business staying up.
    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      if (payload?.active === false) this.close()
    })
    // A view took the screen — from a plate here or anywhere else. Chrome
    // gets out of the way.
    this.onEffect<{ active?: boolean }>('view:active', payload => {
      if (payload?.active === true) this.close()
    })

    window.addEventListener('keydown', this.#onKeyDown, true)
    // The BACK button is what a phone user presses to leave a sheet.
    window.addEventListener('popstate', this.#onPopState)
  }

  /** Called by the element when the registry mounts it. */
  attach(el: HTMLElement): void {
    this.#element = el
    if (this.#open) this.#render()
  }

  detach(el: HTMLElement): void {
    if (this.#element === el) this.#element = null
  }

  /** Is the sheet up? */
  get open_(): boolean { return this.#open }

  open(): void {
    if (this.#open) return
    // Phone only, by the one definition — and never under a view: the bar
    // that opens this is hidden there, and a sheet over a takeover would be
    // chrome the takeover did not ask for.
    if (!this.#mobile()) return
    const modes = window.ioc?.get?.<ModesShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (modes?.isActive?.('view:active')) return
    const el = this.#element ?? (document.querySelector(LAYER_DECK_SURFACE) as HTMLElement | null)
    if (!el) return
    this.#element = el
    this.#open = true
    this.#render()
    // One synthetic entry so the hardware/browser BACK button closes the
    // sheet instead of walking the hive out from under it. Popped in close().
    try {
      window.history.pushState({ hcLayerDeck: true }, '')
      this.#historyTrap = true
    } catch { /* history unavailable — the other close paths still work */ }
    window.addEventListener('resize', this.#onResize)
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    window.removeEventListener('resize', this.#onResize)
    const el = this.#element
    if (el) {
      el.replaceChildren()
      el.style.display = 'none'
      el.style.pointerEvents = 'none'
    }
    // Drop our synthetic entry so the history stack is exactly as we found
    // it. Guard first: when BACK is what closed us the entry is already gone,
    // and a second back() would leave the page.
    if (this.#historyTrap) {
      this.#historyTrap = false
      try { window.history.back() } catch { /* noop */ }
    }
  }

  #onPopState = (): void => {
    if (!this.#open) return
    this.#historyTrap = false
    this.close()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#open || e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.close()
  }

  /** A rotation changes the row count (one row across in landscape, two in
   *  portrait) — rebuild on the same page. Coalesced to a frame. */
  #onResize = (): void => {
    if (this.#resizeQueued) return
    this.#resizeQueued = true
    requestAnimationFrame(() => {
      this.#resizeQueued = false
      if (this.#open) this.#render()
    })
  }

  // ── DOM ────────────────────────────────────────────────────

  #render(): void {
    const el = this.#element
    if (!el || !this.#open) return
    installAppDeckCss(LAYER_DECK_SURFACE)
    // Rebuilding on a live sheet (a rung change, a rotation) must land on the
    // page it was on.
    const page = appDeckPage(el.querySelector('[data-role="app-deck"]'))
    el.replaceChildren()
    el.style.display = 'block'
    el.style.pointerEvents = 'auto'

    // A tap outside is the way out. The backdrop is a sibling of the sheet,
    // so a tap inside never reaches it.
    const backdrop = document.createElement('div')
    backdrop.dataset['role'] = 'backdrop'
    backdrop.style.cssText = `position:absolute;inset:0;background:${BACKDROP};`
    backdrop.addEventListener('click', () => this.close())
    el.appendChild(backdrop)

    const landscape = window.matchMedia?.('(orientation: landscape)')?.matches === true
    const sheet = document.createElement('div')
    sheet.dataset['role'] = 'sheet'
    sheet.style.cssText =
      // A BOTTOM SHEET, docked above the bar: the bar publishes what it
      // occupies (`--hc-controls-*`, 0px where it does not), so the bar's
      // discs stay where the hand left them and the sheet takes the rest.
      'position:absolute;left:var(--hc-controls-left,0px);right:var(--hc-controls-right,0px);' +
      'bottom:calc(var(--hc-controls-bottom,0px) + env(safe-area-inset-bottom,0px));' +
      // The sheet's ceiling: the phone-sheet rule in portrait; taller on a
      // landscape phone, whose 62vh is ~240px — less than one row of plates
      // with its dots and dock, which would put the close plate behind a
      // scroll. One row must land whole.
      `max-height:${landscape ? 'min(86vh,30rem)' : 'min(62vh,30rem)'};` +
      'overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;' +
      `box-sizing:border-box;background:${SHEET_BG};border-top:1px solid ${SHEET_EDGE};` +
      'border-radius:var(--hc-radius-floating,4px) var(--hc-radius-floating,4px) 0 0;' +
      'padding:0.8rem max(0.9rem,env(safe-area-inset-right,0px)) 0.8rem max(0.9rem,env(safe-area-inset-left,0px));' +
      `display:flex;flex-direction:column;align-items:stretch;gap:${TIGHT_GAP};` +
      'font-family:inherit;color:rgba(233,240,246,0.92);'
    sheet.setAttribute('data-consumes-wheel', '')

    const heading = document.createElement('div')
    heading.dataset['role'] = 'deck-heading'
    heading.style.cssText =
      'display:flex;align-items:baseline;justify-content:space-between;gap:0.6rem;width:100%;'
    const title = document.createElement('div')
    title.textContent = this.#t('layer-deck.title', 'views')
    title.style.cssText =
      `font-size:0.8rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${STEEL};`
    heading.appendChild(title)
    const here = document.createElement('div')
    const segments = this.#segments()
    here.textContent = segments[segments.length - 1] ?? ''
    here.style.cssText =
      `font-size:0.8rem;font-weight:600;color:${DIM};min-width:0;overflow:hidden;` +
      'text-overflow:ellipsis;white-space:nowrap;'
    heading.appendChild(here)
    sheet.appendChild(heading)

    sheet.appendChild(buildAppDeck({
      groups: this.#groups(),
      dock: [this.#closeChip()],
      onActivate: chip => { chip.run?.() },
      t: (key, fallback) => this.#t(key, fallback),
      page,
      cols: landscape ? APP_LANDSCAPE_COLS : APP_COLS,
      rows: landscape ? APP_LANDSCAPE_ROWS : APP_ROWS,
    }))
    el.appendChild(sheet)
  }

  // ── the three groups ───────────────────────────────────────

  #groups(): AppDeckGroup[] {
    const groups: AppDeckGroup[] = []
    const openAs = this.#openAsChips()
    if (openAs.length) groups.push({ title: this.#t('layer-deck.open-as', 'open as'), chips: openAs })
    groups.push({ title: this.#t('layer-deck.add-here', 'add here'), chips: this.#addHereChips() })
    groups.push({ title: this.#t('layer-deck.see', 'see'), chips: this.#seeChips() })
    return groups
  }

  /** OPEN AS — the layer's views, one plate each, the default accented. */
  #openAsChips(): AppChip[] {
    const registry = this.#registry()
    return this.#toggles.map(toggle => {
      const bee = registry?.get?.(toggle.view)
      return {
        action: `view-toggle:${toggle.view}`,
        glyph: toggle.icon || bee?.toggleIcon || 'visibility',
        labelKey: bee?.labelKey ?? '',
        fallback: toggle.label || toggle.view,
        accent: toggle.isDefault === true,
        run: () => {
          // Close FIRST: the view's own BACK trap (if it pushes one) must sit
          // above a clean stack, not above ours.
          this.close()
          EffectBus.emit('view:toggle', { view: toggle.view, mode: 'on' })
        },
      }
    })
  }

  /** ADD HERE — attachable behaviours this layer lacks, then the two ways to
   *  fill a layer with pictures. */
  #addHereChips(): AppChip[] {
    const chips: AppChip[] = []
    const segments = this.#segments()
    // At the root there is no tile to mark: the behaviours have no target
    // there, the camera and the library still do.
    if (segments.length > 0) {
      const carried = new Set(this.#toggles.map(t => t.view))
      for (const bee of this.#attachableBees()) {
        if (carried.has(bee.view)) continue
        chips.push({
          action: `feature:apply:${bee.view}`,
          glyph: bee.toggleIcon || 'add_box',
          labelKey: bee.labelKey ?? '',
          fallback: bee.view,
          backingKey: bee.queenKey,
          run: () => {
            EffectBus.emit('feature:apply', { view: bee.view, segments: [...segments], remove: false })
            this.close()
          },
        })
      }
    }
    chips.push({
      action: 'camera',
      glyph: 'photo_camera',
      labelKey: 'layer-deck.camera',
      fallback: 'camera',
      run: () => {
        this.close()
        EffectBus.emit('camera:capture-open', {})
      },
    })
    chips.push({
      action: 'library',
      glyph: 'add_photo_alternate',
      labelKey: 'layer-deck.library',
      fallback: 'library',
      run: () => this.#pickFromLibrary(),
    })
    return chips
  }

  /** SEE — how you see the layer. Lenses, never commits. */
  #seeChips(): AppChip[] {
    const chips: AppChip[] = []
    const lanes = Number(this.#lanes.lanes) || LANES_FULL
    chips.push({
      action: 'lanes',
      glyph: 'view_column',
      badge: String(lanes),
      labelKey: 'layer-deck.lanes',
      fallback: 'lanes',
      run: () => {
        // 3 → 2 → 1 → 3. The projection publishes `lanes:changed` and the
        // sheet re-renders with the new digit; it stays up so the rung can
        // be walked without reopening.
        if (lanes <= 1) EffectBus.emit('lanes:set', { lanes: LANES_FULL })
        else EffectBus.emit('lanes:step', { dir: -1 })
      },
    })
    if (document.fullscreenEnabled) {
      const on = !!document.fullscreenElement
      chips.push({
        action: 'fullscreen',
        glyph: on ? 'fullscreen_exit' : 'fullscreen',
        labelKey: 'controls.fullscreen',
        fallback: 'fullscreen',
        run: () => {
          this.close()
          if (document.fullscreenElement) void document.exitFullscreen?.()
          else void document.documentElement.requestFullscreen?.()
        },
      })
    }
    chips.push({
      action: 'pheromones',
      glyph: 'label',
      labelKey: 'layer-deck.pheromones',
      fallback: 'pheromones',
      run: () => {
        this.close()
        EffectBus.emit('tags:view-open', {})
      },
    })
    // The sheet stays up for undo/redo: the hive above it shows the step,
    // and a second step should not cost reopening.
    chips.push({
      action: 'undo',
      glyph: 'undo',
      labelKey: 'controls.undo',
      fallback: 'undo',
      run: () => { EffectBus.emit('keymap:invoke', { cmd: 'history.undo' }) },
    })
    chips.push({
      action: 'redo',
      glyph: 'redo',
      labelKey: 'controls.redo',
      fallback: 'redo',
      run: () => { EffectBus.emit('keymap:invoke', { cmd: 'history.redo' }) },
    })
    return chips
  }

  #closeChip(): AppChip {
    return {
      action: 'close',
      glyph: 'arrow_back',
      labelKey: 'layer-deck.close',
      fallback: 'close',
      run: () => this.close(),
    }
  }

  // ── the library ────────────────────────────────────────────

  /** A hidden file input, made once, clicked from the plate's own tap (the
   *  gesture a browser requires). Every picked image goes through the same
   *  seam the camera shutter uses, one after another. */
  #pickFromLibrary(): void {
    let input = this.#fileInput
    if (!input || !input.isConnected) {
      input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,video/*'
      input.multiple = true
      input.setAttribute('data-hc-layer-deck-library', '')
      input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;'
      input.addEventListener('change', () => {
        const files = Array.from(input!.files ?? [])
        input!.value = ''
        this.close()
        void this.#intake(files)
      })
      document.body.appendChild(input)
      this.#fileInput = input
    }
    input.click()
  }

  async #intake(files: File[]): Promise<void> {
    const paste = window.ioc?.get?.<ImagePasteShape>('@diamondcoreprocessor.com/ImagePasteWorker')
    if (!paste?.createTileFromImage) return
    for (const file of files) {
      // The seam is the image editor's: it decodes what it is handed. A video
      // is accepted by the picker so a mixed selection is not refused at the
      // door, but it has no tile-making path here yet — skipped, said once.
      if (!file.type.startsWith('image/')) {
        console.warn('[layer-deck] library: no tile path for', file.type, file.name)
        continue
      }
      try { await paste.createTileFromImage(file) } catch (err) {
        console.warn('[layer-deck] library: could not make a tile from', file.name, err)
      }
    }
  }

  // ── reads ──────────────────────────────────────────────────

  #registry(): VisualBeeRegistry | undefined {
    return window.ioc?.get?.<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  }

  #attachableBees(): VisualBeeDescriptor[] {
    return (this.#registry()?.forPlatform?.('mobile') ?? []).filter(bee =>
      bee.attachable === true &&
      bee.adoptable !== false &&
      bee.behavior !== 'navigation' &&
      // Globally-off behaviours (the roster lens) are not offered — dormant
      // means gone, not "available to add".
      !isKindGloballyOff(bee.decorationKind),
    )
  }

  #segments(): string[] {
    try {
      const lineage = window.ioc?.get?.<LineageShape>('@hypercomb.social/Lineage')
      return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    } catch { return [] }
  }

  /** Mobile mode per the single source of truth — never a media query. */
  #mobile(): boolean {
    try {
      return window.ioc?.get?.<{ active?: boolean }>(MOBILE_MODE_IOC_KEY)?.active === true
    } catch { return false }
  }

  /** A caption, or the plain-English stand-in. `t()` ECHOES THE KEY BACK when
   *  it cannot resolve one — guard, so no key ever reaches a plate. */
  #t(key: string, fallback: string): string {
    if (!key) return fallback
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      const text = i18n?.t(key)
      return text && text !== key ? text : fallback
    } catch { return fallback }
  }
}

const _layerDeck = new LayerDeckDrone()
window.ioc.register(LAYER_DECK_KEY, _layerDeck)

// Contribute the surface the doctrine way: define the element, then add it
// to the registry — never a template tag in either app.html.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(LAYER_DECK_SURFACE)) {
    customElements.define(LAYER_DECK_SURFACE, LayerDeckElement)
  }
  try {
    registry.add({
      name: LAYER_DECK_SURFACE,
      owner: LAYER_DECK_KEY,
      element: LAYER_DECK_SURFACE,
      order: 700,
    })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

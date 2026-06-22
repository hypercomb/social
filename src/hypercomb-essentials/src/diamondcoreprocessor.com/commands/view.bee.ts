// diamondcoreprocessor.com/commands/view.bee.ts
//
// ViewBee — surfaces the available "view behaviors" for the current node as
// toggleable icons on the right side of the command line, and flips the
// GLOBAL render surface when one is toggled.
//
// A view behavior (see VisualBeeRegistry) is an alternate rendering of the
// tree — e.g. `/website` renders cells as HTML pages instead of the hex
// grid. The render surface is a SINGLE GLOBAL flag (ViewModeService): one
// `/website on` turns websites on everywhere there's a page, one `/website
// off` turns them off, bare `/website` toggles. There is no per-branch
// marker state any more — websites are a global view, and WHICH cells
// actually have a page is decided entirely by the `visual:website:page`
// decorations the build pass writes (independent, signature-addressed,
// undoable resources living on each cell's own layer — no central map, no
// cross-cell dependency).
//
// The command-line toggle is PER-NODE: it appears only on a cell that
// actually HAS a page of the view's kind — i.e. the build pass has written a
// `visual:website:page` decoration on the cell the user is standing on. It is
// deliberately NOT global presence: one page somewhere must not light the
// toggle everywhere, because clicking it on a page-less cell would flip the
// global view to a blank "empty website" screen. This is the same decoration
// SiteViewDrone reads to mount the page, so the toggle shows up exactly where
// the renderer would draw a page and never on a dead end. Clicking it flips
// the global ViewMode; its active state mirrors the flag. The cell's own
// decoration payload supplies the toggle glyph/label so every site keeps its
// distinct icon.
//
// `/website here` (handled in website.queen.ts) is a SEPARATE gesture: it
// drops a `visual:website:pending` decoration on the current cell for the
// NEXT gen pass to pick up. That marker is build-intent, not a render
// surface — it never flips ViewMode and is not what lights this toggle.
//
// Mirrors DashboardBee's shape: registry-owned, lineage-driven, emits over
// EffectBus (`view-toggles:changed`), handles clicks via `view:toggle`.

import { Worker, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry, VisualBeeDescriptor } from './visual-bee-registry.js'

const SIG_RE = /^[0-9a-f]{64}$/
/** Fallback glyph when a view forgets to declare a Material toggleIcon. */
const FALLBACK_TOGGLE_ICON = 'visibility'
/** The render surface websites toggle against. */
const DEFAULT_SURFACE = 'hexagons'

type LineageLike = EventTarget & {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}
type ViewModeLike = EventTarget & {
  mode: string
  is(name: string): boolean
  setMode(next: string): void
  toggle(a?: string, b?: string): string
}
type LayerLike = { decorations?: unknown; context?: unknown; [k: string]: unknown }
/** A parsed decoration record from a cell's `decorations` slot. `payload`
 *  is the bee-specific bag — for the website bee it carries `htmlSig` (the
 *  generated page, read by SiteViewDrone) and optionally `icon` / `label`
 *  (this website's distinct toggle glyph + tooltip, read here). */
type DecorationRecord = { kind: string; payload?: Record<string, unknown> }
type HistoryServiceLike = {
  sign(l: { domain?: () => string; explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
}
type HistoryCursorLike = { currentLayerSig?: string }
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type RegistryLike = Pick<VisualBeeRegistry, 'all' | 'get'>

/** A `behavior: 'navigation'` view's controller (e.g. DashboardBee).
 *  ViewBee resolves it via the descriptor's `controllerKey` and delegates
 *  the toggle's availability, active-state, and click action — instead of
 *  the global-ViewMode flip used for `render` behaviors. */
type NavigationController = {
  isAvailable(): boolean
  isActive(): boolean
  toggleBehavior(): void
}

export type ViewToggle = {
  readonly view: string
  readonly icon: string
  readonly label: string
  readonly active: boolean
}

export class ViewBee extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'view'

  public override description =
    'ViewBee — surfaces available view behaviors (e.g. website) as command-line toggles and flips the global render surface.'

  protected override emits: string[] = ['view-toggles:changed']

  /** Microtask coalescing — a single navigation fires several triggers
   *  (lineage change + render:cell-count + decorations:changed); collapse
   *  them into one async recompute per tick. */
  #pending = false

  protected override act = async (): Promise<void> => {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', () => this.#schedule())

    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    vm?.addEventListener?.('change', () => this.#schedule())

    // Decoration hydration + live decoration mutations can change which
    // views are available — recompute on both. (When the build skill writes
    // pages, `decorations:changed` populates the kind index, and this makes
    // the toggle appear without a navigation.)
    EffectBus.on('render:cell-count', () => this.#schedule())
    EffectBus.on('decorations:changed', () => this.#schedule())

    // A navigation behavior (the dashboard) was minted / opened / closed —
    // its toggle's availability or active-state may have changed.
    EffectBus.on('dashboard:state', () => this.#schedule())

    // Command-line click and the `/website` slash command both arrive here.
    // A `navigation` behavior delegates to its controller (open/close a
    // lineage); a `render` behavior flips the GLOBAL ViewMode directly. There
    // is no marker round-trip any more — the surface is one global flag, so
    // `setMode` sticks (no recompute reverts it).
    //
    //   plain click / bare `/website`        → mode 'toggle': flip hex ⇄ view
    //   `/website on`                         → mode 'on': force the view on
    //   cmd|long-press click / `/website off` → off / disable: back to hexagons
    EffectBus.on<{ view?: string; mode?: 'on' | 'off' | 'toggle'; disable?: boolean }>('view:toggle', ({ view, mode, disable }) => {
      if (!view) return
      const registry = get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')
      const desc = registry?.get?.(view)
      if (desc?.behavior === 'navigation') {
        const controller = desc.controllerKey ? get<NavigationController>(desc.controllerKey) : undefined
        controller?.toggleBehavior?.()
        return
      }
      const vmNow = get<ViewModeLike>('@hypercomb.social/ViewMode')
      if (!vmNow) return
      if (disable || mode === 'off') vmNow.setMode(DEFAULT_SURFACE)
      else if (mode === 'on') vmNow.setMode(view)
      else vmNow.toggle(DEFAULT_SURFACE, view)
      this.#schedule()
    })

    // First paint — without this the toggles wouldn't appear until the
    // first navigation/render event after boot.
    this.#schedule()
  }

  #schedule(): void {
    if (this.#pending) return
    this.#pending = true
    queueMicrotask(() => {
      this.#pending = false
      void this.#recompute()
    })
  }

  async #recompute(): Promise<void> {
    const registry = get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    const views = (registry?.all?.() ?? []) as VisualBeeDescriptor[]
    if (!views.length || !vm) { this.#emit([]); return }

    const layer = await this.#currentNodeLayer()
    const records = await this.#decorationRecords(layer)

    const toggles: ViewToggle[] = []
    for (const v of views) {
      if (!v?.view) continue

      // Navigation behaviors (e.g. the dashboard) are not render surfaces —
      // availability and active-state come from a controller bee, and the
      // toggle navigates rather than switching ViewMode. Delegate and skip
      // the decoration/ViewMode machinery entirely.
      if (v.behavior === 'navigation') {
        const controller = v.controllerKey ? get<NavigationController>(v.controllerKey) : undefined
        if (!controller?.isAvailable?.()) continue
        toggles.push({
          view: v.view,
          icon: v.toggleIcon || FALLBACK_TOGGLE_ICON,
          label: v.view,
          active: !!controller.isActive?.(),
        })
        continue
      }

      // Render behavior. The toggle is PER-NODE: surface it only when THIS
      // cell actually carries the view's content, so flipping the global
      // surface always mounts something (never a blank "empty view" screen).
      // The `/website`-style slash command stays the escape hatch to turn the
      // global view off from anywhere. A cell "has" the content via either:
      //   • a FIRST-CLASS SLOT (v.slot) holding a non-empty signature array —
      //     the doctrine-pure home (tutor's deck items live here), OR
      //   • a `visual:*:page`-style decoration of v.decorationKind — the
      //     legacy/website path, which also supplies a per-instance icon/label.
      let present = false
      let payloadIcon = ''
      let payloadLabel = ''

      if (v.slot) {
        const slotVal = layer ? (layer as Record<string, unknown>)[v.slot] : undefined
        if (Array.isArray(slotVal) && slotVal.some(s => typeof s === 'string' && SIG_RE.test(s))) present = true
      }
      if (!present && v.decorationKind) {
        const record = records.find(r => r.kind === v.decorationKind)
        if (record) {
          present = true
          // This cell's own decoration payload supplies its distinct icon /
          // label tooltip (every website keeps its own glyph). Falls back to
          // the view's static `toggleIcon`, then the generic glyph.
          const payload = record.payload
          payloadIcon = typeof payload?.['icon'] === 'string' ? (payload['icon'] as string).trim() : ''
          payloadLabel = typeof payload?.['label'] === 'string' ? (payload['label'] as string).trim() : ''
        }
      }
      if (!present) continue

      toggles.push({
        view: v.view,
        icon: payloadIcon || v.toggleIcon || FALLBACK_TOGGLE_ICON,
        label: payloadLabel || v.view,
        active: vm.is(v.view),
      })
    }
    this.#emit(toggles)
  }

  /** The node the user is currently sitting on. Reads the node's own layer
   *  authoritatively so it stays correct on a deep-link where the
   *  decoration-kind index hasn't hydrated yet. Prefers the warm cursor
   *  layer sig; falls back to signing the path. */
  async #currentNodeLayer(): Promise<LayerLike | null> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    const cursorSig = get<HistoryCursorLike>('@diamondcoreprocessor.com/HistoryCursorService')?.currentLayerSig
    if (cursorSig && SIG_RE.test(cursorSig)) {
      const layer = await history.getLayerBySig(cursorSig).catch(() => null)
      if (layer) return layer
    }
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return null
    return history.currentLayerAt(locSig).catch(() => null)
  }

  /** Parsed decoration records on the layer's `decorations` slot. Used here
   *  only for the per-view payload (the website's `icon` / `label`) when the
   *  user is standing on a decorated cell. */
  async #decorationRecords(layer: LayerLike | null): Promise<DecorationRecord[]> {
    const out: DecorationRecord[] = []
    const decorations = Array.isArray(layer?.decorations) ? layer!.decorations as unknown[] : []
    if (!decorations.length) return out
    const store = get<StoreLike>('@hypercomb.social/Store')
    for (const sig of decorations) {
      if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
      const rec = await this.#fetchRecord(store, sig)
      if (rec) out.push(rec)
    }
    return out
  }

  async #fetchRecord(store: StoreLike | undefined, sig: string): Promise<DecorationRecord | null> {
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      if (!blob) return null
      const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: Record<string, unknown> }
      if (typeof rec?.kind !== 'string') return null
      return { kind: rec.kind, payload: rec.payload }
    } catch { return null }
  }

  #emit(toggles: ViewToggle[]): void {
    EffectBus.emit('view-toggles:changed', { toggles })
  }
}

const _viewBee = new ViewBee()
window.ioc.register('@diamondcoreprocessor.com/ViewBee', _viewBee)

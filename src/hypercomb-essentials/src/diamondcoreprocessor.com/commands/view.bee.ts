// diamondcoreprocessor.com/commands/view.bee.ts
//
// ViewBee — surfaces the available "view behaviors" for the current node
// as toggleable icons on the right side of the command line.
//
// A view behavior (see VisualBeeRegistry) is an alternate rendering of the
// same branch — e.g. `/website` renders the layer tree as HTML pages
// instead of the hex grid. Each registered view declares a Material
// `toggleIcon`. When the node the user is sitting on carries a decoration
// of that view's kind (i.e. the branch was built as a website), this bee
// emits a toggle descriptor; the command line renders it as a stateful
// on/off icon. Clicking it flips the active view.
//
// Scope (MVP): the toggle drives the GLOBAL ViewModeService (hexagons ⇄
// <view>) — behaviorally identical to per-branch while a single view
// branch exists, because the icon only appears INSIDE that branch. The
// planned follow-up is per-branch "effective mode" (toggle from the
// installed top, cascading down, peers independent): it swaps the
// render-gate input in show-cell / site-view from the global mode to an
// effective-mode resolver keyed by an out-of-layer per-branch marker.
// Until then the icon is a contextual shortcut for the existing /website
// toggle.
//
// Mirrors DashboardBee's shape: registry-owned, lineage-driven, emits over
// EffectBus (`view-toggles:changed`), handles clicks via `view:toggle`.

import { Worker, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry, VisualBeeDescriptor } from './visual-bee-registry.js'

const SIG_RE = /^[0-9a-f]{64}$/
/** Fallback glyph when a view forgets to declare a Material toggleIcon. */
const FALLBACK_TOGGLE_ICON = 'visibility'

type LineageLike = EventTarget & {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}
type ViewModeLike = EventTarget & {
  mode: string
  is(name: string): boolean
  toggle(a?: string, b?: string): string
}
type LayerLike = { decorations?: unknown; context?: unknown; [k: string]: unknown }
type HistoryServiceLike = {
  sign(l: { domain?: () => string; explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
}
type HistoryCursorLike = { currentLayerSig?: string }
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type RegistryLike = Pick<VisualBeeRegistry, 'all'>

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
    'ViewBee — surfaces available view behaviors (e.g. website) for the current node as toggleable command-line icons.'

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
    // views are available at the current node — recompute on both.
    EffectBus.on('render:cell-count', () => this.#schedule())
    EffectBus.on('decorations:changed', () => this.#schedule())

    // Command-line click → flip the view. ViewMode's 'change' re-triggers
    // a recompute so the toggle's active state updates.
    EffectBus.on<{ view?: string }>('view:toggle', ({ view }) => {
      if (!view) return
      get<ViewModeLike>('@hypercomb.social/ViewMode')?.toggle?.('hexagons', view)
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
    const kinds = await this.#decorationKinds(layer)

    // Legacy website pages live in the `context` slot rather than as a
    // `visual:website:page` decoration. Mirror SiteViewDrone's fallback so
    // the toggle appears for un-migrated sites too — i.e. the toggle shows
    // exactly when the renderer would render a page. Computed lazily (only
    // when a view lacks a decoration) so we don't head-sniff context
    // resources on every navigation.
    let contextChecked = false
    let contextHasPage = false
    const contextPageAvailable = async (): Promise<boolean> => {
      if (!contextChecked) { contextChecked = true; contextHasPage = await this.#contextHasHtmlPage(layer) }
      return contextHasPage
    }

    const toggles: ViewToggle[] = []
    for (const v of views) {
      if (!v?.view) continue
      let available = !!v.decorationKind && kinds.has(v.decorationKind)
      if (!available && v.view === 'website') available = await contextPageAvailable()
      if (!available) continue
      toggles.push({
        view: v.view,
        icon: v.toggleIcon || FALLBACK_TOGGLE_ICON,
        label: v.view,
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

  /** Decoration kinds present on the layer's `decorations` slot. The
   *  general availability signal — works for any registered view. */
  async #decorationKinds(layer: LayerLike | null): Promise<Set<string>> {
    const out = new Set<string>()
    const decorations = Array.isArray(layer?.decorations) ? layer!.decorations as unknown[] : []
    if (!decorations.length) return out
    const store = get<StoreLike>('@hypercomb.social/Store')
    for (const sig of decorations) {
      if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
      const kind = await this.#fetchKind(store, sig)
      if (kind) out.add(kind)
    }
    return out
  }

  /** True when the layer's legacy `context` slot holds an HTML-shaped
   *  resource — i.e. SiteViewDrone would render a page here. Mirrors the
   *  head probe in site-view.drone.ts #findContextPage. */
  async #contextHasHtmlPage(layer: LayerLike | null): Promise<boolean> {
    const context = Array.isArray(layer?.context) ? layer!.context as unknown[] : []
    if (!context.length) return false
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return false
    for (const sig of context) {
      if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
      try {
        const blob = await store.getResource(sig)
        if (!blob) continue
        const head = await blob.slice(0, 64).text()
        if (/^\s*(?:﻿)?(<!doctype|<html|<svg|<\?xml)/i.test(head)) return true
      } catch { /* skip malformed */ }
    }
    return false
  }

  async #fetchKind(store: StoreLike | undefined, sig: string): Promise<string | null> {
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      if (!blob) return null
      const rec = JSON.parse(await blob.text()) as { kind?: string }
      return typeof rec?.kind === 'string' ? rec.kind : null
    } catch { return null }
  }

  #emit(toggles: ViewToggle[]): void {
    EffectBus.emit('view-toggles:changed', { toggles })
  }
}

const _viewBee = new ViewBee()
window.ioc.register('@diamondcoreprocessor.com/ViewBee', _viewBee)

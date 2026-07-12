// diamondcoreprocessor.com/presentation/tiles/home-view.drone.ts
//
// Full-viewport HOME takeover — the homely analogue of SiteViewDrone /
// TutorViewDrone. When ViewMode is 'home', the current cell's area renders
// as a warm home surface instead of the hex grid: a greeting header, and
// the cell's children laid out as cards. A child carrying a
// `visual:home:widget` decoration renders through the home-widget registry
// (welcome card, collections starter, portal…); any other child renders as
// a doorway card into that tile. Same tiles, different render — the
// behavior a tile wears decides what it becomes.
//
// When the area is empty, the view guides: an invitation to seed starter
// widget tiles (created as ordinary child tiles with the widget decoration
// baked into the same commit) and to start a first collection.
//
// Mirrors TutorViewDrone's lifecycle (lineage + ViewMode listeners,
// idempotent heartbeat, fixed host below the Pixi layer, `view:active`
// canvas/chrome hiding — zero shell edits). Exits: Escape, right-click,
// or the header's exit button — all back to hexagons.

import { Drone, EffectBus, I18N_IOC_KEY } from '@hypercomb/core'
import { childNamesOf } from '../../history/layer-placement.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { HOME_PAGE_KIND } from '../../commands/home.queen.js'
import {
  HOME_WIDGET_KIND, homeWidgetRenderer,
  HOME_INK, HOME_TEXT, HOME_DIM, HOME_STEEL, HOME_CARD_BG, HOME_CARD_BORDER,
  type HomeWidgetContext,
} from './home-widgets.js'

const HOME_VIEW = 'home'
const SIG = /^[0-9a-f]{64}$/

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type I18nShape = { t(key: string, params?: Record<string, string | number>): string }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}
type CursorShape = { refreshForLocation?(sig: string): Promise<void>; jumpToLatest?(): void }
type CommitterShape = {
  commitChildrenDeltas(
    segments: readonly string[],
    changes: { removes?: readonly { sig?: string; label?: string }[]; appends?: readonly string[] },
  ): Promise<void>
}
type StoreShape = {
  hypercombRoot?: unknown
  getResource(sig: string): Promise<Blob | null>
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
}

type ChildCard = {
  name: string
  segments: string[]
  /** Present when the child wears a `visual:home:widget` decoration. */
  widget?: Record<string, unknown>
}

type MountState = {
  host: HTMLDivElement
  /** Identity of the mounted content — skip remount when unchanged. */
  contentKey: string
  cleanups: Array<() => void>
}

export class HomeViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport home takeover. When ViewMode is "home", the current cell renders as a warm home surface — children become widgets and doorways.'

  #mount: MountState | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #contextMenuBound = false
  #keyBound = false
  #effectsBound = false
  /** Guards re-entrant async reconciles; a queued flag coalesces bursts. */
  #reconciling = false
  #queued = false

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/HomeViewDrone', this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<EventTarget & { addEventListener?: typeof EventTarget.prototype.addEventListener }>('lineage')
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', this.#onChange)
        this.#lineageBound = true
      }
    }
    if (!this.#viewModeBound) {
      const vm = this.#vm()
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#contextMenuBound) {
      // Right-click anywhere in home mode = exit back to hexagons (tutor
      // precedent). Capture phase; inert in every other mode.
      window.addEventListener('contextmenu', this.#onContextMenu, true)
      this.#contextMenuBound = true
    }
    if (!this.#keyBound) {
      // Escape = exit. WebsiteNavComponent only covers mode 'website', so the
      // home view owns its own escape. Capture + stopImmediatePropagation so
      // the global escape cascade never sees it while home is up.
      window.addEventListener('keydown', this.#onKeyDown, true)
      this.#keyBound = true
    }
    if (!this.#effectsBound) {
      // Keep the surface fresh when tiles/decorations change under it.
      this.onEffect('decorations:changed', () => { void this.#reconcile() })
      this.onEffect('cell:added', () => { void this.#reconcile() })
      this.onEffect('cell:removed', () => { void this.#reconcile() })
      // Hide / restore in the Beehaviors panel turns this behaviour off / back on.
      this.onEffect('feature:hidden', () => { void this.#reconcile() })
      this.onEffect('feature:restored', () => { void this.#reconcile() })
      this.#effectsBound = true
    }
    void this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<EventTarget & { removeEventListener?: typeof EventTarget.prototype.removeEventListener }>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) lineage.removeEventListener('change', this.#onChange)
    const vm = this.#vm()
    if (this.#viewModeBound && vm?.removeEventListener) vm.removeEventListener('change', this.#onChange)
    if (this.#contextMenuBound) window.removeEventListener('contextmenu', this.#onContextMenu, true)
    if (this.#keyBound) window.removeEventListener('keydown', this.#onKeyDown, true)
    this.#teardown()
  }

  // ── reactivity ─────────────────────────────────────────────

  readonly #onChange = (): void => { void this.#reconcile() }

  readonly #onContextMenu = (e: MouseEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== HOME_VIEW) return
    e.preventDefault()
    vm.setMode('hexagons')
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    const vm = this.#vm()
    if (!vm || vm.mode !== HOME_VIEW) return
    e.preventDefault()
    e.stopImmediatePropagation()
    vm.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  #history(): HistoryShape | undefined {
    return window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = window.ioc?.get<I18nShape>(I18N_IOC_KEY)
    const value = i18n?.t?.(key, params)
    return value && value !== key ? value : fallback
  }

  // ── reconcile / mount ──────────────────────────────────────

  async #reconcile(): Promise<void> {
    if (this.#reconciling) { this.#queued = true; return }
    this.#reconciling = true
    try {
      const vm = this.#vm()
      if (!vm || vm.mode !== HOME_VIEW) { this.#teardown(); return }

      const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
      const store = this.resolve<StoreShape>('store')
      const history = this.#history()
      if (!lineage || !store?.getResource || !history) return

      const segments: string[] = [...(lineage.explorerSegments?.() ?? [])]
      // Honor the Beehaviors panel's off switch (hidden-pool gate, as SiteView).
      if (await isFeatureHidden(segments, HOME_PAGE_KIND)) { this.#teardown(); return }
      const cards = await this.#collectChildren(segments, history, store)
      if (this.#vm()?.mode !== HOME_VIEW) { this.#teardown(); return } // mode flipped mid-read

      const contentKey = segments.join('/') + '||' +
        cards.map(c => c.name + ':' + (c.widget ? JSON.stringify(c.widget) : '')).join('|')
      if (this.#mount && this.#mount.contentKey === contentKey) return
      this.#mountHome(segments, cards, contentKey)
    } finally {
      this.#reconciling = false
      if (this.#queued) { this.#queued = false; void this.#reconcile() }
    }
  }

  /** The home cell's children, each with its current `visual:home:widget`
   *  decoration payload when it wears one. Names come from the parent layer;
   *  each child's CURRENT layer is read at its own location sig (leaf-only
   *  commits — the parent's child sigs may be older links). */
  async #collectChildren(
    segments: readonly string[],
    history: HistoryShape,
    store: StoreShape,
  ): Promise<ChildCard[]> {
    const cards: ChildCard[] = []
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return cards
      const names = await childNamesOf(history, layer as Parameters<typeof childNamesOf>[1])
      for (const name of names) {
        const childSegments = [...segments, name]
        const card: ChildCard = { name, segments: childSegments }
        try {
          const childSig = await history.sign({ explorerSegments: () => childSegments })
          const childLayer = await history.currentLayerAt(childSig)
          const decorationSigs = Array.isArray(childLayer?.['decorations'])
            ? (childLayer['decorations'] as unknown[]).map(s => String(s)).filter(s => SIG.test(s))
            : []
          for (const sig of decorationSigs) {
            const blob = await store.getResource(sig)
            if (!blob) continue
            try {
              const record = JSON.parse(await blob.text()) as { kind?: string; payload?: Record<string, unknown> }
              if (record?.kind === HOME_WIDGET_KIND) {
                card.widget = record.payload ?? {}
                break
              }
            } catch { /* malformed record — skip */ }
          }
        } catch { /* cold child read — render as a plain doorway */ }
        cards.push(card)
      }
    } catch { /* cold read — render the guide over an empty area */ }
    return cards
  }

  // ── DOM ────────────────────────────────────────────────────

  #mountHome(segments: readonly string[], cards: ChildCard[], contentKey: string): void {
    this.#teardown()

    const host = document.createElement('div')
    host.id = 'hc-home-view-host'
    host.style.cssText =
      `position:fixed;inset:0;z-index:59988;overflow:auto;background:${HOME_INK};` +
      `color:${HOME_TEXT};font-family:inherit;`
    // Opt out of the always-on hex wheel-zoom handler so the page scrolls.
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    const cleanups: Array<() => void> = []
    const inner = document.createElement('div')
    inner.style.cssText = 'max-width:960px;margin:0 auto;padding:56px 32px 96px;box-sizing:border-box;'
    host.appendChild(inner)

    inner.appendChild(this.#header(segments))

    const widgetCards = cards.filter(c => c.widget)
    if (cards.length === 0) {
      inner.appendChild(this.#guide(segments))
    } else {
      inner.appendChild(this.#grid(segments, cards, cleanups))
      // Some tiles but no widgets yet — keep a quiet seeding row available.
      if (widgetCards.length === 0) inner.appendChild(this.#seedRow(segments))
    }

    this.#mount = { host, contentKey, cleanups }
    this.#setViewActive(true)
  }

  #header(segments: readonly string[]): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:36px;'

    const titles = document.createElement('div')
    const name = segments.length ? segments[segments.length - 1] : this.#t('home.title.root', 'your hive')
    const title = document.createElement('div')
    title.style.cssText = `font-size:32px;font-weight:700;color:${HOME_TEXT};margin-bottom:6px;`
    title.textContent = name
    const subtitle = document.createElement('div')
    subtitle.style.cssText = `font-size:14px;line-height:1.6;color:${HOME_DIM};max-width:620px;`
    subtitle.textContent = this.#t('home.subtitle',
      'This is your place. Tiles here are pieces of the design — give them behaviors and they become widgets, doorways, galleries. Whatever you have a behavior for.')
    titles.appendChild(title)
    titles.appendChild(subtitle)

    const exit = document.createElement('button')
    exit.style.cssText =
      `all:unset;cursor:pointer;flex:none;font-size:13px;color:${HOME_DIM};` +
      `padding:6px 12px;border-radius:6px;border:${HOME_CARD_BORDER};`
    exit.textContent = '⬡ ' + this.#t('home.exit', 'back to the hive')
    exit.addEventListener('click', () => this.#vm()?.setMode('hexagons'))
    exit.addEventListener('mouseenter', () => { exit.style.color = HOME_TEXT })
    exit.addEventListener('mouseleave', () => { exit.style.color = HOME_DIM })

    wrap.appendChild(titles)
    wrap.appendChild(exit)
    return wrap
  }

  #grid(segments: readonly string[], cards: ChildCard[], cleanups: Array<() => void>): HTMLElement {
    const grid = document.createElement('div')
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;'

    for (const card of cards) {
      const cell = document.createElement('div')
      cell.style.cssText =
        `background:${HOME_CARD_BG};border:${HOME_CARD_BORDER};border-radius:10px;` +
        'padding:20px;box-sizing:border-box;min-height:96px;'

      if (card.widget) {
        const type = String(card.widget['type'] ?? '')
        const renderer = homeWidgetRenderer(type)
        // Shift+hover zoom for free — WidgetZoomDrone binds any [data-widget].
        cell.setAttribute('data-widget', `home:${type}:${card.name}`)
        cell.setAttribute('data-widget-anchor', 'center')
        if (type === 'collections') cell.style.gridColumn = 'span 2'
        if (renderer) {
          const cleanup = renderer(cell, this.#widgetContext(card))
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        } else {
          cell.appendChild(this.#plainCardContent(card.name,
            this.#t('home.widget.unknown', 'No renderer for widget type "{type}"', { type })))
        }
      } else {
        // A plain child — a doorway. Same tile, no behavior: the flexible
        // default is "click to travel into it".
        cell.style.cursor = 'pointer'
        cell.appendChild(this.#plainCardContent(card.name, this.#t('home.card.open', 'open')))
        cell.addEventListener('click', () => this.#navigate(card.segments))
        cell.addEventListener('mouseenter', () => { cell.style.borderColor = 'rgba(126,182,214,0.45)' })
        cell.addEventListener('mouseleave', () => { cell.style.borderColor = 'rgba(126,182,214,0.18)' })
      }
      grid.appendChild(cell)
    }
    return grid
  }

  #plainCardContent(name: string, hint: string): HTMLElement {
    const wrap = document.createElement('div')
    const title = document.createElement('div')
    title.style.cssText = `font-size:16px;font-weight:600;color:${HOME_TEXT};margin-bottom:6px;`
    title.textContent = name
    const sub = document.createElement('div')
    sub.style.cssText = `font-size:12px;color:${HOME_DIM};`
    sub.textContent = hint
    wrap.appendChild(title)
    wrap.appendChild(sub)
    return wrap
  }

  /** Empty-area invitation: explain the place, offer the starter widgets. */
  #guide(segments: readonly string[]): HTMLElement {
    const panel = document.createElement('div')
    panel.style.cssText =
      `background:${HOME_CARD_BG};border:${HOME_CARD_BORDER};border-radius:12px;` +
      'padding:40px;box-sizing:border-box;text-align:center;'
    const title = document.createElement('div')
    title.style.cssText = `font-size:22px;font-weight:600;color:${HOME_TEXT};margin-bottom:10px;`
    title.textContent = this.#t('home.empty.title', 'Make this place yours')
    const body = document.createElement('div')
    body.style.cssText = `font-size:14px;line-height:1.7;color:${HOME_DIM};max-width:520px;margin:0 auto 24px;`
    body.textContent = this.#t('home.empty.body',
      'Start by adding a widget or two — then create your first collection and begin gathering the things that matter to you.')
    panel.appendChild(title)
    panel.appendChild(body)
    panel.appendChild(this.#seedButtons(segments))
    return panel
  }

  /** Quiet seeding row shown when tiles exist but no widgets do. */
  #seedRow(segments: readonly string[]): HTMLElement {
    const row = document.createElement('div')
    row.style.cssText = 'margin-top:24px;display:flex;align-items:center;gap:12px;'
    const label = document.createElement('span')
    label.style.cssText = `font-size:13px;color:${HOME_DIM};`
    label.textContent = this.#t('home.seed.label', 'Add widgets:')
    row.appendChild(label)
    row.appendChild(this.#seedButtons(segments))
    return row
  }

  #seedButtons(segments: readonly string[]): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:inline-flex;flex-wrap:wrap;gap:10px;justify-content:center;'
    const seeds: Array<{ name: string; type: string; label: string }> = [
      { name: 'welcome', type: 'welcome', label: this.#t('home.action.addWelcome', 'Add a welcome card') },
      { name: 'collections', type: 'collections', label: this.#t('home.action.addCollections', 'Add a collections widget') },
    ]
    for (const seed of seeds) {
      const button = document.createElement('button')
      button.style.cssText =
        `all:unset;cursor:pointer;padding:9px 18px;border-radius:6px;font-size:13px;font-weight:600;` +
        `color:${HOME_INK};background:${HOME_STEEL};`
      button.textContent = seed.label
      button.addEventListener('click', () => { void this.#seedWidget(segments, seed.name, seed.type) })
      wrap.appendChild(button)
    }
    return wrap
  }

  // ── actions ────────────────────────────────────────────────

  #widgetContext(card: ChildCard): HomeWidgetContext {
    return {
      segments: card.segments,
      label: card.name,
      payload: card.widget ?? {},
      exit: () => this.#vm()?.setMode('hexagons'),
      navigate: (target) => this.#navigate(target),
      refresh: () => { if (this.#mount) this.#mount.contentKey = ''; void this.#reconcile() },
      t: (key, fallback, params) => this.#t(key, fallback, params),
    }
  }

  /** Traveling means leaving home — restore hexagons first, then go. */
  #navigate(segments: readonly string[]): void {
    this.#vm()?.setMode('hexagons')
    window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(segments)
  }

  /** Create a child tile wearing a widget decoration — decoration baked into
   *  the same commit (the race-free create+decorate shape from
   *  mixed-group-bag). The child's own bag is fresh (no contention), so its
   *  commit stays direct; the PARENT link rides the LayerCommitter FIFO as a
   *  surgical children append — a direct read-modify-write commitLayer of
   *  the parent would clobber any interleaved FIFO commit's child. */
  async #seedWidget(segments: readonly string[], name: string, type: string): Promise<void> {
    const history = this.#history()
    const store = this.resolve<StoreShape>('store')
    const committer = window.ioc?.get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !store?.putResource || !committer?.commitChildrenDeltas) return
    try {
      const parentSig = await history.sign({ explorerSegments: () => segments })
      const parentLayer = (await history.currentLayerAt(parentSig)) ?? {}
      const existingNames = await childNamesOf(history, parentLayer as Parameters<typeof childNamesOf>[1])
      if (existingNames.includes(name)) {
        EffectBus.emit('activity:log', {
          message: this.#t('home.seed.exists', 'A tile named "{name}" already lives here', { name }), icon: '⌂',
        })
        return
      }

      const record = { kind: HOME_WIDGET_KIND, appliesTo: [], payload: { type } }
      const decorationSig = await store.putResource(
        new Blob([JSON.stringify(record)], { type: 'application/json' }))

      const childSegments = [...segments, name]
      const childSig = await history.sign({ explorerSegments: () => childSegments })
      const childMarkerSig = await history.commitLayer(childSig, { name, decorations: [decorationSig] })
      EffectBus.emit('decorations:changed', { segments: childSegments, op: 'append', sig: decorationSig })

      await committer.commitChildrenDeltas(segments, { appends: [childMarkerSig] })
      EffectBus.emit('cell:added', { cell: name, segments: [...segments], viaUpdate: true })

      window.ioc?.get<{ invalidate?: () => void }>('@hypercomb.social/Lineage')?.invalidate?.()
      const cursor = window.ioc?.get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')
      await cursor?.refreshForLocation?.(parentSig)
      cursor?.jumpToLatest?.()

      if (this.#mount) this.#mount.contentKey = ''
      void this.#reconcile()
    } catch (err) {
      console.warn('[home-view] seeding widget failed', err)
    }
  }

  // ── teardown ───────────────────────────────────────────────

  #teardown(): void {
    if (this.#mount) {
      for (const cleanup of this.#mount.cleanups) {
        try { cleanup() } catch { /* noop */ }
      }
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    this.emitEffect<{ active: boolean }>('view:active', { active })
  }
}

const _homeView = new HomeViewDrone()
window.ioc.register('@diamondcoreprocessor.com/HomeViewDrone', _homeView)

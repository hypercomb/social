// diamondcoreprocessor.com/presentation/tiles/collection-empty-prompt.drone.ts
//
// Empty-state prompt for any layer that legitimately has nothing in it yet.
//
// Two cases, one panel:
//  • a collection's own root page — the /sets landing lets participants create
//    and open collections, and a brand-new one is empty by construction;
//  • ANY tile's layer that has no tiles inside. Holding a childless tile now
//    opens its layer (tile-overlay.drone.ts, hold-to-enter), so participants
//    land on empty layers deliberately and need to be told where they are
//    instead of facing a blank hex field.
//
// Named for the first case it served; it owns the empty-layer message now.

import { EffectBus, I18N_IOC_KEY } from '@hypercomb/core'
import { childNamesOf } from '../../history/layer-placement.js'

const SETS = 'sets'

type ViewModeLike = EventTarget & { mode?: string }

/** Launch-group pages (/games, /websites, …) are aggregator surfaces with
 *  their own empty behaviour — "add a tile here" is the wrong instruction on
 *  one. Resolved live over IoC; modules must not import shared. */
function isLauncherLocation(segments: readonly string[]): boolean {
  if (segments.length !== 1) return false
  if (segments[0]!.startsWith('agg-')) return true
  const registry = ioc()?.get<{ get?: (id: string) => { openDirectly?: boolean } | undefined }>('@hypercomb.social/GroupLauncher')
  const group = registry?.get?.(segments[0]!)
  return !!group && group.openDirectly !== true
}

type CellCountPayload = { count: number; settled?: boolean }
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type I18nLike = { t(key: string, params?: Record<string, string | number>): string }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}

const ioc = (): { get<T = unknown>(key: string): T | undefined } | undefined =>
  (globalThis as { ioc?: { get<T = unknown>(key: string): T | undefined } }).ioc

class CollectionEmptyPromptDrone {
  #host: HTMLDivElement | null = null
  #lineage: LineageLike | null = null
  #lineageBound = false
  #viewModeBound = false
  #lastSettledEmpty = false
  #checkSeq = 0
  /** True while the first-boot EXAMPLE HIVES offer owns the screen. It fires on
   *  exactly our `root` condition (empty hive root, first boot), so the two
   *  cards used to stack. The offer is the single view now: it carries our
   *  "Add a tile" / "Show me how" gestures in its own actions row, and the
   *  `root` variant here is the FALLBACK for when there is no offer (roster
   *  unavailable, or already dismissed). */
  #offerActive = false

  constructor() {
    EffectBus.on<CellCountPayload>('render:cell-count', payload => {
      this.#lastSettledEmpty = payload.count === 0 && payload.settled === true
      void this.#reconcile()
    })
    // Last-value replay: a late subscribe still learns the offer is up.
    EffectBus.on<{ active?: boolean; examples?: unknown[] }>('examples:offer', payload => {
      this.#offerActive = payload?.active === true && (payload?.examples?.length ?? 0) > 0
      void this.#reconcile()
    })
    EffectBus.on('examples:dismiss', () => {
      this.#offerActive = false
      void this.#reconcile()
    })
    // The offer's "Add a tile" delegates here — the command-line focus dance
    // belongs to this module, not to the shell component that renders the card.
    EffectBus.on('hive:empty:add-tile', () => { this.#focusCommandLine() })
    EffectBus.on('cell:added', () => {
      this.#hide()
      this.#lastSettledEmpty = false
    })
    EffectBus.on('cell:removed', () => { void this.#reconcile() })
    window.addEventListener('synchronize', () => { void this.#reconcile() })
    this.#ensureLineage()
    this.#ensureViewMode()
    void this.#reconcile()
  }

  #ensureLineage(): void {
    if (this.#lineageBound) return
    const lineage = ioc()?.get<LineageLike>('@hypercomb.social/Lineage')
    if (!lineage?.addEventListener) return
    this.#lineage = lineage
    lineage.addEventListener('change', () => {
      this.#lastSettledEmpty = false
      this.#hide()
      void this.#reconcile()
    })
    this.#lineageBound = true
  }

  /** A takeover view mounts over the hex surface: the notice must leave with
   *  it and come back when the hexagons do. Bound lazily — ViewMode may not be
   *  registered yet when this module loads. */
  #ensureViewMode(): ViewModeLike | undefined {
    const viewMode = ioc()?.get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (viewMode?.addEventListener && !this.#viewModeBound) {
      viewMode.addEventListener('change', () => { void this.#reconcile() })
      this.#viewModeBound = true
    }
    return viewMode
  }

  #segments(): string[] {
    this.#ensureLineage()
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = ioc()?.get<I18nLike>(I18N_IOC_KEY)
    const value = i18n?.t?.(key, params)
    return value && value !== key ? value : fallback
  }

  async #reconcile(): Promise<void> {
    const seq = ++this.#checkSeq
    const segments = this.#segments()
    // /sets has its own landing, and a takeover view (website, home, slides,
    // tree) hides the hex surface entirely — the emptiness on screen is not the
    // layer's. The EMPTY HIVE ROOT is no longer excluded: it is the first thing
    // a new participant ever sees, and it used to be skipped in favour of "the
    // onboarding path" that was never built. It is now the onboarding path.
    const mode = this.#ensureViewMode()?.mode ?? 'hexagons'
    if (!this.#lastSettledEmpty
      || (segments.length === 1 && segments[0] === SETS)
      || mode !== 'hexagons'
      || isLauncherLocation(segments)) {
      this.#hide()
      return
    }

    // Three variants: the empty hive ROOT (first run — welcome + the tour), a
    // collection's own root, and any other empty layer.
    if (segments.length === 0) {
      if (seq !== this.#checkSeq) return
      // ONE view on first boot: the examples offer already says "your hive is
      // empty" and now carries both of our gestures. Two cards over the same
      // empty root is the conflict, not a richer welcome.
      if (this.#offerActive) { this.#hide(); return }
      this.#show('', 'root')
      return
    }

    const name = segments[segments.length - 1]!
    const isCollection = segments.length === 1 && await this.#isCollectionRoot(name)
    if (seq !== this.#checkSeq) return
    this.#show(name, isCollection ? 'collection' : 'layer')
  }

  async #isCollectionRoot(name: string): Promise<boolean> {
    const history = ioc()?.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history.currentLayerAt) return false
    try {
      const setsSig = await history.sign({ explorerSegments: () => [SETS] })
      const setsLayer = await history.currentLayerAt(setsSig)
      const names = await childNamesOf(history, setsLayer as Parameters<typeof childNamesOf>[1])
      return names.includes(name)
    } catch {
      return false
    }
  }

  #show(name: string, variant: 'root' | 'collection' | 'layer'): void {
    const titleText = variant === 'root'
      ? this.#t('hive.empty.title', 'Your hive is empty')
      : variant === 'collection'
        ? this.#t('collections.empty.title', 'Add your first tile')
        : this.#t('layer.empty.title', 'No tiles yet')
    const bodyText = variant === 'root'
      ? this.#t(
        'hive.empty.body',
        'Everything you keep here lives as a tile — notes, pictures, pages, whole projects. Name your first one, or let the bee show you around.',
      )
      : variant === 'collection'
        ? this.#t(
          'collections.empty.body',
          'Start this collection by naming a tile, dropping a file, or pasting something here.',
          { collection: name },
        )
        : this.#t(
          'layer.empty.body',
          `You are inside "${name}" and nothing has been added here yet. Name a tile, drop a file, or paste something to start it — or go back the way you came.`,
          { cell: name },
        )
    const actionText = this.#t(
      variant === 'collection' ? 'collections.empty.action' : variant === 'root' ? 'hive.empty.action' : 'layer.empty.action',
      'Add a tile',
    )
    // The tour is offered on the FIRST-RUN screen only. It is the one moment a
    // phone user is guaranteed to see it, and the desktop rail's bee button
    // never renders on a phone — so without this the tutorial could only be
    // reached by typing `/tutorial`, i.e. by already knowing how to type.
    const wantsTour = variant === 'root'

    if (this.#host) {
      const title = this.#host.querySelector('[data-role="title"]')
      if (title) title.textContent = titleText
      const body = this.#host.querySelector('[data-role="body"]')
      if (body) body.textContent = bodyText
      const action = this.#host.querySelector('[data-role="action"]')
      if (action) action.textContent = actionText
      // The variant can change under a mounted host (root → layer on the first
      // navigation), so the tour button must come and go with it.
      const tour = this.#host.querySelector('[data-role="tour"]') as HTMLElement | null
      if (tour && !wantsTour) tour.remove()
      else if (!tour && wantsTour) {
        const panel = this.#host.querySelector('[data-role="panel"]')
        panel?.appendChild(this.#tourButton())
      }
      return
    }

    const host = document.createElement('div')
    host.id = 'hc-collection-empty-prompt'
    // Above #pixi-host (z 59989, body-reparented, pointer-events:auto <canvas>
    // inside): anything under it paints fine but has its clicks eaten by the
    // canvas. Same modal tier the shell dialogs use.
    host.style.cssText =
      'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
      'pointer-events:none;padding:24px;box-sizing:border-box;font-family:inherit;'

    const panel = document.createElement('div')
    panel.dataset['role'] = 'panel'
    panel.style.cssText =
      'pointer-events:auto;max-width:360px;text-align:center;border-radius:10px;padding:24px 26px 26px;' +
      'background:rgba(12,17,24,0.78);border:1px solid rgba(126,182,214,0.24);' +
      'box-shadow:0 18px 44px rgba(0,0,0,0.28);backdrop-filter:blur(10px);cursor:pointer;'

    const title = document.createElement('div')
    title.dataset['role'] = 'title'
    title.style.cssText = 'font-size:20px;font-weight:700;color:#d8e6ee;margin-bottom:8px;'
    title.textContent = titleText

    const body = document.createElement('div')
    body.dataset['role'] = 'body'
    body.style.cssText = 'font-size:14px;line-height:1.55;color:rgba(216,230,238,0.66);margin-bottom:18px;'
    body.textContent = bodyText

    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['role'] = 'action'
    button.style.cssText =
      'border:0;border-radius:7px;padding:10px 16px;font:inherit;font-size:14px;font-weight:700;' +
      'color:#0c1118;background:rgb(126,182,214);cursor:pointer;'
    button.textContent = actionText
    const requestFocus = (event: Event): void => this.#focusCommandLine(event)
    button.addEventListener('pointerdown', requestFocus, true)
    button.addEventListener('mousedown', requestFocus, true)
    button.addEventListener('click', requestFocus, true)
    panel.addEventListener('pointerdown', requestFocus, true)
    panel.addEventListener('mousedown', requestFocus, true)
    panel.addEventListener('click', requestFocus, true)

    panel.appendChild(title)
    panel.appendChild(body)
    panel.appendChild(button)
    if (wantsTour) panel.appendChild(this.#tourButton())
    host.appendChild(panel)
    document.body.appendChild(host)
    this.#host = host
  }

  /** "Show me how" — starts the guided tour. The panel's own capture-phase
   *  listeners open the command line for any press inside it, so this button
   *  stops the event first (see the tour bail-out in #focusCommandLine). */
  #tourButton(): HTMLButtonElement {
    const tour = document.createElement('button')
    tour.type = 'button'
    tour.dataset['role'] = 'tour'
    tour.style.cssText =
      'display:block;margin:10px auto 0;border:1px solid rgba(126,182,214,0.45);border-radius:7px;' +
      'padding:10px 16px;font:inherit;font-size:14px;font-weight:600;min-height:44px;' +
      'color:rgb(126,182,214);background:transparent;cursor:pointer;'
    tour.textContent = this.#t('hive.empty.tour', 'Show me how')
    const start = (event: Event): void => {
      event.preventDefault()
      event.stopPropagation()
      this.#hide()
      EffectBus.emit('tutorial:start', {})
    }
    tour.addEventListener('pointerdown', start, true)
    tour.addEventListener('click', start, true)
    return tour
  }

  #hide(): void {
    this.#host?.remove()
    this.#host = null
  }

  #focusCommandLine(event?: Event): void {
    // The panel claims every press inside it, but the tour button owns its own
    // press — without this bail-out the capture-phase panel listener would fire
    // first and open the command line instead of starting the tour.
    const target = event?.target
    if (target instanceof HTMLElement && target.closest('[data-role="tour"]')) return
    event?.preventDefault()
    event?.stopPropagation()
    if (event?.target instanceof HTMLElement) event.target.blur()
    this.#hide()

    const mobile = window.matchMedia('(max-width: 599px), (max-height: 599px)').matches
    EffectBus.emit('mobile:input-visible', { visible: true, mobile })
    EffectBus.emit('command:focus', { cell: '' })
    EffectBus.emit('keymap:invoke', { cmd: 'ui.commandLineToggle' })

    const focusInput = (): void => {
      const input = document.querySelector<HTMLInputElement>('hc-command-shell input.command-input')
      input?.focus({ preventScroll: true })
    }
    queueMicrotask(focusInput)
    requestAnimationFrame(focusInput)
    setTimeout(focusInput, 60)
  }
}

const _collectionEmptyPrompt = new CollectionEmptyPromptDrone()
window.ioc.register('@diamondcoreprocessor.com/CollectionEmptyPromptDrone', _collectionEmptyPrompt)

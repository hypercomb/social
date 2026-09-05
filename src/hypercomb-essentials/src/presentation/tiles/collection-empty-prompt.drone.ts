// presentation/tiles/collection-empty-prompt.drone.ts
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
//
// AN EMPTY LAYER ALSO OPENS THE BEEHAVIORS PANEL. Nothing here is the one
// moment you are most likely to want to give this layer a BEHAVIOUR rather
// than a tile — a website page, a game, a view — and with the puzzle-piece
// icon gone from tiles (tile-actions.drone.ts) the panel needs a door where
// the question is actually asked. `features:context-open` is the same signal
// the top rail's Beehaviors switch sends: no tile in hand, so the subject is
// the LOADED LAYER. Offered ONCE per arrival — closing it stands, and a
// `synchronize` over the same empty layer never raises it again.

import { EffectBus, I18N_IOC_KEY } from '@hypercomb/core'
import { childNamesOf } from '../../history/layer-placement.js'
import { isClaimedByTakeoverAt } from '../../commands/decoration-kind-index.js'
import { isPublishedVisitorShell } from '../../sharing/behavior-enablement.js'

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
  /** Path we have already offered the beehaviors panel for, so a repeat
   *  reconcile over the same empty layer cannot re-open what was closed.
   *  Cleared on navigation — arriving somewhere new asks again. */
  #behaviorsOfferedFor: string | null = null
  /** Whether the panel is up. Already open means already answered; raising
   *  it again would only yank it out of the store mid-flip. */
  #behaviorsPanelOpen = false
  /** True while the first-boot EXAMPLE HIVES offer owns the screen. It fires on
   *  exactly our `root` condition (empty hive root, first boot), so the two
   *  cards used to stack. The offer is the single view now: it carries our
   *  "Add a tile" / "Show me how" gestures in its own actions row, and the
   *  `root` variant here is the FALLBACK for when there is no offer (roster
   *  unavailable, or already dismissed). */
  #offerActive = false

  constructor() {
    // Retire an instance left in the DOM by an older hot-loaded module before
    // this root exclusion existed. A full reload has nothing to remove.
    document.getElementById('hc-collection-empty-prompt')?.remove()
    EffectBus.on<CellCountPayload>('render:cell-count', payload => {
      this.#lastSettledEmpty = payload.count === 0 && payload.settled === true
      void this.#reconcile()
    })
    EffectBus.on<{ active?: boolean; examples?: unknown[] }>('examples:offer', payload => {
      this.#offerActive = payload?.active === true && (payload?.examples?.length ?? 0) > 0
      void this.#reconcile()
    })
    EffectBus.on('examples:dismiss', () => {
      this.#offerActive = false
      void this.#reconcile()
    })
    // Last-value replay: a late subscribe still learns the offer is up.
    // The offer's "Add a tile" delegates here — the command-line focus dance
    // belongs to this module, not to the shell component that renders the card.
    EffectBus.on('hive:empty:add-tile', () => { this.#focusCommandLine() })
    EffectBus.on('cell:added', () => {
      this.#hide()
      this.#lastSettledEmpty = false
    })
    EffectBus.on('cell:removed', () => { void this.#reconcile() })
    EffectBus.on<{ open?: boolean }>('features:viewer-state', payload => {
      this.#behaviorsPanelOpen = payload?.open === true
    })
    // A surface claiming or releasing the canvas is the notice's cue too: it
    // must leave with whatever covers the hexagons and come back with them.
    EffectBus.on('view:active', () => { void this.#reconcile() })
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
      this.#behaviorsOfferedFor = null
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
    // A published read-only site never invites editing: "Add a tile" is a
    // participant gesture, and a visitor has no hive here to add to. Nothing
    // of this surface loads in publish mode — an empty published layer is
    // simply empty.
    if (isPublishedVisitorShell()) { this.#hide(); return }
    const segments = this.#segments()
    // /sets has its own landing, and a takeover view (website, home, slides,
    // tree) hides the hex surface entirely — the emptiness on screen is not the
    // layer's. The EMPTY HIVE ROOT is no longer excluded: it is the first thing
    // a new participant ever sees, and it used to be skipped in favour of "the
    // onboarding path" that was never built. It is now the onboarding path.
    // A full-screen surface with no ViewMode of its own (the chat window) is
    // covering the canvas just as completely as a takeover view is — the
    // owner-counted mode is the half of that question ViewMode cannot answer.
    const covered = ((window.ioc?.get<{ ownersOf(m: string): readonly string[] }>(
      '@diamondcoreprocessor.com/ModeRegistry')?.ownersOf('view:active')) ?? []).length > 0
    const mode = this.#ensureViewMode()?.mode ?? 'hexagons'
    if (!this.#lastSettledEmpty
      || (segments.length === 1 && segments[0] === SETS)
      || mode !== 'hexagons'
      || covered
      || isLauncherLocation(segments)) {
      this.#hide()
      return
    }

    // A TAKEOVER IS NOT AN ABSENCE. `render:cell-count` counts hexagons, and a
    // cell claimed by a takeover view has none (`replacesTileRender` — its
    // sticky IS its presence), so a layer holding nothing but post-its reported
    // itself EMPTY: "Your hive is empty · Add a tile" over a hive with content,
    // and the beehaviors panel raised on top of the notes. Ask the layer, not
    // the glass. Registry-driven: no view is named here or in the index helper.
    if (await this.#claimedTilesHere(segments)) {
      if (seq !== this.#checkSeq) return
      this.#hide()
      return
    }
    if (seq !== this.#checkSeq) return

    // Three variants: the empty hive ROOT (first run — welcome + the tour), a
    // collection's own root, and any other empty layer.
    if (segments.length === 0) {
      if (this.#offerActive) { this.#hide(); return }
      this.#showRootNotice()
      return
    }

    const name = segments[segments.length - 1]!
    const isCollection = segments.length === 1 && await this.#isCollectionRoot(name)
    if (seq !== this.#checkSeq) return
    this.#show(name, isCollection ? 'collection' : 'layer')
    this.#offerBehaviors(segments)
  }

  /** Raise the beehaviors panel on THIS layer, once per arrival. The hive
   *  root is deliberately excluded: its empty state is the onboarding path
   *  (the examples offer / welcome notice), and a docked panel over a first
   *  boot is noise, not help. */
  #offerBehaviors(segments: readonly string[]): void {
    if (segments.length === 0) return
    const key = segments.join('/')
    if (this.#behaviorsOfferedFor === key) return
    this.#behaviorsOfferedFor = key
    if (this.#behaviorsPanelOpen) return
    EffectBus.emit('features:context-open', {})
  }

  /** Does this layer hold at least one cell a takeover view has claimed? Such
   *  a cell is on screen — as paper, not as a hexagon — so the layer has
   *  something in it however many hexagons the render counted. Cheap: the
   *  children come from the layer we already resolve, and the claim lookup is
   *  the hot in-memory decoration index. */
  async #claimedTilesHere(segments: readonly string[]): Promise<boolean> {
    const history = ioc()?.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history.currentLayerAt) return false
    try {
      const sig = await history.sign({ explorerSegments: () => [...segments] })
      const layer = await history.currentLayerAt(sig)
      if (!layer) return false
      const names = await childNamesOf(history, layer as Parameters<typeof childNamesOf>[1])
      return names.some(name => isClaimedByTakeoverAt([...segments, name]))
    } catch {
      // No layer here (a genuinely empty location) — nothing claims anything.
      return false
    }
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

  #showRootNotice(): void {
    if (this.#host?.dataset['variant'] === 'root-notice') return
    this.#hide()

    const host = document.createElement('div')
    host.id = 'hc-collection-empty-prompt'
    host.dataset['variant'] = 'root-notice'
    host.style.cssText =
      'position:fixed;left:50%;bottom:28px;z-index:100000;transform:translateX(-50%);' +
      'pointer-events:none;padding:0 16px;box-sizing:border-box;font-family:inherit;'

    const notice = document.createElement('div')
    notice.style.cssText =
      'pointer-events:auto;display:flex;align-items:center;gap:14px;max-width:calc(100vw - 32px);' +
      'padding:10px 11px 10px 16px;border-radius:var(--hc-radius-floating, 4px);background:rgba(var(--hc-chrome-glass),0.94);' +
      'border:1px solid rgba(var(--hc-chrome-ink),0.13);box-shadow:0 12px 32px rgba(var(--hc-chrome-shadow),0.24);' +
      'backdrop-filter:blur(14px);white-space:nowrap;'

    const copy = document.createElement('div')
    copy.style.cssText = 'display:flex;align-items:baseline;gap:8px;min-width:0;'

    const title = document.createElement('strong')
    title.style.cssText = 'font-size:13px;font-weight:650;color:var(--hc-chrome-text);'
    title.textContent = this.#t('hive.empty.title', 'Your hive is empty')

    const hint = document.createElement('span')
    hint.style.cssText = 'font-size:12px;color:var(--hc-chrome-ink-quiet);'
    hint.textContent = this.#t('hive.empty.notice', 'Add the first thing you want to keep.')

    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      'flex:none;border:1px solid rgba(var(--hc-chrome-accent),0.35);border-radius:var(--hc-radius-control, 2px);padding:7px 11px;' +
      'font:inherit;font-size:12px;font-weight:650;color:rgb(var(--hc-chrome-accent));background:rgba(var(--hc-chrome-accent),0.09);cursor:pointer;'
    button.textContent = this.#t('hive.empty.action', 'Add a tile')
    const requestFocus = (event: Event): void => this.#focusCommandLine(event)
    button.addEventListener('pointerdown', requestFocus, true)
    button.addEventListener('click', requestFocus, true)

    copy.append(title, hint)
    notice.append(copy, button)
    host.appendChild(notice)
    document.body.appendChild(host)
    this.#host = host
  }

  #show(name: string, variant: 'collection' | 'layer'): void {
    const titleText = variant === 'collection'
      ? this.#t('collections.empty.title', 'Add your first tile')
      : this.#t('layer.empty.title', 'No tiles yet')
    const bodyText = variant === 'collection'
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
      variant === 'collection' ? 'collections.empty.action' : 'layer.empty.action',
      'Add a tile',
    )

    if (this.#host) {
      const title = this.#host.querySelector('[data-role="title"]')
      if (title) title.textContent = titleText
      const body = this.#host.querySelector('[data-role="body"]')
      if (body) body.textContent = bodyText
      const action = this.#host.querySelector('[data-role="action"]')
      if (action) action.textContent = actionText
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
      'pointer-events:auto;width:min(300px,calc(100vw - 40px));text-align:left;border-radius:var(--hc-radius-floating, 4px);padding:18px;' +
      'background:rgba(var(--hc-chrome-glass),0.92);border:1px solid rgba(var(--hc-chrome-ink),0.12);' +
      'box-shadow:0 14px 36px rgba(var(--hc-chrome-shadow),0.22);backdrop-filter:blur(12px);cursor:pointer;'

    const title = document.createElement('div')
    title.dataset['role'] = 'title'
    title.style.cssText = 'font-size:17px;font-weight:650;color:var(--hc-chrome-text);margin-bottom:6px;letter-spacing:-0.01em;'
    title.textContent = titleText

    const body = document.createElement('div')
    body.dataset['role'] = 'body'
    body.style.cssText = 'font-size:13px;line-height:1.5;color:var(--hc-chrome-ink-quiet);margin-bottom:14px;'
    body.textContent = bodyText

    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['role'] = 'action'
    button.style.cssText =
      'border:1px solid rgba(var(--hc-chrome-accent),0.38);border-radius:var(--hc-radius-control, 2px);padding:8px 12px;font:inherit;font-size:13px;font-weight:650;' +
      'color:rgb(var(--hc-chrome-accent));background:rgba(var(--hc-chrome-accent),0.08);cursor:pointer;'
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
    host.appendChild(panel)
    document.body.appendChild(host)
    this.#host = host
  }

  #hide(): void {
    this.#host?.remove()
    this.#host = null
  }

  #focusCommandLine(event?: Event): void {
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

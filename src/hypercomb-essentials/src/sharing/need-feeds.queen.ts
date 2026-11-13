// sharing/need-feeds.queen.ts
//
// `explore` — a VIEW of the hive: what the servers hold for the tile you stand
// on, beside that tile's own list, and a way to pull values in.
//
// ONE ENGINE (jwize 2026-11-12, "THIS is critical"): "its data source is the
// same as the hexagon grid but it renders differently. That way you can just
// add the view you need and the engine is the same from the tiles and address
// and all." So this is a view mode like tree or square-tile-view, not an
// overlay with a world of its own:
//
//   · WHERE you are is the hive's one location (Lineage / the address bar).
//     The view follows it; it never keeps a location of its own and never
//     closes because the location moved.
//   · THE TILE LIST on the left is the hive's one tile list (the tiles rail
//     the chat mounts), driven by the real location the way the chat drives
//     it: a row walked into moves the address, and every move of the address
//     moves the rail. It lists only the tiles the grid itself is showing
//     (page-cells.ts — the grid's own settled answer).
//   · BACK IS THE MAIN PAGE'S BACK: right-click, the view's back button and
//     the browser's back all step back through the places walked inside the
//     view (the steps the address pushed over the view's back trap), and the
//     view holds its surface for that step. Only at the level the view was
//     opened on does back leave the view, for the hexagons ("right button
//     click returns to the main page which is a bug unless it has undone to
//     the first rank before the view was shown").
//
// THE SERVERS' SIDE: a row of hexagons, one per server feeding the name or
// still being asked, one for every server that brought nothing; from each a
// line runs into ONE list of every value they brought (named groups when an AI
// is attached, explore-groups.ts). The name is the tile you stand on, followed
// as you walk; type another in the search box (or say `explore <name>`) and
// that name stays while you walk, until the box is cleared. `+`, or dragging a
// value onto the tile list, adds it where you stand — the place the grid and
// the list both show.
//
// The other direction is `contribute` (contribute.queen.ts). The reads are
// need-feeds.ts; a different face of the answers is a different
// `#renderValues`, fed the same merged rows.
//
// SAID FROM OUTSIDE (a session on the bridge), the word answers ALOUD and
// opens nothing: explore-aloud.ts.

import { EffectBus, I18N_IOC_KEY, QueenBee, isReservedPoolWord, normalizeCell, type I18nProvider } from '@hypercomb/core'
import { feedNeed, foldValue, liveFeedDeps, mergeFeeds, type Feed, type NeedValue } from './need-feeds.js'
import { contributeHere, standingSegments } from './contribute.js'
import { GROUP_MIN_VALUES, groupKey, groupValues, liveGroupDeps, type ValueGroup } from './explore-groups.js'
import { ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn } from './behavior-enablement.js'
import { childNamesAt } from '../commands/trait-read.js'
import { onPageCellsChanged, pageCellsAt } from '../presentation/tiles/page-cells.js'
import type { AgentTilesRail } from '../assistant/agent-tiles-rail.js'
import type { VisualBeeRegistry } from '../commands/visual-bee-registry.js'
import { CREATE_CELLS_IOC_KEY } from '../commands/create-cells.js'
import { isLongPressMenu } from '../navigation/browser-menu.js'
import { exploreAloud, saidFromOutside } from './explore-aloud.js'
import { readExplore } from '../assistant/hive-explore-read.js'

/** The view's mode string — also its `view:active` owner and back-gesture key. */
export const EXPLORE_VIEW = 'explore'
/** The view's roster identity. A kind nobody has seen is dark; lit once below. */
export const EXPLORE_KIND = 'visual:explore:view'
const EXPLORE_COHORT = 'explore-view'

const INK = '#0b0f14'
const BORDER = 'rgba(126,182,214,0.20)'
const TEXT = '#d8e6ee'
const DIM = 'rgba(216,230,238,0.55)'
const STEEL = 'rgb(126,182,214)'
/** One hue per host, in row order — the only colour on the surface. */
const HUES = ['#7eb6d6', '#d99a4e', '#6fbf94', '#c58bd6', '#d6c36f', '#cf6f5e', '#6fc7c7', '#a3a8d6']
/** Level with the postit view: above the canvas (59989) and its riders, below
 *  edit-actions (59995), the bars (59999) and the header. */
const Z_BASE = 59992
const HEX_W = 112
const HEX_H = 98
const STYLE_ID = 'hc-need-feeds-style'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }
type BackGestureShape = { register(entry: { owner: string; back: () => void; exact?: boolean }): () => void }
type NavigationShape = { goRaw?(segments: readonly string[]): void }
/** What the address bar's history entries carry (hypercomb-runtime navigation.ts). */
type StepState = { hcOver?: unknown; hcOverDepth?: unknown; hcView?: unknown; hcBelow?: unknown }

/** The keymap reason this view holds while it is up. */
const KEYMAP_REASON = 'need-feeds'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.style.cssText = css
  if (text !== undefined) node.textContent = text
  return node
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The flow: a short dash travelling down the line. `asking` runs quicker
  // and fainter, `answered` slower and steadier; still lines get no class.
  style.textContent =
    '@keyframes hc-need-flow{to{stroke-dashoffset:-48}}' +
    '#hc-need-feeds .flow{stroke-dasharray:3 13;animation:hc-need-flow 1.6s linear infinite}' +
    '#hc-need-feeds .flow.asking{animation-duration:.9s;opacity:.45}' +
    '#hc-need-feeds .lit .base{opacity:.55}#hc-need-feeds .lit .flow{opacity:1}' +
    '#hc-need-feeds .dim{opacity:.25}' +
    '@media (prefers-reduced-motion:reduce){#hc-need-feeds .flow{animation:none}}'
  document.head.appendChild(style)
}

const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((part, i) => part === b[i])

type Mount = {
  host: HTMLDivElement
  summary: HTMLDivElement
  row: HTMLDivElement
  svg: SVGSVGElement
  list: HTMLDivElement
  stage: HTMLDivElement
  /** The servers' list heading: where "grouping…" shows while the AI answers. */
  listHead: HTMLDivElement
  /** The left column: the tiles rail and the line that says where a value goes. */
  aside: HTMLDivElement
  dropHint: HTMLDivElement
  /** The explored name, editable. */
  search: HTMLInputElement
  offer: HTMLButtonElement
}

/** The drag payload a value carries from the servers' list to the tile list. */
const DRAG_TYPE = 'application/x-hc-explore-value'

export class ExploreQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'explore'
  override description = 'Explore what the servers hold for a tile, and add what they bring'
  override descriptionKey = 'slash.explore'
  // The name after `explore` is the word's own (it may hold spaces).
  override rawArgs = true
  override options = ['', '<name>']
  override examples = [
    { input: 'explore', result: 'The tile you stand on, as a view: its tiles beside what every server holds for it' },
    { input: 'explore recipes', result: 'What the servers hold for recipes, wherever you walk; + adds a value where you stand' },
  ]
  override machine = {
    forms: 'explore | explore <name>',
    example: '/explore recipes',
    bare: true,
    reach: 'additive' as const,
    scope: 'local' as const,
    refuse: (): string | undefined => undefined,
  }

  #mount: Mount | null = null
  /** The name typed (`explore <name>` or the search box); null = the tile you stand on. */
  #pinned: string | null = null
  #name = ''
  #feeds = new Map<string, Feed>()
  #order: string[] = []
  #promoted = new Set<string>()
  #run = 0
  #hover: { host?: string; value?: NeedValue } = {}
  /** The location last drawn, so a `change` that moved nothing moves nothing. */
  #placeKey = ''
  /** The names of the tiles where you stand — the "here" marks. */
  #here: string[] = []
  /** The hive's one tile list (assistant/agent-tiles-rail.ts), on the left. */
  #rail: AgentTilesRail | null = null
  /** Named AI groups for the current list (explore-groups.ts), null = flat. */
  #groups: ValueGroup[] | null = null
  /** The list the groups (or the ask under way) are for. */
  #groupKey = ''
  #grouping = false
  /** The one open group — an accordion, closed until a header is pressed. */
  #openGroup: string | null = null
  #groupDeps = liveGroupDeps()
  #wired = false
  /** THIS SESSION'S STEPS are the entries pushed over the back trap that was
   *  live when the view opened — its token (view-back.ts `hcTrap`), and the
   *  depth already walked over it then (opened over another view's step).
   *  An entry is a step of this view only when it carries that token and is
   *  deeper — never by an owner's name, which a stale entry or another view's
   *  trap can carry too. */
  #trapToken: string | null = null
  #baseDepth = 0
  #offs: (() => void)[] = []

  protected async execute(args: string): Promise<void> {
    // A CALL FROM OUTSIDE HEARS THE ANSWER; the participant's surface stays
    // as it is. Awaited, so the caller's hearing covers the whole answer.
    if (saidFromOutside('explore')) {
      const withheld = ioc<{ covers?: (segments: readonly string[]) => boolean }>('@hypercomb.social/AiWithheld')
      const lines = await exploreAloud(args, {
        standing: standingSegments,
        withheld: segments => !!withheld?.covers?.(segments),
        read: name => readExplore(name),
      })
      for (const message of lines) EffectBus.emit('activity:log', { message, icon: 'travel_explore' })
      return
    }
    this.wire()
    const said = args.trim()
    const vm = this.#vm()
    if (!said && !standingSegments().length) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('need.stand', 'Stand on a tile first, or name one: explore recipes.') })
      return
    }
    if (!liveFeedDeps().hosts().length) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('need.no-hosts', 'No servers to ask yet — add one in the host directory (hosts).') })
      return
    }
    this.#pinned = said || null
    if (this.#mount) { this.#explore(said); return }
    vm?.setMode(EXPLORE_VIEW)
    this.#sync()
  }

  /** Mount when the mode turns explore, take down when it turns anything else —
   *  however it was turned (the word, the view's icon, `view:toggle`). */
  wire(): void {
    if (this.#wired) return
    const vm = this.#vm()
    if (!vm) return
    this.#wired = true
    vm.addEventListener('change', () => this.#sync())
  }

  #vm(): ViewModeShape | undefined { return ioc<ViewModeShape>('@hypercomb.social/ViewMode') }

  #sync(): void {
    const on = this.#vm()?.mode === EXPLORE_VIEW
    if (on && !this.#mount) this.#mountView()
    else if (!on && this.#mount) this.#unmount()
  }

  /** The name explored: the one typed, else the tile you stand on. */
  #nameHere(): string {
    const standing = standingSegments()
    return this.#pinned ?? standing[standing.length - 1] ?? ''
  }

  /** Ask every host for the explored name. `fresh` asks past a remembered
   *  miss — the participant's own contribution just landed a pool. */
  #feed(fresh: boolean): void {
    const deps = liveFeedDeps()
    const hosts = [...new Set(deps.hosts())]
    const run = ++this.#run
    this.#feeds.clear()
    this.#order = this.#name ? hosts : []
    this.#render()
    if (!this.#name) return
    void feedNeed(this.#name, feed => {
      if (run !== this.#run || !this.#mount) return
      this.#feeds.set(feed.host, feed)
      this.#render()
    }, { ...deps, hosts: () => hosts }, { fresh })
  }

  /** Where `+` adds — where you stand — said in words. */
  #place(): { text: string; tip: string } {
    const standing = standingSegments()
    const place = standing[standing.length - 1] ?? ''
    return place
      ? { text: this.#say('need.adds-to', '+ adds to "{place}"', { place }), tip: this.#say('need.promote', 'Add to "{place}"', { place }) }
      : { text: this.#t('need.adds-to-root', "+ adds to your hive's root"), tip: this.#t('need.promote-root', "Add to your hive's root") }
  }

  // ── the view ────────────────────────────────────────────────────────

  #mountView(): void {
    ensureStyle()
    const host = el('div',
      `position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:${Z_BASE};` +
      `overflow:auto;background:${INK};color:${TEXT};overscroll-behavior:contain;font-size:0.875rem;`)
    host.id = 'hc-need-feeds'
    host.setAttribute('data-consumes-wheel', '')

    // THE SHELL'S ICON COLUMN sits above every view on the left (z 60000);
    // the view starts past it, measured, so a phone without it loses nothing.
    const column = document.querySelector('.controls-pill.column') as HTMLElement | null
    const gutter = Math.max(16, Math.round(column?.getBoundingClientRect().right ?? 0) + 10)
    const button = `background:none;border:1px solid ${BORDER};border-radius:var(--hc-radius-control,2px);padding:4px 10px;cursor:pointer;font:inherit;`
    // The shell's header stays above every view (z 60000), so the bar sits
    // under it in the page. It wraps at phone width instead of scrolling.
    const bar = el('div',
      `display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:64px 16px 0 ${gutter}px;padding:0 2px 12px;` +
      `border-bottom:1px solid ${BORDER};box-sizing:border-box;`)
    const brand = el('div', `font-size:0.8125rem;font-weight:700;letter-spacing:0.14em;color:${STEEL};flex:none;`, this.#t('need.brand', 'EXPLORE'))
    // THE NAME IS A SEARCH BOX: Enter explores what is typed; an empty box
    // goes back to the tile you stand on.
    const search = el('input',
      `flex:1 1 180px;min-width:0;max-width:420px;background:rgba(126,182,214,0.06);border:1px solid ${BORDER};` +
      `border-radius:var(--hc-radius-control,2px);color:${TEXT};font:inherit;padding:5px 10px;`)
    search.type = 'search'
    search.placeholder = this.#t('need.search', 'Explore a name')
    search.setAttribute('aria-label', this.#t('need.search', 'Explore a name'))
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      this.#explore(search.value)
    })
    const summary = el('div', `color:${DIM};flex:0 1 auto;min-width:0;font-size:0.75rem;`)
    // The participant's own click contributes their list (contribute.ts), then
    // the hosts are asked again past any remembered miss, so it shows at once.
    const offer = el('button', button + `color:${STEEL};`, this.#t('need.offer', 'contribute'))
    offer.title = this.#t('need.offer-title', 'Contribute the names of the tiles under the one you stand on, as a list on your host')
    offer.addEventListener('click', async () => {
      offer.disabled = true
      try {
        if (await contributeHere('') && this.#mount?.host === host) this.#feed(true)
      } finally { offer.disabled = false }
    })
    const close = el('button', button + `color:${TEXT};`, this.#t('need.close', 'hexagons'))
    close.addEventListener('click', () => this.#leave())
    bar.append(brand, search, summary, offer, close)

    // THE BODY: the tile list on the left, the servers and their list beside it.
    const body = el('div', `display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px;padding:14px 16px 48px ${gutter}px;`)
    const aside = el('div',
      `flex:0 0 300px;max-width:100%;position:sticky;top:12px;display:flex;flex-direction:column;` +
      `max-height:calc(100vh - 150px);min-height:240px;border:1px solid ${BORDER};border-radius:var(--hc-radius-card,3px);` +
      `background:rgba(126,182,214,0.03);transition:background .12s,border-color .12s;overflow:hidden;` +
      // The rail draws with the shell's window tokens, made for a light
      // surface and resolved at the page root; this column is dark, so each
      // token it reads is given its dark-surface value here.
      '--hc-panel-ink:216,230,238;--hc-window-ink-loud:rgba(216,230,238,0.96);--hc-window-ink-plain:rgba(216,230,238,0.82);' +
      '--hc-window-ink-quiet:rgba(216,230,238,0.62);--hc-window-accent:rgb(126,182,214);--hc-window-accent-quiet:rgba(126,182,214,0.62);' +
      '--hc-window-wash:rgba(126,182,214,0.08);--hc-window-tint:rgba(126,182,214,0.05);' +
      '--hc-window-edge:rgba(126,182,214,0.18);--hc-window-edge-firm:rgba(126,182,214,0.30);')
    const railHost = el('div', 'flex:1;min-height:0;overflow:auto;')
    const dropHint = el('div', `flex:none;padding:8px 12px;font-size:0.75rem;color:${STEEL};border-top:1px solid ${BORDER};`)
    aside.append(railHost, dropHint)
    const main = el('div', 'flex:1 1 420px;min-width:0;')
    // The stage holds the row, the lines and the list; the lines are one SVG
    // laid over the whole stage, measured from the tiles and the list.
    const stage = el('div', 'position:relative;padding:12px 0 0;')
    const svg = svgEl('svg')
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;'
    // `safe center`: when the hosts overflow the width, the row starts at its
    // left edge and scrolls, instead of spilling the first hosts out of reach.
    const row = el('div', 'position:relative;display:flex;justify-content:safe center;flex-wrap:nowrap;gap:14px;overflow-x:auto;padding:4px 4px 8px;')
    const listHead = el('div', `position:relative;font-size:0.75rem;letter-spacing:0.06em;color:${DIM};padding:0 2px 6px;margin-top:96px;`,
      this.#t('need.pane-servers', 'From the servers'))
    const list = el('div', `position:relative;border:1px solid ${BORDER};border-radius:var(--hc-radius-card,3px);background:rgba(126,182,214,0.04);`)
    stage.append(svg, row, listHead, list)
    main.append(stage)
    body.append(aside, main)
    host.append(bar, body)
    this.#wireDrop(aside)
    // ONE BACK OVER THE TILE LIST TOO: the rail's own right-click climbs its
    // trail (structural up, even past the level the view opened on). Taken
    // here first, so right-click means the same back everywhere in the view.
    aside.addEventListener('contextmenu', (event) => {
      if (isLongPressMenu(event) || event.ctrlKey || event.metaKey) return
      if ((event.target as HTMLElement | null)?.closest?.('input, textarea')) return
      event.preventDefault()
      event.stopPropagation()
      this.#back()
    }, true)
    row.addEventListener('scroll', () => this.#drawLines())
    document.body.appendChild(host)

    this.#mount = { host, summary, row, svg, list, stage, listHead, aside, dropHint, search, offer }
    this.#placeKey = standingSegments().join('\u0000')
    this.#name = this.#nameHere()
    search.value = this.#name
    this.#here = []
    this.#promoted.clear()
    this.#groups = null
    this.#groupKey = ''
    this.#grouping = false
    this.#openGroup = null

    // THE VIEW IS UP: it is `view:active`, which arms the browser-back trap
    // (view-back.ts) and routes right-click here (back-gesture.service.ts).
    ioc<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')?.enter('view:active', EXPLORE_VIEW)
    // The trap is in hand now (view-back pushes it as view:active opens, or
    // another view's is still up): remember whose steps are this session's.
    this.#readTrap()
    const backOff = ioc<BackGestureShape>('@diamondcoreprocessor.com/BackGesture')
      ?.register({ owner: EXPLORE_VIEW, back: () => this.#back(), exact: true })
    if (backOff) this.#offs.push(backOff)
    // The hive underneath cannot be seen, so none of its keys may act on it:
    // the keymap is HELD and this view's own Escape leaves it.
    EffectBus.emitTransient('keymap:hold', { reason: KEYMAP_REASON })
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', this.#onLocation)
    window.addEventListener('keydown', this.#onKey, true)
    window.addEventListener('resize', this.#onResize)
    window.addEventListener('synchronize', this.#onCommitted)
    this.#offs.push(() => {
      lineage?.removeEventListener?.('change', this.#onLocation)
      window.removeEventListener('keydown', this.#onKey, true)
      window.removeEventListener('resize', this.#onResize)
      window.removeEventListener('synchronize', this.#onCommitted)
    })
    // Each ARRIVAL settled by the view bee (view.bee.ts `view:arrival`) is
    // where the next back's hold is armed — after the arrival into a step has
    // spent the last one, never before (#armHold).
    this.#offs.push(EffectBus.on('view:arrival', () => this.#armHold()))
    // The grid's answer changed (a filter, a tile hidden, added or removed):
    // the tile list shows exactly what the grid shows, so it is drawn again.
    this.#offs.push(onPageCellsChanged(() => { this.#rail?.refresh(); void this.#refreshHere() }))

    this.#mountRail(railHost)
    void this.#refreshHere()
    this.#feed(false)
  }

  #unmount(): void {
    const mount = this.#mount
    if (!mount) return
    this.#run++
    try { this.#rail?.dispose() } catch { /* already gone */ }
    this.#rail = null
    for (const off of this.#offs.splice(0)) { try { off() } catch { /* released */ } }
    ioc<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')?.exit('view:active', EXPLORE_VIEW)
    EffectBus.emitTransient('keymap:release', { reason: KEYMAP_REASON })
    // A hold armed ahead and never spent must not reach an unrelated arrival.
    ioc<{ releaseSurfaceHold?: () => void }>('@diamondcoreprocessor.com/ViewBee')?.releaseSurfaceHold?.()
    // The next opening by icon, toggle or panel follows the tile you stand on.
    this.#pinned = null
    this.#trapToken = null
    this.#baseDepth = 0
    mount.host.remove()
    this.#mount = null
    this.#hover = {}
  }

  /** Leave the view: the surface goes back to the hexagons, where you stand. */
  #leave(): void { this.#vm()?.setMode('hexagons') }

  /** Keep the view up across the next arrival: a step back to an ancestor
   *  would otherwise release it (view.bee.ts RETREAT; site-view does the same). */
  #hold(): void {
    ioc<{ holdSurfaceOnce?: () => void }>('@diamondcoreprocessor.com/ViewBee')?.holdSurfaceOnce?.()
  }

  /**
   * THE ONE BACK — right-click and the view's back both come here, and the
   * browser's back reaches it too (view-back.ts, when its trap is spent). A
   * step walked inside the view is walked back; at the level the view was
   * opened on, back leaves the view.
   */
  #back(): void {
    const state = (window.history.state ?? null) as StepState | null
    if (this.#isStep(state)) {
      this.#hold()
      window.history.back()
      return
    }
    this.#leave()
  }

  /** ARMED AHEAD, NOT AT THE BACK: the hive's own popstate handler reads the
   *  hold before any listener here could set it, so once an arrival on a step
   *  walked inside the view has settled, the NEXT arrival is held in advance —
   *  whether it comes from right-click, the back button or the browser. At the
   *  level the view was opened on nothing is armed, so the next back leaves.
   *  A hold left over when the view closes is spent by view-back's own drop
   *  of its trap. */
  #armHold(): void {
    const state = window.history.state as StepState | null
    if (this.#isStep(state)) this.#hold()
  }

  /** Read the trap the view opened over: its own (view-back's, pushed as the
   *  view became active) or the one already up under another view's step. */
  #readTrap(): void {
    const state = (window.history.state ?? null) as (StepState & { hcTrap?: unknown; hcOverTrap?: unknown }) | null
    if (typeof state?.hcTrap === 'string') { this.#trapToken = state.hcTrap; this.#baseDepth = 0; return }
    if (typeof state?.hcOverTrap === 'string') { this.#trapToken = state.hcOverTrap; this.#baseDepth = Number(state.hcOverDepth) || 0; return }
    this.#trapToken = null
    this.#baseDepth = 0
  }

  /** Is this entry a step walked inside THIS session of the view? */
  #isStep(state: StepState | null | undefined): boolean {
    // Not read yet: only the TRAP itself may name the token — reading it off a
    // step would take that step's depth as the floor.
    if (!this.#trapToken && typeof (window.history.state as { hcTrap?: unknown } | null)?.hcTrap === 'string') this.#readTrap()
    const token = (state as { hcOverTrap?: unknown } | null | undefined)?.hcOverTrap
    return !!this.#trapToken && token === this.#trapToken && Number(state?.hcOverDepth) > this.#baseDepth
  }

  /** The rail walked: move the real address, the way the chat walks it. Going
   *  up onto the entry this walk pushed from is browser back, so right-click
   *  out and the back button are one move and leave no forward entry. */
  #walkTo(segments: readonly string[]): void {
    const next = [...segments].map(part => String(part ?? '').trim()).filter(Boolean)
    const here = standingSegments()
    if (samePath(next, here)) return
    // ONE STEP IN is the grid's own enter (tile-overlay #navigateInto): the same
    // readiness gates, references and flattened tiles as a press on a hexagon.
    if (next.length === here.length + 1 && samePath(next.slice(0, -1), here)) {
      EffectBus.emit('tile:enter-request', { label: next[next.length - 1] })
      // The grid may decline the press (a claimed tile opens instead, a
      // filtered branch, an adopt first): the rail already stepped in, so it
      // is put back where you actually stand.
      setTimeout(() => {
        if (this.#mount && samePath(standingSegments(), here)) this.#rail?.showLevel(here)
      }, 1200)
      return
    }
    const up = next.length < here.length && next.every((part, i) => part === here[i])
    if (up) {
      const state = (window.history.state ?? {}) as StepState
      const address = window.location.pathname.replace(/\/\[[^/]*\]$/, '')
      const parentAddress = address.slice(0, address.lastIndexOf('/')) || '/'
      if (next.length === here.length - 1 && this.#isStep(state)
        && state.hcBelow === parentAddress) {
        window.history.back()
        return
      }
      this.#hold()
    }
    ioc<NavigationShape>('@hypercomb.social/Navigation')?.goRaw?.(next)
  }

  /** The location moved (a rail walk, a back, the browser). The view follows:
   *  the rail shows the new level, and an unpinned name follows the tile. */
  readonly #onLocation = (): void => {
    const mount = this.#mount
    if (!mount) return
    const standing = standingSegments()
    const key = standing.join('\u0000')
    if (key === this.#placeKey) return
    this.#placeKey = key
    this.#rail?.showLevel(standing)
    this.#promoted.clear()
    if (this.#pinned === null) {
      const name = this.#nameHere()
      if (foldValue(name) !== foldValue(this.#name)) {
        this.#name = name
        mount.search.value = name
        this.#resetGroups()
        this.#feed(false)
      }
    }
    void this.#refreshHere()
    this.#render()
  }

  /** The tiles rail, as the chat mounts it, FOLLOWING the real location: its
   *  walk moves the address (#walkTo) and the address moves it (#onLocation).
   *  It lists only what the grid shows. Loaded with the view, never at boot. */
  #mountRail(railHost: HTMLElement): void {
    const mount = this.#mount
    void import('../assistant/agent-tiles-rail.js').then(({ AgentTilesRail }) => {
      if (!mount || mount !== this.#mount) return
      const rail = new AgentTilesRail({
        walk: true,
        chats: false,
        choose: false,
        title: true,
        clickLabel: this.#t('need.rail-click', 'Open this tile'),
        findLabel: this.#t('need.rail-find', 'Find a tile'),
        // The grid's own answer for that level (page-cells.ts): a tile the
        // grid has filtered or hidden is not listed. Before the grid has
        // painted a level, the walk's rows stand.
        admits: (row) => {
          const page = pageCellsAt(row.segments.slice(0, -1))
          return !page || page.cells.some(cell => cell.label === row.name)
        },
      })
      rail.onLevelChanged = (segments) => this.#walkTo(segments)
      // A row pressed is a tile clicked: it ENTERS that tile, the way a press
      // on the grid does (the rail, without chats, only names it).
      rail.onSubjectChanged = (pick) => { if (pick) this.#walkTo([...pick.path, pick.name]) }
      rail.mount(railHost)
      this.#rail = rail
    }).catch(() => { /* no rail: the servers' side still works */ })
  }

  /** Explore a name in place — the search box's Enter, or `explore <name>`
   *  while the view is up. An empty name goes back to the tile you stand on. */
  #explore(raw: string): void {
    const mount = this.#mount
    if (!mount) return
    const typed = raw.trim()
    this.#pinned = typed || null
    const name = this.#nameHere()
    mount.search.value = name
    if (foldValue(name) === foldValue(this.#name)) return
    this.#name = name
    this.#promoted.clear()
    this.#resetGroups()
    this.#feed(false)
  }

  #resetGroups(): void {
    this.#groups = null
    this.#groupKey = ''
    this.#grouping = false
    this.#openGroup = null
  }

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#mount) return
    // A field with an Escape of its own (the rail's find box clears its query
    // first) keeps it — so this stands aside before taking the key.
    if ((event.target as HTMLElement | null)?.closest?.('[data-escape-local]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    // Escape in another field (the search box) lets go of the field first;
    // the next Escape leaves the view.
    const field = (event.target as HTMLElement | null)?.closest?.('input, textarea') as HTMLInputElement | null
    if (field && this.#mount.host.contains(field)) { field.blur(); return }
    this.#leave()
  }

  #onResize = (): void => this.#drawLines()

  /** A commit landed (the processor's one `synchronize`): a value just added
   *  may be here now, so the "here" marks are read again. */
  #onCommitted = (): void => {
    // The hive moved under the list: the rail re-reads its level (its own
    // contract — the surface calls refresh on `synchronize`).
    this.#rail?.refresh()
    void this.#refreshHere()
  }

  // ── render ──────────────────────────────────────────────────────────

  #render(): void {
    const mount = this.#mount
    if (!mount) return
    const feeds = this.#order.map(host => this.#feeds.get(host) ?? { host, state: 'asking' as const, values: [], publishers: 0, ms: 0 })
    const values = mergeFeeds(feeds)
    const answered = feeds.filter(f => f.state === 'answered').length
    mount.summary.textContent = this.#say('need.summary', '{answered} of {hosts} servers answered · {values} values',
      { answered, hosts: feeds.length, values: values.length })
    this.#renderRow(feeds)
    this.#askGroups(feeds, values)
    this.#renderValues(values)
    mount.dropHint.textContent = this.#place().text
    // A contribution is for the tile you STAND on, so the button is there only
    // when that is the name explored.
    const standing = standingSegments()
    mount.offer.style.display = foldValue(standing[standing.length - 1] ?? '') === foldValue(this.#name) ? '' : 'none'
    // Drawn now, not on a frame: measuring forces the layout, and a hidden
    // tab never runs a frame.
    this.#drawLines()
  }

  /** The row: one hexagon per server that is feeding the need or still being
   *  asked, and ONE stack of three hexagons for every server that brought
   *  nothing (jwize 2026-11-12: "don't show the servers instead a graphic of
   *  three hexagons stacked representing all the empty ones"). */
  #renderRow(feeds: readonly Feed[]): void {
    const row = this.#mount!.row
    row.replaceChildren()
    const feeding = feeds.filter(feed => feed.state === 'asking' || (feed.state === 'answered' && feed.values.length > 0))
    const empty = feeds.filter(feed => !feeding.includes(feed))
    feeding.forEach(feed => {
      const hue = HUES[this.#order.indexOf(feed.host) % HUES.length]
      const tile = el('div',
        `flex:none;width:${HEX_W}px;height:${HEX_H}px;clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);` +
        `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;padding:0 16px;box-sizing:border-box;` +
        `background:${feed.state === 'answered' ? hue + '33' : 'rgba(126,182,214,0.08)'};cursor:default;transition:opacity .15s;`)
      tile.dataset['host'] = feed.host
      tile.title = feed.host
      const label = el('div', `font-size:0.75rem;font-weight:600;color:${feed.state === 'answered' ? TEXT : DIM};max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`, feed.host)
      const status = el('div', `font-size:0.6875rem;color:${feed.state === 'answered' ? hue : DIM};`, this.#status(feed))
      tile.append(label, status)
      if (this.#hover.value && !this.#hover.value.hosts.includes(feed.host)) tile.style.opacity = '0.35'
      tile.addEventListener('mouseenter', () => { this.#hover = { host: feed.host }; this.#highlight() })
      tile.addEventListener('mouseleave', () => { this.#hover = {}; this.#highlight() })
      row.appendChild(tile)
    })
    if (empty.length) row.appendChild(this.#emptyStack(empty))
  }

  /** One hexagon the size of the others, with an inline — a second edge just
   *  inside its own — that says "more than one behind this" (jwize: "the same
   *  sized item with an inline not outline"). The count is in the middle;
   *  which servers, and what each said, is in the tooltip. */
  #emptyStack(empty: readonly Feed[]): HTMLElement {
    const stack = el('div',
      `flex:none;position:relative;width:${HEX_W}px;height:${HEX_H}px;cursor:default;transition:opacity .15s;` +
      'clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);background:rgba(126,182,214,0.06);')
    stack.dataset['stack'] = ''
    stack.title = empty.map(feed => `${feed.host} — ${this.#status(feed)}`).join('\n')
    const cx = HEX_W / 2
    const cy = HEX_H / 2
    const corners: readonly (readonly [number, number])[] = [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]
    const inset = 0.84
    const points = corners
      .map(([fx, fy]) => `${(cx + (fx * HEX_W - cx) * inset).toFixed(1)},${(cy + (fy * HEX_H - cy) * inset).toFixed(1)}`)
      .join(' ')
    const svg = svgEl('svg', { width: HEX_W, height: HEX_H, viewBox: `0 0 ${HEX_W} ${HEX_H}` })
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
    svg.appendChild(svgEl('polygon', { points, fill: 'none', stroke: 'rgba(126,182,214,0.32)', 'stroke-width': 1 }))
    stack.appendChild(svg)
    const label = el('div',
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 22px;box-sizing:border-box;' +
      `font-size:0.6875rem;color:${DIM};line-height:1.35;`,
      this.#say('need.empty-stack', '{count} with nothing', { count: empty.length }))
    stack.appendChild(label)
    return stack
  }

  #status(feed: Feed): string {
    switch (feed.state) {
      case 'asking': return this.#t('need.asking', 'asking…')
      case 'empty': return this.#t('need.empty', 'holds nothing')
      case 'silent': return this.#t('need.silent', 'no answer')
      default: return this.#say('need.answered', '{values} · {ms} ms', { values: feed.values.length, ms: Math.round(feed.ms) })
    }
  }

  /** The first view of the answers: a list of text values. */
  #renderValues(values: readonly NeedValue[]): void {
    const list = this.#mount!.list
    list.replaceChildren()
    const here = new Set(this.#here.map(foldValue))
    if (!this.#name) {
      list.appendChild(el('div', 'padding:18px;text-align:center;color:' + DIM + ';',
        this.#t('need.stand', 'Stand on a tile first, or name one: explore recipes.')))
      return
    }
    if (!values.length) {
      const asking = this.#order.some(host => (this.#feeds.get(host)?.state ?? 'asking') === 'asking')
      list.appendChild(el('div', `padding:18px;text-align:center;color:${DIM};`,
        asking ? this.#t('need.waiting', 'Waiting for the servers…') : this.#t('need.nothing', 'No server brought anything for this need.')))
      return
    }
    const pane = this.#mount!.listHead
    pane.textContent = this.#t('need.pane-servers', 'From the servers') + (this.#grouping ? ' · ' + this.#t('need.grouping', 'grouping…') : '')
    if (this.#groups) {
      const byFold = new Map(values.map(value => [foldValue(value.text), value]))
      // NEVER HIDDEN: a value no group holds — past the grouping cap, or one
      // that arrived after the groups were made — is drawn under Other.
      const other = this.#t('need.group-other', 'Other')
      const grouped = new Set(this.#groups.flatMap(group => group.values.map(foldValue)))
      const loose = values.filter(value => !grouped.has(foldValue(value.text))).map(value => value.text)
      const drawn: ValueGroup[] = loose.length
        ? (this.#groups.some(group => foldValue(group.name) === foldValue(other))
            ? this.#groups.map(group => foldValue(group.name) === foldValue(other) ? { name: group.name, values: [...group.values, ...loose] } : group)
            : [...this.#groups, { name: other, values: loose }])
        : this.#groups
      for (const group of drawn) {
        const members = group.values.map(text => byFold.get(foldValue(text))).filter((v): v is NeedValue => !!v)
        if (!members.length) continue
        const open = this.#openGroup === group.name
        const head = el('button',
          `display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;background:none;border:0;border-top:1px solid rgba(126,182,214,0.08);` +
          `color:${TEXT};font:inherit;font-weight:600;text-align:left;cursor:pointer;`)
        head.append(el('span', `flex:none;width:10px;color:${STEEL};`, open ? '▾' : '▸'),
          el('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', group.name),
          el('span', `flex:none;font-size:0.6875rem;font-weight:400;color:${DIM};`, String(members.length)))
        // One open at a time (the accordion standard): opening one closes the last.
        head.addEventListener('click', () => { this.#openGroup = open ? null : group.name; this.#render() })
        list.appendChild(head)
        if (open) for (const value of members) list.appendChild(this.#valueRow(value, here, true))
      }
      return
    }
    for (const value of values) list.appendChild(this.#valueRow(value, here, false))
  }

  /** One value's row: its servers' dots, its text, who fed it, and its +. */
  #valueRow(value: NeedValue, here: ReadonlySet<string>, inGroup: boolean): HTMLElement {
    const line = el('div', `display:flex;align-items:center;gap:10px;padding:8px 12px 8px ${inGroup ? 30 : 12}px;border-top:1px solid rgba(126,182,214,0.08);transition:opacity .15s;`)
    line.dataset['fold'] = foldValue(value.text)
    line.title = value.vias
      .map(via => via === 'offer' ? this.#t('need.via-offer', 'offered as a list') : this.#t('need.via-tile', 'from a published tile'))
      .join(' · ')
    const dots = el('div', 'display:flex;gap:3px;flex:none;')
    for (const h of value.hosts) {
      dots.appendChild(el('span', `width:7px;height:7px;border-radius:50%;background:${HUES[this.#order.indexOf(h) % HUES.length]};`))
    }
    const text = el('div', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', value.text)
    const count = el('div', `flex:none;font-size:0.6875rem;color:${DIM};`,
      this.#say('need.fed-by', '{count} fed', { count: value.by.length }))
    const fold = foldValue(value.text)
    const isHere = here.has(fold)
    const done = isHere || this.#promoted.has(fold)
    const promote = el('button',
      `flex:none;background:none;border:1px solid ${BORDER};color:${done ? DIM : STEEL};border-radius:var(--hc-radius-control,2px);padding:2px 9px;font:inherit;cursor:${done ? 'default' : 'pointer'};`,
      isHere ? this.#t('need.here', 'here') : done ? this.#t('need.added', 'added') : '+')
    // Drag it into your layer (the right pane). A value already here stays put.
    if (!done) {
      line.draggable = true
      line.style.cursor = 'grab'
      line.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData(DRAG_TYPE, value.text)
        event.dataTransfer?.setData('text/plain', value.text)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
      })
    }
    promote.title = this.#place().tip
    promote.disabled = done
    promote.addEventListener('click', () => void this.#promote(value))
    line.append(dots, text, count, promote)
    line.addEventListener('mouseenter', () => { this.#hover = { value }; this.#highlight() })
    line.addEventListener('mouseleave', () => { this.#hover = {}; this.#highlight() })
    return line
  }

  /**
   * Ask the attached AI to group the list, once the servers have answered and
   * only when the list is long enough (explore-groups.ts). The answer lands in
   * a re-render; a newer list makes an older answer moot.
   */
  #askGroups(feeds: readonly Feed[], values: readonly NeedValue[]): void {
    // A list that has shrunk below grouping is drawn flat again: groups made
    // for a longer list must not keep drawing over it.
    if (values.length < GROUP_MIN_VALUES) {
      this.#groups = null
      this.#groupKey = ''
      this.#grouping = false
      this.#openGroup = null
      return
    }
    // While servers are still answering, the groups stay; a value that arrives
    // meanwhile is drawn under Other (#renderValues), never hidden.
    if (feeds.some(feed => feed.state === 'asking')) return
    const texts = values.map(value => value.text)
    const key = groupKey(this.#name, texts)
    if (key === this.#groupKey) return
    this.#groupKey = key
    this.#groups = null
    this.#openGroup = null
    // A new list: whatever was in flight for the old one no longer counts.
    this.#grouping = false
    if (!this.#groupDeps.available()) return
    this.#grouping = true
    const mount = this.#mount
    void groupValues(this.#name, texts, this.#groupDeps, this.#t('need.group-other', 'Other')).then(groups => {
      if (mount !== this.#mount || key !== this.#groupKey) return
      this.#groups = groups
      this.#grouping = false
      this.#render()
    })
  }

  /** Read the tiles where you stand again (on open, on a move, after a value lands). */
  async #refreshHere(): Promise<void> {
    // The same open view and the same place, still: a newer answer wins.
    const mount = this.#mount
    const place = standingSegments()
    const names = await childNamesAt(place).catch(() => [] as string[])
    if (!mount || mount !== this.#mount || !samePath(place, standingSegments())) return
    this.#here = names
    this.#render()
  }

  /** The rail column takes a dragged value; it lights while one is over it. */
  #wireDrop(zone: HTMLElement): void {
    const carries = (event: DragEvent): boolean => !!event.dataTransfer && [...event.dataTransfer.types].includes(DRAG_TYPE)
    const light = (on: boolean): void => {
      zone.style.background = on ? 'rgba(126,182,214,0.10)' : 'rgba(126,182,214,0.03)'
      zone.style.borderColor = on ? STEEL : BORDER
    }
    zone.addEventListener('dragover', (event) => {
      if (!carries(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      light(true)
    })
    zone.addEventListener('dragleave', (event) => {
      if (!zone.contains(event.relatedTarget as Node | null)) light(false)
    })
    zone.addEventListener('drop', (event) => {
      if (!carries(event)) return
      event.preventDefault()
      event.stopPropagation()
      light(false)
      const value = this.#valueOf(event.dataTransfer?.getData(DRAG_TYPE) ?? '')
      if (value) void this.#promote(value)
    })
  }

  /** The merged row a dragged text came from. */
  #valueOf(text: string): NeedValue | null {
    const fold = foldValue(text)
    if (!fold) return null
    const feeds = this.#order.map(host => this.#feeds.get(host)).filter((feed): feed is Feed => !!feed)
    return mergeFeeds(feeds).find(value => foldValue(value.text) === fold) ?? null
  }

  /** One curve from each tile's foot to the list's head. */
  #drawLines(): void {
    const mount = this.#mount
    if (!mount) return
    const origin = mount.stage.getBoundingClientRect()
    const listBox = mount.list.getBoundingClientRect()
    const endY = listBox.top - origin.top
    const endX = listBox.left - origin.left + listBox.width / 2
    mount.svg.replaceChildren()
    const tiles = Array.from(mount.row.children) as HTMLElement[]
    tiles.forEach((tile, at) => {
      const host = tile.dataset['host'] ?? ''
      const isStack = tile.dataset['stack'] !== undefined
      const feed = this.#feeds.get(host)
      const state = isStack ? 'empty' : feed?.state ?? 'asking'
      const box = tile.getBoundingClientRect()
      const x = box.left - origin.left + box.width / 2
      const y = box.bottom - origin.top
      // Spread the landings across the list's head so the lines arrive apart.
      const n = Math.max(1, tiles.length)
      const landX = endX + (n > 1 ? ((at / (n - 1)) - 0.5) * Math.min(listBox.width * 0.6, n * 28) : 0)
      const mid = (y + endY) / 2
      const d = `M ${x} ${y} C ${x} ${mid}, ${landX} ${mid}, ${landX} ${endY}`
      const hue = HUES[Math.max(0, this.#order.indexOf(host)) % HUES.length]
      const live = !isStack && (state === 'asking' || (state === 'answered' && (feed?.values.length ?? 0) > 0))
      const g = svgEl('g')
      g.dataset['host'] = host
      g.appendChild(svgEl('path', { d, class: 'base', fill: 'none', stroke: live ? hue : 'rgba(216,230,238,0.25)', 'stroke-width': 1.25, opacity: live ? 0.22 : 0.35, ...(live ? {} : { 'stroke-dasharray': '2 6' }) }))
      if (live) g.appendChild(svgEl('path', { d, class: `flow ${state}`, fill: 'none', stroke: hue, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.75 }))
      mount.svg.appendChild(g)
    })
    this.#highlight()
  }

  /** Light the lines, tiles and rows that belong to what the pointer is on. */
  #highlight(): void {
    const mount = this.#mount
    if (!mount) return
    const { host, value } = this.#hover
    const hostsLit = value ? new Set(value.hosts) : host ? new Set([host]) : null
    for (const g of Array.from(mount.svg.children) as SVGGElement[]) {
      const h = g.dataset['host'] ?? ''
      g.classList.toggle('lit', !!hostsLit?.has(h))
      g.classList.toggle('dim', !!hostsLit && !hostsLit.has(h))
    }
    for (const tile of Array.from(mount.row.children) as HTMLElement[]) {
      tile.style.opacity = hostsLit && !hostsLit.has(tile.dataset['host'] ?? '') ? '0.35' : '1'
    }
    const fedByHost = host ? new Set((this.#feeds.get(host)?.values ?? []).map(v => foldValue(v.text))) : null
    for (const line of Array.from(mount.list.children) as HTMLElement[]) {
      const fold = line.dataset['fold']
      line.style.opacity = fedByHost && fold && !fedByHost.has(fold) ? '0.3' : '1'
    }
  }

  async #promote(value: NeedValue): Promise<void> {
    const fold = foldValue(value.text)
    if (this.#promoted.has(fold) || this.#here.some(name => foldValue(name) === fold)) return
    const failed = (): void => {
      EffectBus.emit('toast:show', { type: 'error', message: this.#say('need.promote-failed', 'Could not add "{value}" here.', { value: value.text }) })
    }
    // A value is somebody else's text. The create commit reads `/` as nesting
    // and quietly refuses a reserved or saved word while still saying it
    // finished, so those are refused here, before anything is asked of it.
    const text = value.text.trim()
    const savedRoots = ioc<{ isSaved?: (name: string) => boolean }>('@diamondcoreprocessor.com/SavedRoots')
    if (!text || text.includes('/') || isReservedPoolWord(text) || savedRoots?.isSaved?.(text)) { failed(); return }
    this.#promoted.add(fold)
    this.#render()
    // WHERE YOU STAND — the place the grid and the tile list both show —
    // through THE create commit (commands/create-cells.ts): the one every
    // `create <name>` takes, with its landing rules (a holder's group, a
    // doorway's target) and its reserved and saved-word gates.
    const cell = normalizeCell(text)
    const creator = ioc<{ create?: (request: { parts: readonly string[]; requireCommitter?: boolean }) => Promise<{ made: boolean }> }>(CREATE_CELLS_IOC_KEY)
    const made = !!cell && !!creator?.create
      && (await creator.create({ parts: [cell], requireCommitter: true }).catch(() => ({ made: false }))).made
    if (!made) {
      this.#promoted.delete(fold)
      this.#render()
      failed()
      return
    }
    EffectBus.emit('activity:log', { message: this.#say('need.promoted', 'Added "{value}" from the servers', { value: text }), icon: 'add' })
    void this.#refreshHere()
  }

  #t(key: string, fallback: string): string {
    const out = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return out && out !== key ? out : fallback
  }

  /** `#t` with its `{token}` placeholders filled. */
  #say(key: string, fallback: string, params: Record<string, string | number> = {}): string {
    return this.#t(key, fallback).replace(/\{(\w+)\}/g, (whole, token: string) => token in params ? String(params[token]) : whole)
  }
}

const _explore = new ExploreQueenBee()
window.ioc.register('@ExploreQueenBee', _explore)

// FOLLOW THE MODE FROM THE START, so the view mounts however explore is
// turned on — its word, its icon, `view:toggle` — not only from the word.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc
  ?.whenReady?.('@hypercomb.social/ViewMode', () => _explore.wire())

/** A kind nobody has seen is globally off, and `setMode(explore)` would snap
 *  straight back to hexagons. Light it once, after the on-list exists, and
 *  never on a hive that opened dark (behavior-enablement.ts seedCohortOn). */
const lightExploreOnce = (): void => {
  if (!readGlobalOnKinds()) return
  seedCohortOn(EXPLORE_COHORT, [EXPLORE_KIND])
}
lightExploreOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightExploreOnce)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: EXPLORE_VIEW,
    slashCommand: '/explore',
    iconName: 'travel_explore',
    toggleIcon: 'travel_explore',
    behavior: 'render',
    decorationKind: EXPLORE_KIND,
    labelKey: 'view.explore',
    descriptionKey: 'view.explore.description',
    queenKey: '@ExploreQueenBee',
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)

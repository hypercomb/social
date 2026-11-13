// sharing/need-feeds.queen.ts
//
// `explore` — see what the servers hold for a name, and pull what you want
// (jwize 2026-11-12: "let's make it explore recipes instead of need";
// "create a new folder called favorite recipes and then call explore recipes
// and find them and pull them").
//
// A row of hexagons across the top, one per server feeding the name or still
// being asked, and one hexagon for every server that brought nothing. From each
// a line runs down into ONE list: every value the servers brought, folded,
// most-fed first. A thin flow moves along a line while its server is asked and
// keeps moving, slower, once it has brought something. Hover a value and the
// lines that fed it light; hover a server and its values light.
//
// `+` adds a value as a tile WHERE YOU ARE — the header says where that is —
// through the same create commit `create <name>` runs. `explore` alone asks
// for the tile you stand on; `explore recipes` asks for recipes from anywhere.
// Escape, the close button, a right-click, or walking elsewhere leaves.
//
// The other direction is `contribute` (contribute.queen.ts): a list for the
// tile you stand on, on a host, under your own key. The view's contribute
// button does the same when the name explored is the tile you stand on.
//
// The reads are need-feeds.ts. The list is the first view of the answers; a
// different view is a different `#renderValues`, fed the same merged rows.

import { EffectBus, I18N_IOC_KEY, QueenBee, isReservedPoolWord, type I18nProvider } from '@hypercomb/core'
import { feedNeed, foldValue, liveFeedDeps, mergeFeeds, type Feed, type NeedValue } from './need-feeds.js'
import { contributeHere, standingSegments } from './contribute.js'
import { GROUP_MIN_VALUES, groupKey, groupValues, liveGroupDeps, type ValueGroup } from './explore-groups.js'
import { childNamesAt, createTile } from '../commands/trait-read.js'
import { isLongPressMenu } from '../navigation/browser-menu.js'

const INK = '#0b0f14'
const BORDER = 'rgba(126,182,214,0.20)'
const TEXT = '#d8e6ee'
const DIM = 'rgba(216,230,238,0.55)'
const STEEL = 'rgb(126,182,214)'
/** One hue per host, in row order — the only colour on the surface. */
const HUES = ['#7eb6d6', '#d99a4e', '#6fbf94', '#c58bd6', '#d6c36f', '#cf6f5e', '#6fc7c7', '#a3a8d6']
/** Level with the postit view: above the canvas (59989) and its riders — the
 *  layer list a phone opens onto and the activity log (59990), the banners
 *  (59991) — and below edit-actions (59995), the bars (59999) and the header. */
const Z_BASE = 59992
const HEX_W = 112
const HEX_H = 98
const STYLE_ID = 'hc-need-feeds-style'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

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

type Mount = {
  host: HTMLDivElement
  summary: HTMLDivElement
  row: HTMLDivElement
  svg: SVGSVGElement
  list: HTMLDivElement
  stage: HTMLDivElement
  /** The right pane: the tiles of the layer you stand in, and the drop target. */
  mine: HTMLDivElement
  mineHead: HTMLDivElement
  /** The left pane's heading: where "grouping…" shows while the AI answers. */
  listHead: HTMLDivElement
}

/** The drag payload a value carries from the servers' pane to yours. */
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
    { input: 'explore', result: 'Every server you can ask, feeding one list of what they hold for this tile' },
    { input: 'explore recipes', result: 'What the servers hold for recipes; + adds a value where you are — try it inside favorite recipes' },
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
  #name = ''
  #feeds = new Map<string, Feed>()
  #order: string[] = []
  #promoted = new Set<string>()
  #run = 0
  #hover: { host?: string; value?: NeedValue } = {}
  /** Where the participant stood when the view opened; a value is added
   *  there, so walking elsewhere closes the view rather than add somewhere else. */
  #openedAt = ''
  /** The names of the tiles in the layer you stand in — the right pane. */
  #here: string[] = []
  /** Named AI groups for the current list (explore-groups.ts), null = flat. */
  #groups: ValueGroup[] | null = null
  /** The list the groups (or the ask under way) are for. */
  #groupKey = ''
  #grouping = false
  /** The one open group — an accordion, closed until a header is pressed. */
  #openGroup: string | null = null
  #groupDeps = liveGroupDeps()

  protected async execute(args: string): Promise<void> {
    const said = args.trim()
    const standing = standingSegments()
    const name = said || standing[standing.length - 1] || ''
    if (!name) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('need.stand', 'Stand on a tile first, or name one: explore recipes.') })
      return
    }
    const hosts = [...new Set(liveFeedDeps().hosts())]
    if (!hosts.length) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('need.no-hosts', 'No servers to ask yet — add one in the host directory (hosts).') })
      return
    }
    this.#promoted.clear()
    this.#feeds.clear()
    this.#order = hosts
    this.#open(name)
    this.#feed(false)
  }

  /** Ask every host for the open view's name. `fresh` asks past a remembered
   *  miss — the participant's own contribution just landed a pool. */
  #feed(fresh: boolean): void {
    const deps = liveFeedDeps()
    const hosts = [...new Set(deps.hosts())]
    const run = ++this.#run
    this.#feeds.clear()
    this.#order = hosts
    this.#render()
    void feedNeed(this.#name, feed => {
      if (run !== this.#run || !this.#mount) return
      this.#feeds.set(feed.host, feed)
      this.#render()
    }, { ...deps, hosts: () => hosts }, { fresh })
  }

  /** Where `+` adds: the tile you stand on, said in words. */
  #place(): { text: string; tip: string } {
    const standing = standingSegments()
    const place = standing[standing.length - 1] ?? ''
    return place
      ? { text: this.#say('need.adds-to', '+ adds to "{place}"', { place }), tip: this.#say('need.promote', 'Add to "{place}"', { place }) }
      : { text: this.#t('need.adds-to-root', "+ adds to your hive's root"), tip: this.#t('need.promote-root', "Add to your hive's root") }
  }

  // ── shell ───────────────────────────────────────────────────────────

  #open(name: string): void {
    this.#close()
    this.#name = name
    ensureStyle()
    const host = el('div',
      `position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:${Z_BASE};` +
      `overflow:auto;background:${INK};color:${TEXT};overscroll-behavior:contain;font-size:0.875rem;`)
    host.id = 'hc-need-feeds'
    host.setAttribute('data-consumes-wheel', '')

    // The shell's header and rail stay above every view (z 60000), so the
    // bar sits under the header in the page, never pinned behind it.
    // It wraps: at phone width the summary and the buttons drop to a second
    // line rather than push the page sideways.
    const bar = el('div',
      `display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;max-width:880px;margin:64px auto 0;padding:0 18px 12px;` +
      `border-bottom:1px solid ${BORDER};box-sizing:border-box;`)
    const brand = el('div', `font-size:0.8125rem;font-weight:700;letter-spacing:0.14em;color:${STEEL};flex:none;`, this.#t('need.brand', 'EXPLORE'))
    const title = el('div', 'flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', name)
    const summary = el('div', `color:${DIM};flex:0 1 auto;min-width:0;font-size:0.75rem;`)
    const close = el('button',
      `background:none;border:1px solid ${BORDER};color:${TEXT};border-radius:var(--hc-radius-control,2px);padding:4px 10px;cursor:pointer;font:inherit;`,
      this.#t('need.close', 'hexagons'))
    close.addEventListener('click', () => this.#close())
    // The participant's own click contributes their list (contribute.ts), then
    // the hosts are asked again past any remembered miss, so it shows at once.
    const offer = el('button',
      `background:none;border:1px solid ${BORDER};color:${STEEL};border-radius:var(--hc-radius-control,2px);padding:4px 10px;cursor:pointer;font:inherit;`,
      this.#t('need.offer', 'contribute'))
    offer.title = this.#t('need.offer-title', 'Contribute the names of the tiles under the one you stand on, as a list on your host')
    offer.addEventListener('click', async () => {
      offer.disabled = true
      try {
        if (await contributeHere('') && this.#mount?.host === host) this.#feed(true)
      } finally { offer.disabled = false }
    })
    // A contribution is for the tile you STAND on, so the button is only there
    // when that is the name explored — `explore <other name>` shows none.
    const standing = standingSegments()
    offer.style.display = foldValue(standing[standing.length - 1] ?? '') === foldValue(name) ? '' : 'none'
    // WHERE `+` ADDS, said plainly (jwize: "the inserted should go where ever
    // you are but it should be more clear"): its own line under the bar.
    const place = el('div', `flex:1 1 100%;font-size:0.75rem;color:${STEEL};`, this.#place().text)
    bar.append(brand, title, summary, offer, close, place)

    // The stage holds the row, the lines and the list; the lines are one SVG
    // laid over the whole stage, measured from the tiles and the list.
    const stage = el('div', 'position:relative;padding:36px 16px 48px;')
    const svg = svgEl('svg')
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;'
    // `safe center`: when the hosts overflow the width, the row starts at its
    // left edge and scrolls, instead of spilling the first hosts out of reach.
    const row = el('div', 'position:relative;display:flex;justify-content:safe center;flex-wrap:nowrap;gap:14px;overflow-x:auto;padding:4px 4px 8px;')
    // THE SPLIT PANE (jwize 2026-11-12: "there should be split pane where we can
    // move the recipes from the aggregated into our recipes by drag and drop
    // into our current layer"): what the servers brought on the left, the layer
    // you stand in on the right. Drag a value across — or press its + — and it
    // becomes a tile here. At phone width the panes stack.
    const paneHead = `font-size:0.75rem;letter-spacing:0.06em;color:${DIM};padding:0 2px 6px;`
    const panes = el('div', 'position:relative;display:flex;flex-wrap:wrap;gap:16px;max-width:980px;margin:120px auto 0;align-items:flex-start;')
    const left = el('div', 'flex:1 1 340px;min-width:0;')
    const list = el('div', `position:relative;border:1px solid ${BORDER};border-radius:var(--hc-radius-card,3px);background:rgba(126,182,214,0.04);`)
    const listHead = el('div', paneHead, this.#t('need.pane-servers', 'From the servers'))
    left.append(listHead, list)
    const right = el('div', 'flex:1 1 260px;min-width:0;')
    const mineHead = el('div', paneHead)
    const mine = el('div',
      `min-height:140px;border:1px dashed ${BORDER};border-radius:var(--hc-radius-card,3px);background:rgba(126,182,214,0.02);transition:background .12s,border-color .12s;`)
    right.append(mineHead, mine)
    panes.append(left, right)
    this.#wireDrop(right, mine)
    stage.append(svg, row, panes)
    host.append(bar, stage)

    host.addEventListener('contextmenu', e => {
      if (isLongPressMenu(e)) return
      e.preventDefault()
      this.#close()
    })
    row.addEventListener('scroll', () => this.#drawLines())
    document.body.appendChild(host)
    this.#mount = { host, summary, row, svg, list, stage, mine, mineHead, listHead }
    this.#openedAt = standingSegments().join('\u0000')
    this.#here = []
    this.#groups = null
    this.#groupKey = ''
    this.#grouping = false
    this.#openGroup = null
    void this.#refreshHere()
    // The hive underneath cannot be seen, so none of its keys may act on it:
    // the keymap is HELD (stronger than suppressed — Escape's cascade and
    // Delete's remove included) and this view's own Escape closes it.
    EffectBus.emitTransient('keymap:hold', { reason: KEYMAP_REASON })
    window.addEventListener('keydown', this.#onKey, true)
    window.addEventListener('resize', this.#onResize)
    ioc<LineageLike>('@hypercomb.social/Lineage')?.addEventListener?.('change', this.#onMoved)
    this.#render()
  }

  #close(): void {
    if (!this.#mount) return
    this.#run++
    this.#mount.host.remove()
    this.#mount = null
    this.#hover = {}
    EffectBus.emitTransient('keymap:release', { reason: KEYMAP_REASON })
    window.removeEventListener('keydown', this.#onKey, true)
    window.removeEventListener('resize', this.#onResize)
    ioc<LineageLike>('@hypercomb.social/Lineage')?.removeEventListener?.('change', this.#onMoved)
  }

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#mount) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#close()
  }

  /** The lineage also says `change` when a page merely finishes loading, so
   *  only a real move — a different place — closes the view. */
  #onMoved = (): void => {
    if (this.#mount && standingSegments().join('\u0000') !== this.#openedAt) this.#close()
  }

  #onResize = (): void => this.#drawLines()

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
    this.#renderHere()
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

  /** The right pane: the tiles in the layer you stand in, newest added last. */
  #renderHere(): void {
    const mount = this.#mount
    if (!mount) return
    const standing = standingSegments()
    const place = standing[standing.length - 1] ?? ''
    mount.mineHead.textContent = place
      ? this.#say('need.pane-here', 'In "{place}"', { place })
      : this.#t('need.pane-here-root', "In your hive's root")
    mount.mine.replaceChildren()
    if (!this.#here.length) {
      mount.mine.appendChild(el('div', `padding:24px 14px;text-align:center;color:${DIM};font-size:0.8125rem;`,
        this.#t('need.pane-drop', 'Drag a value here to add it')))
      return
    }
    for (const name of this.#here) {
      mount.mine.appendChild(el('div',
        'padding:8px 12px;border-top:1px solid rgba(126,182,214,0.08);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', name))
    }
  }

  /** Read the layer you stand in again (on open, and after a value lands). */
  async #refreshHere(): Promise<void> {
    // The same open view, still: a closed or re-opened one drops this answer.
    const mount = this.#mount
    const names = await childNamesAt(standingSegments()).catch(() => [] as string[])
    if (!mount || mount !== this.#mount) return
    this.#here = names
    this.#render()
  }

  /** The right pane takes a dragged value; it lights while one is over it. */
  #wireDrop(zone: HTMLElement, mine: HTMLElement): void {
    const carries = (event: DragEvent): boolean => !!event.dataTransfer && [...event.dataTransfer.types].includes(DRAG_TYPE)
    const light = (on: boolean): void => {
      mine.style.background = on ? 'rgba(126,182,214,0.10)' : 'rgba(126,182,214,0.02)'
      mine.style.borderColor = on ? STEEL : BORDER
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
    // Where you are — the header says where that is.
    const made = await createTile(text).catch(() => false)
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

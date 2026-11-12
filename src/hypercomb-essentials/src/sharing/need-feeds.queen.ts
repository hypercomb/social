// sharing/need-feeds.queen.ts
//
// `need` — show the servers feeding the tile you stand on.
//
// A row of hexagons across the top, one per host this participant can ask.
// From each one a line runs down into ONE list: every value the hosts brought
// for the need, folded, most-fed first. A thin flow moves along a line while
// its host is being asked and keeps moving, slower, once it has brought
// something; a host that holds nothing or never answered is a still, dim line.
// Hover a value and the lines that fed it light; hover a host and its values
// light. `+` promotes a value onto the need — it becomes a tile here, through
// the same create commit `create <name>` runs.
//
// `need` uses the tile you stand on; `need <name>` asks for another name and
// still promotes onto where you stand. Escape, the close button, or a
// right-click leaves. Nothing is written until you promote.
//
// `need offer` is the other direction: it OFFERS a list for the tile you stand
// on, on a host, under your own key (need-lists.ts) — the names of the tiles
// under it, or the values you say (`need offer a, b, c`). The host is the one
// you name (`@host`), else the first host of the branch. The bar's "offer
// mine" button does the same with no values named, then asks the hosts again.
// Publishing is the participant's own act: a model is refused the word.
//
// The reads are need-feeds.ts. The list is the first view of the answers; a
// different view is a different `#renderValues`, fed the same merged rows.

import { EffectBus, I18N_IOC_KEY, QueenBee, isReservedPoolWord, type I18nProvider } from '@hypercomb/core'
import { feedNeed, foldValue, liveFeedDeps, mergeFeeds, type Feed, type NeedValue } from './need-feeds.js'
import { NEED_LIST_VALUES_MAX, offerNeedList } from './need-lists.js'
import { hostOfferDeps } from './host-offer.js'
import { hostsOfBranch } from './community-hosts.js'
import { zoneDoor } from './zone-door.js'
import { createTile } from '../commands/trait-read.js'
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
type HistoryLike = {
  sign?(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt?(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<{ name?: unknown } | null>
}

const SIG_RE = /^[0-9a-f]{64}$/

const standingSegments = (): string[] =>
  [...(ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])].map(String)

/** The names of the tiles under where you stand, in their own order. */
const childNamesHere = async (segments: readonly string[]): Promise<string[]> => {
  const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history?.sign || !history.currentLayerAt || !history.getLayerBySig) return []
  const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
  const children = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
  const names: string[] = []
  for (const child of children.slice(0, NEED_LIST_VALUES_MAX)) {
    const sig = String(typeof child === 'string' ? child : (child as { sig?: unknown } | null)?.sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(sig)) continue
    const name = String((await history.getLayerBySig(sig).catch(() => null))?.name ?? '').trim()
    if (name) names.push(name)
  }
  return names
}

/** `need offer` arguments: the values said (comma-separated) and the host
 *  named with `@`. No values said = null, the tiles under where you stand. */
export const parseOffer = (rest: string): { values: string[] | null; host: string } => {
  const host = /(?:^|\s)@(\S+)/.exec(rest)?.[1] ?? ''
  const said = rest.replace(/(?:^|\s)@\S+/g, ' ').trim()
  const values = said ? said.split(',').map(v => v.trim()).filter(Boolean) : []
  return { values: values.length ? values : null, host }
}

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
}

export class NeedQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'need'
  override description = 'Show the servers feeding the tile you stand on, and promote what they bring'
  override descriptionKey = 'slash.need'
  // The words after `need` are the word's own: free-text values and an
  // `@host:port` must not be read as tag grammar or as further behaviour words.
  override rawArgs = true
  override options = ['', '<name>', 'offer [<value>, <value>, ...] [@<host>]']
  override examples = [
    { input: 'need', result: 'Every host you can ask, feeding one list of what they hold for this tile' },
    { input: 'need recipes', result: 'The same, asked for recipes — promoted values still land here' },
    { input: 'need offer', result: 'Offers the names of the tiles under this one as a list for it, on the branch\'s host' },
    { input: 'need offer soup, bread @example.com', result: 'Offers those values for this tile, on example.com, under your key' },
  ]
  override machine = {
    forms: 'need | need <name>',
    example: '/need recipes',
    bare: true,
    reach: 'additive' as const,
    scope: 'local' as const,
    refuse: (args: string): string | undefined => {
      const [word = ''] = args.trim().toLowerCase().split(/\s+/)
      return word === 'offer' ? `/need ${word} publishes under the participant's key; only the participant says it` : undefined
    },
  }

  #mount: Mount | null = null
  #name = ''
  #feeds = new Map<string, Feed>()
  #order: string[] = []
  #promoted = new Set<string>()
  #run = 0
  #hover: { host?: string; value?: NeedValue } = {}
  /** Where the participant stood when the view opened; a promote lands here,
   *  so walking elsewhere closes the view rather than promote somewhere else. */
  #openedAt = ''

  protected async execute(args: string): Promise<void> {
    const said = args.trim()
    const [word = ''] = said.split(/\s+/)
    if (word.toLowerCase() === 'offer') {
      await this.#offer(said.slice(word.length))
      return
    }
    const standing = standingSegments()
    const name = said || standing[standing.length - 1] || ''
    if (!name) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('need.stand', 'Stand on a tile first — its name is the need the servers feed.') })
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
   *  miss — the participant's own offer just landed a pool. */
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

  // ── offer ───────────────────────────────────────────────────────────

  /**
   * Offer a list for the tile you stand on — the participant's own act, run
   * only by their typed word or their click. Values: the ones said, else the
   * names of the tiles under it. Host: the one named, else the branch's first.
   * True when the list landed.
   */
  async #offer(rest: string): Promise<boolean> {
    const toast = (type: string, message: string): void => { EffectBus.emit('toast:show', { type, message }) }
    const standing = standingSegments()
    const name = standing[standing.length - 1] ?? ''
    if (!name) {
      toast('tip', this.#say('need.offer-root', 'Stand on a tile first — its name is what the list is offered for.'))
      return false
    }
    const said = parseOffer(rest)
    const values = said.values ?? await childNamesHere(standing).catch(() => [])
    if (!values.length) {
      toast('warning', this.#say('need.offer-empty', 'Nothing to offer: "{name}" has no tiles under it — say need offer a, b, c.', { name }))
      return false
    }
    const host = zoneDoor(said.host) || (await hostsOfBranch(standing).catch(() => []))[0] || ''
    if (!host) {
      toast('warning', this.#say('need.offer-nohost', 'No host for "{name}" — say need offer @<host>.', { name }))
      return false
    }
    const deps = hostOfferDeps()
    const done = deps
      ? await offerNeedList(host, name, values, deps).catch((error: unknown) => ({ ok: false as const, error: String((error as Error)?.message ?? error) }))
      : { ok: false as const, error: 'the store or the host service is not loaded' }
    if (!done.ok) {
      toast('warning', this.#say('need.offer-failed', 'The list for "{name}" was not offered: {reason}', { name, reason: done.error }))
      return false
    }
    toast('success', this.#say('need.offer-done', 'Offered {count} values for "{name}" on {host}', { count: done.record.values.length, name, host }))
    EffectBus.emit('need:offered', { name, host, record: done.sig, count: done.record.values.length })
    return true
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
    const brand = el('div', `font-size:0.8125rem;font-weight:700;letter-spacing:0.14em;color:${STEEL};flex:none;`, this.#t('need.brand', 'NEED'))
    const title = el('div', 'flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', name)
    const summary = el('div', `color:${DIM};flex:0 1 auto;min-width:0;font-size:0.75rem;`)
    const close = el('button',
      `background:none;border:1px solid ${BORDER};color:${TEXT};border-radius:var(--hc-radius-control,2px);padding:4px 10px;cursor:pointer;font:inherit;`,
      this.#t('need.close', 'hexagons'))
    close.addEventListener('click', () => this.#close())
    // The participant's own click offers their list, then the hosts are asked
    // again past any remembered miss, so the new pool shows at once.
    const offer = el('button',
      `background:none;border:1px solid ${BORDER};color:${STEEL};border-radius:var(--hc-radius-control,2px);padding:4px 10px;cursor:pointer;font:inherit;`,
      this.#t('need.offer', 'offer mine'))
    offer.title = this.#t('need.offer-title', 'Offer the names of the tiles under the one you stand on, as a list on your host')
    offer.addEventListener('click', async () => {
      offer.disabled = true
      try {
        if (await this.#offer('') && this.#mount?.host === host) this.#feed(true)
      } finally { offer.disabled = false }
    })
    // The button offers for the tile you STAND on, so it is only offered when
    // that is the name on screen — `need <other name>` shows no offer.
    const standing = standingSegments()
    offer.style.display = foldValue(standing[standing.length - 1] ?? '') === foldValue(name) ? '' : 'none'
    bar.append(brand, title, summary, offer, close)

    // The stage holds the row, the lines and the list; the lines are one SVG
    // laid over the whole stage, measured from the tiles and the list.
    const stage = el('div', 'position:relative;padding:36px 16px 48px;')
    const svg = svgEl('svg')
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;'
    // `safe center`: when the hosts overflow the width, the row starts at its
    // left edge and scrolls, instead of spilling the first hosts out of reach.
    const row = el('div', 'position:relative;display:flex;justify-content:safe center;flex-wrap:nowrap;gap:14px;overflow-x:auto;padding:4px 4px 8px;')
    const list = el('div', `position:relative;max-width:640px;margin:120px auto 0;border:1px solid ${BORDER};border-radius:var(--hc-radius-card,3px);background:rgba(126,182,214,0.04);`)
    stage.append(svg, row, list)
    host.append(bar, stage)

    host.addEventListener('contextmenu', e => {
      if (isLongPressMenu(e)) return
      e.preventDefault()
      this.#close()
    })
    row.addEventListener('scroll', () => this.#drawLines())
    document.body.appendChild(host)
    this.#mount = { host, summary, row, svg, list, stage }
    this.#openedAt = standingSegments().join('\u0000')
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
    this.#renderValues(values)
    // Drawn now, not on a frame: measuring forces the layout, and a hidden
    // tab never runs a frame.
    this.#drawLines()
  }

  #renderRow(feeds: readonly Feed[]): void {
    const row = this.#mount!.row
    row.replaceChildren()
    feeds.forEach((feed, i) => {
      const hue = HUES[i % HUES.length]
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
    if (!values.length) {
      const asking = this.#order.some(host => (this.#feeds.get(host)?.state ?? 'asking') === 'asking')
      list.appendChild(el('div', `padding:18px;text-align:center;color:${DIM};`,
        asking ? this.#t('need.waiting', 'Waiting for the servers…') : this.#t('need.nothing', 'No server brought anything for this need.')))
      return
    }
    for (const value of values) {
      const line = el('div', `display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid rgba(126,182,214,0.08);transition:opacity .15s;`)
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
      const done = this.#promoted.has(fold)
      const promote = el('button',
        `flex:none;background:none;border:1px solid ${BORDER};color:${done ? DIM : STEEL};border-radius:var(--hc-radius-control,2px);padding:2px 9px;font:inherit;cursor:${done ? 'default' : 'pointer'};`,
        done ? this.#t('need.added', 'added') : '+')
      promote.title = this.#t('need.promote', 'Add as a tile here')
      promote.disabled = done
      promote.addEventListener('click', () => void this.#promote(value))
      line.append(dots, text, count, promote)
      line.addEventListener('mouseenter', () => { this.#hover = { value }; this.#highlight() })
      line.addEventListener('mouseleave', () => { this.#hover = {}; this.#highlight() })
      list.appendChild(line)
    }
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
    for (const tile of Array.from(mount.row.children) as HTMLElement[]) {
      const host = tile.dataset['host'] ?? ''
      const feed = this.#feeds.get(host)
      const state = feed?.state ?? 'asking'
      const box = tile.getBoundingClientRect()
      const x = box.left - origin.left + box.width / 2
      const y = box.bottom - origin.top
      // Spread the landings across the list's head so the lines arrive apart.
      const i = this.#order.indexOf(host)
      const n = Math.max(1, this.#order.length)
      const landX = endX + (n > 1 ? ((i / (n - 1)) - 0.5) * Math.min(listBox.width * 0.6, n * 28) : 0)
      const mid = (y + endY) / 2
      const d = `M ${x} ${y} C ${x} ${mid}, ${landX} ${mid}, ${landX} ${endY}`
      const hue = HUES[i % HUES.length]
      const live = state === 'asking' || (state === 'answered' && (feed?.values.length ?? 0) > 0)
      const g = svgEl('g')
      g.dataset['host'] = host
      g.appendChild(svgEl('path', { d, class: 'base', fill: 'none', stroke: live ? hue : 'rgba(216,230,238,0.25)', 'stroke-width': 1.25, opacity: live ? 0.22 : 0.35, ...(live ? {} : { 'stroke-dasharray': '2 6' }) }))
      if (live) g.appendChild(svgEl('path', { d, class: `flow ${state}`, fill: 'none', stroke: hue, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.75 }))
      mount.svg.appendChild(g)
    }
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
    if (this.#promoted.has(fold)) return
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
    const made = await createTile(text).catch(() => false)
    if (!made) {
      this.#promoted.delete(fold)
      this.#render()
      failed()
      return
    }
    EffectBus.emit('activity:log', { message: this.#say('need.promoted', 'Added "{value}" from the servers', { value: text }), icon: 'add' })
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

const _need = new NeedQueenBee()
window.ioc.register('@NeedQueenBee', _need)

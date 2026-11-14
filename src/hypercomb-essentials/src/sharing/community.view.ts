// sharing/community.view.ts
//
// YOUR COMMUNITY, MANAGED (jwize 2026-10-25). The window shows the label of the current group — All,
// or a community — and a swipe, a tap on the label or the arrow keys turn to the next. To the right of
// the search is the Manage icon: in it the label can be renamed, EVERY candidate tile is shown, and a
// tile is switched on or off for that group with one tap; the ones off are grayed. Leaving Manage hides
// them. Undo and redo are kept while the window is open. Signing is a deliberate act of its own
// (`community publish`): a switch only edits the draft, never what visitors see.
//
// THE THIRD STAGE OF A PUBLISH (jwize 2026-11-13): replicate (follow a host), the domain (a creation is
// on or off in that domain's list), the community. What is on in a domain stands here grayed while
// managing; a click promotes it, and a click on one that is on takes it back out — in the domain, not in
// the community. The same name on different domains is one tile each, saying its domain.

import { EffectBus, requestConfirm } from '@hypercomb/core'
import { communityCandidates, type CommunityCandidate, type OfferedInstance } from './community-candidates.js'
import { CommunityDraft } from './community.draft.js'
import { publisherKeyHex } from './key-list.client.js'
import {
  addCommunity, communityKey, readSignedShowcase, removeCommunity, renameCommunity, setCommunityView, setView,
  signShowcase, stepView, toggleCommunityItem, toggleItem, viewLabel,
  type Showcase, type ShowcaseItem, type ShowcaseView,
} from './showcase-record.js'

const STYLE_ID = 'hc-community-window-styles'
const SIG = /^[0-9a-f]{64}$/
/** static-peers.drone.ts holds what is on in each domain; named by key, never imported (it registers itself). */
const STATIC_PEERS_KEY = '@diamondcoreprocessor.com/StaticPeersDrone'

/** What is on in the domains you follow — step two of the publish, read where it is kept. */
const onInDomains = (): readonly OfferedInstance[] => {
  const peers = (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(STATIC_PEERS_KEY) as
    { offeredInstances?: () => readonly OfferedInstance[] } | undefined
  try { return peers?.offeredInstances?.() ?? [] } catch { return [] }
}

const say = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }

/** The front door's gestureStep, kept here because a module may not import the shim.
 *  Across is back and forward; up and down is the other axis. A drag that is neither is not a swipe. */
const gestureStep = (dx: number, dy: number, ms: number): { readonly axis: 'x' | 'y'; readonly by: -1 | 1 } | null => {
  const across = Math.abs(dx)
  const down = Math.abs(dy)
  const far = (span: number): boolean => span >= 56 || (span >= 24 && span / Math.max(1, ms) >= 0.3)
  if (far(across) && across >= 1.4 * down) return { axis: 'x', by: dx < 0 ? 1 : -1 }
  if (far(down) && down >= 1.4 * across) return { axis: 'y', by: dy < 0 ? 1 : -1 }
  return null
}

/** The lineages this key publishes on the zone — what can be put in the showcase. */
const candidates = async (zone: string, pubkey: string): Promise<ShowcaseItem[]> => {
  try {
    const response = await fetch(`https://${zone}/publications.json`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return []
    const body = await response.json() as {
      sites?: Array<{
        lineage?: unknown
        host?: unknown
        hosts?: unknown
        publishers?: Array<{ pubkey?: unknown; head?: unknown }>
      }>
    }
    const names = new Set<string>()
    for (const site of body.sites ?? []) {
      const lineage = typeof site.lineage === 'string' ? site.lineage : ''
      // A nested lineage (`work/meetings`) is a real hive. One with no verified
      // head, or that does not answer on this domain, is not a candidate.
      if (!lineage || lineage.length > 200 || lineage === zone || /[\s:]/.test(lineage)) continue
      const extra = Array.isArray(site.hosts) ? site.hosts : []
      const hosts = [site.host, ...extra.map(row => (row && typeof row === 'object' ? (row as { host?: unknown }).host : undefined))]
      if (!hosts.some(host => typeof host === 'string' && (host.toLowerCase() === zone || host.toLowerCase().endsWith(`.${zone}`)))) continue
      if ((site.publishers ?? []).some(row => String(row.pubkey ?? '').toLowerCase() === pubkey
        && /^[a-f0-9]{64}$/.test(String(row.head ?? '')))) names.add(lineage)
    }
    return [...names].sort().map(lineage => ({ pubkey, lineage }))
  } catch { return [] }
}

const same = (a: ShowcaseItem, b: ShowcaseItem): boolean => a.pubkey === b.pubkey && a.lineage === b.lineage

export class CommunityView extends EventTarget {
  #window: HTMLDivElement | null = null
  #draft: CommunityDraft | null = null
  /** This key's lineages on the zone, read once when the window opens. */
  #own: ShowcaseItem[] = []
  /** What the record named when the window opened: a tile taken out stays, grayed, until the window closes. */
  #named: ShowcaseItem[] = []
  /** Every tile the window can draw: your own, what is on in a domain, what the record names. */
  #options: CommunityCandidate[] = []
  #page = '' // '' is All
  #managing = false
  #query = ''

  constructor() {
    super()
    EffectBus.on<{ zone?: string }>('community:open', payload => { void this.open(payload?.zone) })
    EffectBus.on('community:publish', () => { void this.publish() })
    // A creation turned on or off in a domain while this window is open arrives, or leaves, at once.
    EffectBus.on('community:offers-render', () => { if (this.#window) this.#renderTiles() })
  }

  async open(zone?: string): Promise<void> {
    if (this.#window) { this.#window.focus(); return }
    const target = (zone ?? '').trim().toLowerCase()
    if (!target) { say('community takes a domain — community <domain>', 'warning'); return }
    const pubkey = String(await publisherKeyHex().catch(() => '') ?? '').toLowerCase()
    if (!SIG.test(pubkey)) { say('community needs your publishing key, and this hive has none yet', 'warning'); return }
    const [options, signed] = await Promise.all([candidates(target, pubkey), readSignedShowcase(target).catch(() => {
      say('The community could not be read.', 'warning'); return undefined
    })])
    if (signed === undefined) return
    this.#own = options
    this.#named = [...(signed?.items ?? [])]
    this.#draft = new CommunityDraft(signed ?? { zone: target, items: [], domains: [] })
    this.#page = ''
    this.#managing = false
    this.#query = ''
    this.#ensureStyles()
    const win = document.createElement('div')
    win.className = 'hc-community-window'
    win.tabIndex = -1
    win.addEventListener('keydown', event => this.#key(event))
    let startX = 0
    let startY = 0
    let startAt = 0
    win.addEventListener('pointerdown', event => { startX = event.clientX; startY = event.clientY; startAt = event.timeStamp })
    win.addEventListener('pointerup', event => {
      if (event.pointerType === 'mouse') return
      const step = gestureStep(event.clientX - startX, event.clientY - startY, event.timeStamp - startAt)
      if (!step) return
      // Managing: sideways changes the template, up and down changes the set.
      // Otherwise a sideways swipe is back and forward through the sets.
      if (this.#managing) {
        if (step.axis === 'x') this.#stepTemplate(step.by)
        else this.#turn(step.by)
      } else if (step.axis === 'x') this.#turn(step.by)
    })
    document.body.appendChild(win)
    this.#window = win
    this.#render()
    win.focus()
  }

  close(): void { this.#window?.remove(); this.#window = null; this.#draft = null }

  async publish(): Promise<void> {
    const draft = this.#draft
    if (!draft) { say('Open the community first — community <domain>', 'warning'); return }
    const record = draft.current
    const ok = await requestConfirm({
      title: 'Publish your community',
      message: `Visitors of ${record.zone} will see this community: ${record.items.length} tiles, ${(record.communities ?? []).length} groups.`,
      confirmLabel: 'Publish',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    const result = await signShowcase(record)
    say(result.ok ? `Community published for ${record.zone}` : `Community not published: ${result.reason}`, result.ok ? 'success' : 'error')
  }

  #pages(): string[] { return ['', ...(this.#draft?.current.communities ?? []).map(row => communityKey(row.name))] }

  #turn(by: number): void {
    const keys = this.#pages()
    this.#page = keys[(Math.max(0, keys.indexOf(this.#page)) + by + keys.length) % keys.length]!
    this.#render()
  }

  #key(event: KeyboardEvent): void {
    const typing = event.target instanceof HTMLInputElement
    const mod = event.ctrlKey || event.metaKey
    const letter = event.key.toLowerCase()
    if (mod && !event.shiftKey && letter === 'z') { event.preventDefault(); this.#undo() }
    else if (mod && (letter === 'y' || (event.shiftKey && letter === 'z'))) { event.preventDefault(); this.#redo() }
    else if (!typing && event.key === 'ArrowRight') { event.preventDefault(); if (this.#managing) this.#stepTemplate(1); else this.#turn(1) }
    else if (!typing && event.key === 'ArrowLeft') { event.preventDefault(); if (this.#managing) this.#stepTemplate(-1); else this.#turn(-1) }
    else if (!typing && this.#managing && event.key === 'ArrowDown') { event.preventDefault(); this.#turn(1) }
    else if (!typing && this.#managing && event.key === 'ArrowUp') { event.preventDefault(); this.#turn(-1) }
    else if (!typing && event.key === 'Escape') this.close()
  }

  #undo(): void { if (this.#draft?.undo()) { this.#keepPage(); this.#render() } }
  #redo(): void { if (this.#draft?.redo()) { this.#keepPage(); this.#render() } }
  #keepPage(): void { if (!this.#pages().includes(this.#page)) this.#page = '' }

  #inGroup(item: ShowcaseItem): boolean {
    const record = this.#draft!.current
    if (!record.items.some(row => same(row, item))) return false
    if (!this.#page) return true
    const community = (record.communities ?? []).find(row => communityKey(row.name) === this.#page)
    return !!community?.items.some(row => same(row, item))
  }

  #toggle(item: ShowcaseItem): void {
    const draft = this.#draft!
    if (!this.#page) { draft.apply(toggleItem(draft.current, item)); this.#render(); return }
    // Turning a tile on in a group turns it on in the showcase too: a group only filters.
    let record = draft.current
    if (!record.items.some(row => same(row, item))) record = toggleItem(record, item)
    draft.apply(toggleCommunityItem(record, this.#page, item))
    this.#render()
  }

  #rename(raw: string): void {
    const draft = this.#draft!
    const result = renameCommunity(draft.current, this.#page, raw)
    if (!result.ok) { say(`That name is not available (${result.reason}).`, 'warning'); this.#render(); return }
    draft.apply(result.showcase)
    this.#page = result.key
    this.#render()
  }

  /** Sideways while managing: the next template for this page. All's hexagons are stored by saying nothing. */
  #stepTemplate(by: -1 | 1): void {
    const draft = this.#draft
    if (!draft) return
    const record = draft.current
    const current = (record.communities ?? []).find(row => communityKey(row.name) === this.#page)
    const view: ShowcaseView = (current ? current.view : undefined) ?? record.view ?? 'hex'
    const next = stepView(view, by)
    draft.apply(current ? setCommunityView(record, this.#page, next) : setView(record, next === 'hex' ? undefined : next))
    this.#render()
  }

  #create(raw: string): void {
    const draft = this.#draft!
    const result = addCommunity(draft.current, raw)
    if (!result.ok) { say(`That name is not available (${result.reason}).`, 'warning'); return }
    draft.apply(result.showcase)
    this.#page = result.key
    this.#render()
  }

  #el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }

  #button(label: string, action: () => void, title?: string): HTMLButtonElement {
    const button = this.#el('button', '', label)
    button.type = 'button'
    if (title) { button.title = title; button.setAttribute('aria-label', title) }
    button.addEventListener('click', action)
    return button
  }

  #render(): void {
    const win = this.#window
    const draft = this.#draft
    if (!win || !draft) return
    const record = draft.current
    const current = (record.communities ?? []).find(row => communityKey(row.name) === this.#page)
    win.replaceChildren()

    const head = this.#el('header')
    head.append(this.#el('strong', '', record.zone), this.#button('×', () => this.close(), 'Close'))

    // The search, with the Manage icon to its right.
    const bar = this.#el('div', 'hc-community-bar')
    const search = this.#el('input')
    search.type = 'search'
    search.placeholder = 'Search'
    search.value = this.#query
    search.addEventListener('input', () => { this.#query = search.value; this.#renderTiles() })
    const manage = this.#button('', () => { this.#managing = !this.#managing; this.#render() }, 'Manage')
    manage.classList.add('hc-community-manage')
    manage.setAttribute('aria-pressed', String(this.#managing))
    manage.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>'
    bar.append(search, manage)

    // The label of the current group; in Manage it is the field that renames it.
    const label = this.#el('div', 'hc-community-label')
    if (this.#managing && current) {
      const name = this.#el('input')
      name.value = current.name
      name.setAttribute('aria-label', 'Group name')
      name.addEventListener('change', () => this.#rename(name.value))
      label.append(name)
    } else {
      const text = this.#button(current?.name ?? 'All', () => this.#turn(1), 'Next group')
      text.classList.add('hc-community-name')
      label.append(text)
    }
    if (this.#managing) {
      const fresh = this.#el('input')
      fresh.placeholder = 'New group'
      fresh.addEventListener('keydown', event => { if (event.key === 'Enter' && fresh.value.trim()) this.#create(fresh.value) })
      label.append(fresh)
      const view: ShowcaseView = (current ? current.view : undefined) ?? record.view ?? 'hex'
      label.append(this.#button(viewLabel(view), () => this.#stepTemplate(1), 'Swipe sideways to change the template. Up or down changes the set.'))
      if (current) label.append(this.#button('Delete group', () => { draft.apply(removeCommunity(record, this.#page)); this.#page = ''; this.#render() }))
    }

    const tools = this.#el('div', 'hc-community-tools')
    const undo = this.#button('↶', () => this.#undo(), 'Undo')
    undo.disabled = !draft.canUndo
    const redo = this.#button('↷', () => this.#redo(), 'Redo')
    redo.disabled = !draft.canRedo
    const publish = this.#button('Publish', () => { void this.publish() }, 'Sign this community for visitors')
    publish.classList.add('primary')
    tools.append(undo, redo, publish)

    win.append(head, bar, label, this.#el('div', 'hc-community-tiles'), tools)
    this.#renderTiles()
  }

  #renderTiles(): void {
    const tiles = this.#window?.querySelector('.hc-community-tiles')
    if (!tiles || !this.#draft) return
    tiles.replaceChildren()
    this.#options = communityCandidates(this.#own, onInDomains(), [...this.#named, ...this.#draft.current.items])
    const query = this.#query.trim().toLowerCase()
    let shown = 0
    for (const item of this.#options) {
      const where = item.hosts.join(', ')
      if (query && !`${item.lineage} ${where}`.toLowerCase().includes(query)) continue
      const on = this.#inGroup(item)
      // Viewing shows what is on; managing shows everything, the ones off grayed.
      if (!on && !this.#managing) continue
      const tile = this.#el('button', on ? 'hc-community-tile' : 'hc-community-tile off')
      tile.type = 'button'
      // The word, and under it the domain it is on: what tells two of the same name apart.
      tile.append(this.#el('span', 'hc-community-tile-name', item.hosts.length ? item.name : item.lineage))
      if (where) tile.append(this.#el('span', 'hc-community-tile-host', where))
      tile.title = where
        ? (on ? `${item.name} from ${where} is in your community. Press to take it out; it stays on in its domain.`
          : `${item.name} is on in ${where}. Press to promote it to your community.`)
        : item.lineage
      tile.setAttribute('aria-pressed', String(on))
      if (this.#managing) tile.addEventListener('click', () => this.#toggle(item))
      else tile.disabled = true
      tiles.append(tile)
      shown++
    }
    if (!shown) tiles.append(this.#el('p', 'hc-community-empty', this.#managing
      ? 'Nothing to promote yet. Turn a creation on in a domain you follow, or publish one here.'
      : 'Nothing is on for this group. Use Manage to turn tiles on.'))
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-community-window{position:fixed;z-index:100000;inset:clamp(.5rem,6vh,4rem) clamp(.5rem,8vw,6rem);margin:auto;max-width:44rem;max-height:46rem;
  display:flex;flex-direction:column;gap:.7rem;padding:1rem;color:#eef4fa;background:rgba(7,10,15,.98);border:1px solid rgba(126,182,214,.38);
  border-radius:var(--hc-radius-floating,4px);box-shadow:0 1.5rem 5rem rgba(0,0,0,.55);font-family:var(--hc-sans,system-ui,sans-serif);touch-action:pan-y}
.hc-community-window header{display:flex;align-items:center;justify-content:space-between}
.hc-community-window button{min-height:2.2rem;padding:.35rem .7rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.05);color:#edf3f8;cursor:pointer}
.hc-community-window button:disabled{opacity:.45;cursor:default}
.hc-community-window button.primary{background:rgb(126,182,214);border-color:rgb(126,182,214);color:#081017;font-weight:700}
.hc-community-window input{min-width:0;padding:.45rem .6rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:inherit}
.hc-community-bar{display:flex;gap:.5rem}.hc-community-bar input{flex:1}
.hc-community-manage[aria-pressed=true]{border-color:rgb(126,182,214);color:rgb(126,182,214)}
.hc-community-label{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.hc-community-name{border:0!important;background:none!important;font-size:1.05rem;font-weight:600;padding:0!important}
.hc-community-tiles{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:.5rem;align-content:start}
.hc-community-tile{display:flex;flex-direction:column;align-items:flex-start;gap:.1rem;text-align:left}
.hc-community-tile-host{font-size:.72rem;color:#9babb6;overflow-wrap:anywhere}
.hc-community-tile.off{opacity:.35;filter:grayscale(1)}
.hc-community-empty{grid-column:1/-1;color:#9babb6;font-size:.85rem}
.hc-community-tools{display:flex;gap:.5rem;justify-content:flex-end}
`
    document.head.appendChild(style)
  }
}

const _communityView = new CommunityView()
export { _communityView as communityView }

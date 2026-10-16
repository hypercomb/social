// sharing/domain-links.drone.ts
//
// MOVEMENT AROUND THE DOMAINS. Watches a hosted website page as it mounts
// (presentation/tiles/site-view.drone.ts seats it in `#hc-site-view-host`)
// and applies the domain-link rule (domain-links.ts) to its copy: every name
// of a published creation becomes a link to that creation's address, coloured
// by its domain, with no underline. The table of names is computed when it is
// needed, never stored:
//
//   - here, in the authoring hive, from the `publish:results` pool — the
//     running list of publish and unpublish results, folded to the doors that
//     are open now (publish-results.ts); every result re-computes it, so a
//     page relinks the moment a new domain goes live;
//   - on a hosted page, where the visitor has no pool, from the publisher's
//     signed index served by the host (`doorsOfIndex`) — the same facts, the
//     public copy. The door record the worker writes into the page (#hc-door)
//     names the publisher; its index is read from the page's own zone.
//
// A link to one of OUR OWN creations, clicked in our own hive, moves inside
// the hive (no reload — views keep us inside, documentation/views). Any other
// link is an ordinary web link to another host: leaving is what it is for.

import { Drone, EffectBus, get, lineageKey, REMOTE_SUBMIT, type I18nProvider } from '@hypercomb/core'
import { hostsOfBranchKnown, hostZone } from './community-hosts.js'
import { compileDoors, DOMAIN_LINK_CLASS, LINK_CONTROL_CLASS, LINK_WORDS, linkControl, linkify, type LinkEntry, type LinkWord } from './domain-links.js'
import { fetchHiveManifestFromAny } from './hive-pointer.js'
import { hasIncidenceRecord, incidenceKey, mintIncidenceRecord, readIncidences, tableSignature, type LinkIncidence } from './link-incidences.js'
import { doorsOfIndex, PUBLISH_RESULT_EFFECT, publishedDoors, type PublishedDoor } from './publish-results.js'

const HOST_ID = 'hc-site-view-host'
const DOOR_ID = 'hc-door'
const PAGE_SIG_ATTR = 'data-hc-cell-page'
const SIG_RE = /^[0-9a-f]{64}$/
/** A visitor's failed index read is asked again, slower each time. */
const RETRY_FIRST_MS = 2_000
const RETRY_MAX_MS = 60_000

/** An address with its trailing slashes and case folded away. */
const foldAddress = (u: string): string => u.trim().toLowerCase().replace(/\/+$/, '')

/** What the last pass over a page read, waiting for the optimize phase. */
type PendingIncidences = {
  page: string
  table: string
  from?: { lineageKey: string; zone: string }
  names: LinkIncidence[]
}

type LineageLike = { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type PageFacts = { pageZone?: string; selfAddress?: string; from?: { lineageKey: string; zone: string } }

export class DomainLinksDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  public override description =
    'Links the copy of a hosted website page to the published creations it names: the publish results fold to the doors open now, each name in the page becomes a link to its address, coloured by its domain, no underline. Our own creations open inside the hive; others are web links to their host.'

  protected override listens: string[] = [PUBLISH_RESULT_EFFECT]
  protected override emits: string[] = []

  #entries: Promise<LinkEntry[]> | null = null
  #own = new Map<string, PublishedDoor>()
  /** The doors a visitor's page was read against (empty in the authoring hive). */
  #served: PublishedDoor[] = []
  #pending: PendingIncidences | null = null
  /** Every door in the table, by `<lineageKey>@<zone>` — what a link's attributes name. */
  #doors = new Map<string, PublishedDoor>()
  #control: HTMLElement | null = null
  #controlFor: HTMLAnchorElement | null = null
  #hideTimer = 0
  #over: ((e: Event) => void) | null = null
  #out: ((e: Event) => void) | null = null
  #bodyWatch: MutationObserver | null = null
  #hostWatch: MutationObserver | null = null
  #host: HTMLElement | null = null
  #frame = 0
  #click: ((e: Event) => void) | null = null
  /** What the links now in the host were made from: a pass against anything
   *  else takes them back to text first. */
  #linkedWith: { host: HTMLElement; entries: LinkEntry[]; page: string } | null = null
  #retryMs = RETRY_FIRST_MS
  #retryTimer = 0

  constructor() {
    super()
    this.onEffect(PUBLISH_RESULT_EFFECT, () => {
      this.#entries = null
      this.#schedule()
    })
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    this.#bodyWatch = new MutationObserver(() => this.#adopt())
    const start = (): void => {
      this.#bodyWatch?.observe(document.body, { childList: true })
      this.#adopt()
    }
    if (document.body) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  }

  /** Take up the page host when it appears; let it go when it leaves. */
  #adopt(): void {
    const host = document.getElementById(HOST_ID)
    if (host === this.#host) return
    this.#release()
    if (!host) return
    this.#host = host
    this.#hostWatch = new MutationObserver(() => this.#schedule())
    this.#hostWatch.observe(host, { childList: true, subtree: true, characterData: true })
    // On the document, capturing: the site view's own capture listener on the
    // host would otherwise open our creation as a web link before we see it.
    this.#click = (e: Event): void => this.#onClick(e)
    document.addEventListener('click', this.#click, true)
    // Resting on a coloured name shows its words (the link control); leaving
    // both the name and the control hides them after a beat.
    this.#over = (e: Event): void => {
      const a = (e.target as Element | null)?.closest?.('a.' + DOMAIN_LINK_CLASS) as HTMLAnchorElement | null
      if (a) this.#show(a)
    }
    this.#out = (e: Event): void => {
      const to = (e as MouseEvent).relatedTarget as Element | null
      if (to?.closest?.('a.' + DOMAIN_LINK_CLASS + ', .' + LINK_CONTROL_CLASS)) return
      this.#hideSoon()
    }
    host.addEventListener('mouseover', this.#over)
    host.addEventListener('focusin', this.#over)
    host.addEventListener('mouseout', this.#out)
    host.addEventListener('focusout', this.#out)
    this.#schedule()
  }

  #release(): void {
    this.#hostWatch?.disconnect()
    this.#hostWatch = null
    if (this.#click) document.removeEventListener('click', this.#click, true)
    if (this.#host) {
      if (this.#over) { this.#host.removeEventListener('mouseover', this.#over); this.#host.removeEventListener('focusin', this.#over) }
      if (this.#out) { this.#host.removeEventListener('mouseout', this.#out); this.#host.removeEventListener('focusout', this.#out) }
    }
    this.#click = null
    this.#over = null
    this.#out = null
    this.#host = null
    this.#linkedWith = null
    this.#hide()
    if (this.#frame) { cancelAnimationFrame(this.#frame); this.#frame = 0 }
  }

  /** Show the control for the door a link names, under the link. */
  #show(a: HTMLAnchorElement): void {
    if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = 0 }
    if (this.#controlFor === a) return
    // A word half typed into the control is not lost to a name passed over.
    if (this.#focusInControl()) return
    this.#hide()
    const door = this.#doors.get(`${a.getAttribute('data-lineage') ?? ''}@${a.getAttribute('data-domain') ?? ''}`)
    if (!door) return
    const control = linkControl(document, door, sentence => this.#say(sentence), this.#words())
    // Escape in the control puts the word away, not every open panel.
    control.setAttribute('data-escape-local', '')
    control.addEventListener('mouseenter', () => { if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = 0 } })
    control.addEventListener('mouseleave', () => this.#hideSoon())
    control.addEventListener('focusout', e => {
      const to = (e as FocusEvent).relatedTarget as Node | null
      if (to && (control.contains(to) || to === a)) return
      this.#hideSoon()
    })
    const r = a.getBoundingClientRect()
    control.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 260))}px`
    control.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 40)}px`
    // Right after its name, so the next Tab reaches its words. It is fixed,
    // so the page's layout does not move.
    this.#quiet(() => a.after(control))
    this.#control = control
    this.#controlFor = a
  }

  #focusInControl(): boolean {
    return !!this.#control && this.#control.contains(document.activeElement)
  }

  /** The control's words, with the one it asks for in the reader's language. */
  #words(): readonly LinkWord[] {
    const said = get<I18nProvider>('@hypercomb.social/I18n')?.t?.('domainLinks.asksWord')
    const asks = said && said !== 'domainLinks.asksWord' ? said : null
    return asks ? LINK_WORDS.map(w => (w.asks ? { ...w, asks } : w)) : LINK_WORDS
  }

  #hideSoon(): void {
    if (this.#hideTimer) clearTimeout(this.#hideTimer)
    this.#hideTimer = window.setTimeout(() => {
      this.#hideTimer = 0
      // Focus inside the control keeps it; it goes when focus leaves it.
      if (!this.#focusInControl()) this.#hide()
    }, 350)
  }

  #hide(): void {
    const control = this.#control
    if (control) this.#quiet(() => control.remove())
    this.#control = null
    this.#controlFor = null
  }

  /** Change the host without its observer chasing the change. */
  #quiet(change: () => void): void {
    const host = this.#host
    this.#hostWatch?.disconnect()
    try { change() }
    finally { if (host && host === this.#host) this.#hostWatch?.observe(host, { childList: true, subtree: true, characterData: true }) }
  }

  /** Say a sentence: the word's queen when it is awake here, else the command
   *  line, which wakes the word. The control is only ever the words. */
  #say(sentence: string): void {
    this.#hide()
    const word = sentence.split(/\s+/)[0] ?? ''
    const args = sentence.slice(word.length).trim()
    const key = `@diamondcoreprocessor.com/${word.charAt(0).toUpperCase()}${word.slice(1)}QueenBee`
    const queen = get<{ invoke?: (args: string) => Promise<void> }>(key)
    if (queen?.invoke) { void queen.invoke(args); return }
    // Transient: a stored line would replay, and run, whenever a command line
    // mounts later (core remote-submit.types.ts).
    if (EffectBus.listens(REMOTE_SUBMIT)) { EffectBus.emitTransient(REMOTE_SUBMIT, { text: sentence }); return }
    EffectBus.emit('activity:log', { message: `"${sentence}" was not said: no command line is open here` })
  }

  /** One pass per animation frame, however many mutations asked for it. */
  #schedule(): void {
    if (!this.#host || this.#frame) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0
      void this.#apply()
    })
  }

  async #apply(): Promise<void> {
    const host = this.#host
    if (!host) return
    const table = this.#table()
    const entries = await table
    // A pass that waited across a page swap or a publish result is stale:
    // the newer one has its own pass scheduled.
    const current = (): boolean => host === this.#host && table === this.#entries
    if (!current()) return
    const page: PageFacts = entries.length > 0 ? await this.#page() : {}
    if (!current()) return
    // Links made from another table, or for another page, go back to text
    // first: a withdrawn door is plain text again, a moved one takes its new
    // address, and a longer name now open wins over the shorter one linked.
    const made = `${page.selfAddress ?? ''}|${page.pageZone ?? ''}`
    const last = this.#linkedWith
    const stale = !!last && (last.host !== host || last.entries !== entries || last.page !== made)
    if (stale) this.#hide()
    // The pass itself mutates the host; the observer must not chase it.
    this.#quiet(() => {
      if (stale) unwrapLinks(host)
      if (entries.length > 0) linkify(host, entries, page)
    })
    this.#linkedWith = { host, entries, page: made }
    if (entries.length === 0) return

    // What this page names, read off the links just made against this table,
    // held for the optimize phase (link-incidences.ts). The site view stamps
    // the content sig on the host; a page without one has no key, so nothing
    // is held for it.
    const sig = host.getAttribute(PAGE_SIG_ATTR) || host.querySelector(`[${PAGE_SIG_ATTR}]`)?.getAttribute(PAGE_SIG_ATTR) || ''
    if (!SIG_RE.test(sig)) return
    const names = readIncidences(host)
    const tableSig = await tableSignature(entries)
    if (!current()) return
    this.#pending = { page: sig, table: tableSig, names, ...(page.from ? { from: page.from } : {}) }
  }

  /** THE OPTIMIZE PHASE: mint the incidence record for the last page read,
   *  keyed by page and table, on a miss only. Derived, never truth. */
  public override optimize = async (): Promise<void> => {
    const pending = this.#pending
    if (!pending) return
    this.#pending = null
    const key = await incidenceKey(pending.page, pending.table, pending.from)
    if (await hasIncidenceRecord(key)) return
    await mintIncidenceRecord({ key, page: pending.page, table: pending.table, names: pending.names, at: Date.now(), ...(pending.from ? { from: pending.from } : {}) })
  }

  /** The compiled table, computed once and dropped on every publish result. */
  #table(): Promise<LinkEntry[]> {
    if (!this.#entries) {
      this.#entries = (async (): Promise<LinkEntry[]> => {
        const own = await publishedDoors().catch(() => [] as PublishedDoor[])
        this.#own = new Map(own.map(d => [d.lineageKey, d]))
        const served = own.length === 0 ? await this.#servedDoors() : []
        // A read that failed is asked again later, slower each time; until
        // then the page simply has no links.
        if (served === null) this.#retry()
        else this.#retryMs = RETRY_FIRST_MS
        this.#served = served ?? []
        const all = [...own, ...this.#served]
        this.#doors = new Map(all.map(d => [`${d.lineageKey}@${d.zone}`, d]))
        return compileDoors(all)
      })()
    }
    return this.#entries
  }

  #retry(): void {
    if (this.#retryTimer) return
    const wait = this.#retryMs
    this.#retryMs = Math.min(this.#retryMs * 2, RETRY_MAX_MS)
    this.#retryTimer = window.setTimeout(() => {
      this.#retryTimer = 0
      this.#entries = null
      this.#schedule()
    }, wait)
  }

  /** A visitor's table: the publisher named by the page's door record. The
   *  page carries that publisher's signed index (#hc-index), verified with no
   *  round trip; failing that it is read from the zone the page is served on
   *  (or the zone above an own address). Empty when the page carries no
   *  door; null when the index could not be read, so it is asked again. */
  async #servedDoors(): Promise<PublishedDoor[] | null> {
    const carried = document.getElementById(DOOR_ID)?.textContent
    if (!carried) return []
    let pubkey = ''
    try { pubkey = String((JSON.parse(carried) as { pubkey?: unknown }).pubkey ?? '').toLowerCase() } catch { return [] }
    if (!SIG_RE.test(pubkey)) return []
    const here = hostZone(location.hostname)
    const above = here.split('.').slice(1).join('.')
    const zones = [here, above].filter(z => z && z.includes('.'))
    const manifest = await fetchHiveManifestFromAny(zones, pubkey).catch(() => null)
    // A root the index lists no doors for opens on the zone serving it: the
    // zone this page hangs off, or this host when it is that zone's apex.
    if (manifest) return doorsOfIndex(manifest, above.includes('.') ? above : here)
    // A host with no zone to ask (localhost in dev) can never answer; asking
    // again every minute would only fail again.
    return zones.length ? null : []
  }

  /** Which zone the page is on and which address is its own — so a link
   *  elsewhere is marked cross-domain and a page never links to itself. */
  async #page(): Promise<PageFacts> {
    if (this.#own.size > 0) {
      const segs = (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
      const key = lineageKey(segs)
      const self = this.#own.get(key)
      const hosts = segs.length ? await hostsOfBranchKnown(segs, true).catch(() => null) : null
      const pageZone = self?.zone ?? hosts?.[0] ?? ''
      return { pageZone, selfAddress: self?.address, ...(key && pageZone ? { from: { lineageKey: key, zone: pageZone } } : {}) }
    }
    // A visitor: the page is the creation whose address this is. A nested
    // creation lives at <top>.<zone>/<rest>, so the address is the whole
    // path, never the origin alone; a page deeper inside a creation belongs
    // to the longest address it sits under.
    const here = hostZone(location.hostname)
    const selfAddress = foldAddress(location.origin + location.pathname)
    let self: PublishedDoor | undefined
    for (const d of this.#served) {
      const at = foldAddress(d.address)
      if (at !== selfAddress && !selfAddress.startsWith(at + '/')) continue
      if (!self || at.length > foldAddress(self.address).length) self = d
    }
    // The zone: the page's own door's; else the served zone this host is (an
    // apex front door) or sits under; else the host less its first label.
    const zoneOfHost = this.#served.map(d => d.zone.toLowerCase())
      .filter(z => here === z || here.endsWith('.' + z))
      .sort((a, b) => b.length - a.length)[0]
    const pageZone = self?.zone ?? zoneOfHost ?? (here.split('.').slice(1).join('.') || here)
    // Self is the door's own address, not the path: linkify drops a name
    // only on an exact match, so a deeper page (or /index.html) would link
    // its own creation to itself.
    return { pageZone, selfAddress: self?.address ?? selfAddress, ...(self ? { from: { lineageKey: self.lineageKey, zone: self.zone } } : {}) }
  }

  /** Our own creation, in our own hive: move inside, no reload. A click with
   *  a modifier (a new tab, a new window) is left to the site view. */
  #onClick(e: Event): void {
    const m = e as MouseEvent
    if (m.button !== 0 || m.ctrlKey || m.metaKey || m.shiftKey || m.altKey) return
    const target = e.target as Element | null
    const a = target?.closest?.('a.' + DOMAIN_LINK_CLASS) as HTMLAnchorElement | null
    if (!a || !this.#host?.contains(a)) return
    const door = this.#own.get(a.getAttribute('data-lineage') ?? '')
    if (!door) return
    const navigation = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!navigation?.goRaw) return
    e.preventDefault()
    e.stopPropagation()
    // The site view reconciles on every navigation: the target's own page
    // mounts when it has one, else the hexagons return.
    navigation.goRaw(door.segments)
  }

  protected override dispose(): void {
    this.#release()
    if (this.#retryTimer) { clearTimeout(this.#retryTimer); this.#retryTimer = 0 }
    this.#bodyWatch?.disconnect()
    this.#bodyWatch = null
  }
}

/** Take the links the drone made back to their text, merged with the text
 *  around them, so the next pass reads the copy as it was authored. */
const unwrapLinks = (root: HTMLElement): void => {
  const parents = new Set<Node>()
  for (const a of Array.from(root.querySelectorAll('a.' + DOMAIN_LINK_CLASS))) {
    const parent = a.parentNode
    if (!parent) continue
    parent.replaceChild(a.ownerDocument.createTextNode(a.textContent ?? ''), a)
    parents.add(parent)
  }
  for (const p of parents) p.normalize()
}

const _domainLinks = new DomainLinksDrone()
window.ioc.register('@diamondcoreprocessor.com/DomainLinksDrone', _domainLinks)

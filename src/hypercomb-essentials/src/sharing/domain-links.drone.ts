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

import { Drone, EffectBus, get, lineageKey } from '@hypercomb/core'
import { hostsOfBranchKnown, hostZone } from './community-hosts.js'
import { compileDoors, DOMAIN_LINK_CLASS, LINK_CONTROL_CLASS, linkControl, linkify, type LinkEntry } from './domain-links.js'
import { fetchHiveIndex } from './hive-pointer.js'
import { hasIncidenceRecord, incidenceKey, mintIncidenceRecord, readIncidences, tableSignature, type LinkIncidence } from './link-incidences.js'
import { doorsOfIndex, PUBLISH_RESULT_EFFECT, publishedDoors, type PublishedDoor } from './publish-results.js'

const HOST_ID = 'hc-site-view-host'
const DOOR_ID = 'hc-door'
const PAGE_SIG_ATTR = 'data-hc-cell-page'
const SIG_RE = /^[0-9a-f]{64}$/

/** What the last pass over a page read, waiting for the optimize phase. */
type PendingIncidences = {
  page: string
  table: string
  from?: { lineageKey: string; zone: string }
  names: LinkIncidence[]
}

type LineageLike = { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

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
    this.#click = (e: Event): void => this.#onClick(e)
    host.addEventListener('click', this.#click)
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
    if (this.#host) {
      if (this.#click) this.#host.removeEventListener('click', this.#click)
      if (this.#over) { this.#host.removeEventListener('mouseover', this.#over); this.#host.removeEventListener('focusin', this.#over) }
      if (this.#out) { this.#host.removeEventListener('mouseout', this.#out); this.#host.removeEventListener('focusout', this.#out) }
    }
    this.#click = null
    this.#over = null
    this.#out = null
    this.#host = null
    this.#hide()
    if (this.#frame) { cancelAnimationFrame(this.#frame); this.#frame = 0 }
  }

  /** Show the control for the door a link names, under the link. */
  #show(a: HTMLAnchorElement): void {
    if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = 0 }
    if (this.#controlFor === a) return
    this.#hide()
    const door = this.#doors.get(`${a.getAttribute('data-lineage') ?? ''}@${a.getAttribute('data-domain') ?? ''}`)
    if (!door) return
    const control = linkControl(document, door, sentence => this.#say(sentence))
    control.addEventListener('mouseenter', () => { if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = 0 } })
    control.addEventListener('mouseleave', () => this.#hideSoon())
    const r = a.getBoundingClientRect()
    control.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 260))}px`
    control.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 40)}px`
    document.body.appendChild(control)
    this.#control = control
    this.#controlFor = a
  }

  #hideSoon(): void {
    if (this.#hideTimer) clearTimeout(this.#hideTimer)
    this.#hideTimer = window.setTimeout(() => { this.#hideTimer = 0; this.#hide() }, 350)
  }

  #hide(): void {
    this.#control?.remove()
    this.#control = null
    this.#controlFor = null
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
    EffectBus.emit('command-line:remote-submit', { text: sentence })
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
    const entries = await this.#table()
    if (host !== this.#host || entries.length === 0) return
    const page = await this.#page()
    // The pass itself mutates the host; the observer must not chase its own
    // links. The anchors it made are skipped on the next pass anyway, so
    // pausing is only to save the frame.
    this.#hostWatch?.disconnect()
    try { linkify(host, entries, page) }
    finally { this.#hostWatch?.observe(host, { childList: true, subtree: true, characterData: true }) }

    // What this page names, read off the links just made, held for the
    // optimize phase (link-incidences.ts). A page whose content sig the site
    // view did not stamp has no key, so nothing is held for it.
    const sig = host.querySelector(`[${PAGE_SIG_ATTR}]`)?.getAttribute(PAGE_SIG_ATTR) ?? ''
    if (!SIG_RE.test(sig)) return
    this.#pending = { page: sig, table: await tableSignature(entries), names: readIncidences(host), ...(page.from ? { from: page.from } : {}) }
  }

  /** THE OPTIMIZE PHASE: mint the incidence record for the last page read,
   *  keyed by page and table, on a miss only. Derived, never truth. */
  public override optimize = async (): Promise<void> => {
    const pending = this.#pending
    if (!pending) return
    this.#pending = null
    const key = await incidenceKey(pending.page, pending.table)
    if (await hasIncidenceRecord(key)) return
    await mintIncidenceRecord({ key, page: pending.page, table: pending.table, names: pending.names, at: Date.now(), ...(pending.from ? { from: pending.from } : {}) })
  }

  /** The compiled table, computed once and dropped on every publish result. */
  #table(): Promise<LinkEntry[]> {
    if (!this.#entries) {
      this.#entries = (async (): Promise<LinkEntry[]> => {
        const own = await publishedDoors().catch(() => [] as PublishedDoor[])
        this.#own = new Map(own.map(d => [d.lineageKey, d]))
        this.#served = own.length === 0 ? await this.#servedDoors() : []
        const all = [...own, ...this.#served]
        this.#doors = new Map(all.map(d => [`${d.lineageKey}@${d.zone}`, d]))
        return compileDoors(all)
      })()
    }
    return this.#entries
  }

  /** A visitor's table: the publisher named by the page's door record, read
   *  from the zone the page is served on (or the zone above an own address).
   *  Empty when the page carries no door or the index cannot be read. */
  async #servedDoors(): Promise<PublishedDoor[]> {
    const carried = document.getElementById(DOOR_ID)?.textContent
    if (!carried) return []
    let pubkey = ''
    try { pubkey = String((JSON.parse(carried) as { pubkey?: unknown }).pubkey ?? '').toLowerCase() } catch { return [] }
    if (!SIG_RE.test(pubkey)) return []
    const here = hostZone(location.hostname)
    const above = here.split('.').slice(1).join('.')
    for (const zone of [here, above].filter(z => z && z.includes('.'))) {
      const read = await fetchHiveIndex(zone, pubkey).catch(() => ({ ok: false as const }))
      if (read.ok) return doorsOfIndex(read.manifest)
    }
    return []
  }

  /** Which zone the page is on and which address is its own — so a link
   *  elsewhere is marked cross-domain and a page never links to itself. */
  async #page(): Promise<{ pageZone?: string; selfAddress?: string; from?: { lineageKey: string; zone: string } }> {
    if (this.#own.size > 0) {
      const segs = (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
      const key = lineageKey(segs)
      const self = this.#own.get(key)
      const hosts = segs.length ? await hostsOfBranchKnown(segs, true).catch(() => null) : null
      const pageZone = self?.zone ?? hosts?.[0] ?? ''
      return { pageZone, selfAddress: self?.address, ...(key && pageZone ? { from: { lineageKey: key, zone: pageZone } } : {}) }
    }
    // A visitor: the page is the creation whose address this is.
    const here = hostZone(location.hostname)
    const pageZone = here.split('.').slice(1).join('.') || here
    const self = this.#served.find(d => {
      try { return new URL(d.address).hostname.toLowerCase() === here } catch { return false }
    })
    return { pageZone, selfAddress: location.origin, ...(self ? { from: { lineageKey: self.lineageKey, zone: self.zone } } : {}) }
  }

  /** Our own creation, in our own hive: move inside, no reload. */
  #onClick(e: Event): void {
    const target = e.target as Element | null
    const a = target?.closest?.('a.' + DOMAIN_LINK_CLASS) as HTMLAnchorElement | null
    if (!a) return
    const door = this.#own.get(a.getAttribute('data-lineage') ?? '')
    if (!door) return
    const navigation = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!navigation?.goRaw) return
    e.preventDefault()
    // The site view reconciles on every navigation: the target's own page
    // mounts when it has one, else the hexagons return.
    navigation.goRaw(door.segments)
  }

  protected override dispose(): void {
    this.#release()
    this.#bodyWatch?.disconnect()
    this.#bodyWatch = null
  }
}

const _domainLinks = new DomainLinksDrone()
window.ioc.register('@diamondcoreprocessor.com/DomainLinksDrone', _domainLinks)

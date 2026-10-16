// sharing/link-incidences.ts
//
// WHO NAMES WHOM, ACROSS DOMAINS. When the domain-link rule (domain-links.ts)
// runs over a hosted page, every link it makes is an INCIDENCE: this page
// names that creation. Collected, the incidences are a graph across hosts —
// which domains point into a creation, which it points out to — and the
// clusters a reader can move through (jwize, 2026-10-15: "we can even show
// clusters cross domain in this way").
//
// A DERIVED CACHE, by the optimize-phase litmus (documentation/optimize-phase.md):
// a cold client rebuilds every record by mounting the page again and running
// the same rule. So the records live in the `links:incidences` pool, are
// keyed by the signature of their INPUTS — the page's content sig, the
// door table the rule ran with (a new domain → new table → new key → derive
// on miss) and the creation the reader stood in (its own door is left out of
// the links, so one page atom shared by two creations names different
// things) — and are minted only from the optimize phase, complete or absent,
// never load-bearing: the publications view shows them when they are there
// and is whole without them.

import { get, registerPoolMeaning, SignatureService } from '@hypercomb/core'
import { DOMAIN_LINK_CLASS, type LinkEntry } from './domain-links.js'

export const LINK_INCIDENCES_POOL = 'links:incidences'
const STORE_KEY = '@hypercomb.social/Store'
const SIG_RE = /^[0-9a-f]{64}$/

/** One creation a page names, and how often. */
export interface LinkIncidence {
  readonly lineageKey: string
  readonly zone: string
  readonly address: string
  readonly count: number
}

export interface LinkIncidenceRecord {
  v: 1
  /** sign(page sig + table sig [+ source creation]) — the member's key. */
  key: string
  /** The page content the rule ran over. */
  page: string
  /** The door table it ran with (`tableSignature`). */
  table: string
  /** The creation the page belongs to, when the reader stands in it. */
  from?: { lineageKey: string; zone: string }
  names: LinkIncidence[]
  at: number
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (
    pool: FileSystemDirectoryHandle,
    bytes: ArrayBuffer,
    subKey?: string,
    options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
}

const sign = (text: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)

/** The door table's own signature: its doors, sorted, nothing else — every
 *  door sharing a name too, since which one a page links depends on them. */
export const tableSignature = (entries: readonly LinkEntry[]): Promise<string> =>
  sign(JSON.stringify(entries
    .flatMap(e => e.doors ?? [e.door])
    .map(d => [d.lineageKey, d.zone, d.address])
    .sort((a, b) => a.join('|').localeCompare(b.join('|')))))

/** The record key: page content, table and the creation read from are the
 *  input. Without a source the key is the page and table alone, as before. */
export const incidenceKey = (
  pageSig: string,
  tableSig: string,
  from?: { lineageKey: string; zone: string },
): Promise<string> =>
  sign(from ? `${pageSig}:${tableSig}:${from.lineageKey}@${from.zone.toLowerCase()}` : `${pageSig}:${tableSig}`)

/** Read the incidences off a page the rule has run over: the links it made,
 *  grouped by the creation they lead to. */
export const readIncidences = (root: ParentNode): LinkIncidence[] => {
  const seen = new Map<string, LinkIncidence>()
  for (const a of Array.from(root.querySelectorAll('a.' + DOMAIN_LINK_CLASS))) {
    const lineageKey = a.getAttribute('data-lineage') ?? ''
    const zone = a.getAttribute('data-domain') ?? ''
    if (!lineageKey || !zone) continue
    const id = `${lineageKey}@${zone}`
    const prior = seen.get(id)
    seen.set(id, prior
      ? { ...prior, count: prior.count + 1 }
      : { lineageKey, zone, address: (a as HTMLAnchorElement).href, count: 1 })
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.lineageKey.localeCompare(b.lineageKey))
}

const validate = (raw: unknown): LinkIncidenceRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const key = String(o['key'] ?? '').toLowerCase()
  const page = String(o['page'] ?? '').toLowerCase()
  const table = String(o['table'] ?? '').toLowerCase()
  if (!SIG_RE.test(key) || !SIG_RE.test(page) || !SIG_RE.test(table)) return null
  const names = Array.isArray(o['names'])
    ? (o['names'] as unknown[]).flatMap((n): LinkIncidence[] => {
        const i = n as Record<string, unknown>
        const lineageKey = String(i?.['lineageKey'] ?? '')
        const zone = String(i?.['zone'] ?? '').toLowerCase()
        return lineageKey && zone
          ? [{ lineageKey, zone, address: String(i['address'] ?? ''), count: Math.max(1, Number(i['count']) || 1) }]
          : []
      })
    : []
  const f = o['from'] as Record<string, unknown> | undefined
  const from = f && typeof f === 'object' && String(f['lineageKey'] ?? '')
    ? { lineageKey: String(f['lineageKey']), zone: String(f['zone'] ?? '').toLowerCase() }
    : undefined
  return { v: 1, key, page, table, ...(from ? { from } : {}), names, at: Number(o['at'] ?? 0) || 0 }
}

const parse = (bytes: ArrayBuffer | null): LinkIncidenceRecord | null => {
  if (!bytes) return null
  try { return validate(JSON.parse(new TextDecoder().decode(bytes))) } catch { return null }
}

/** Is the record for this key already here? A reader's question — never creates. */
export async function hasIncidenceRecord(key: string): Promise<boolean> {
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.openPool || !store.getPoolDoc) return false
  const pool = await store.openPool(LINK_INCIDENCES_POOL)
  if (!pool) return false
  return parse(await store.getPoolDoc(pool, key)) !== null
}

/** Mint one record — only the optimize phase calls this. Complete-or-absent:
 *  one document, one write. A `keep: 'current'` write, since the software
 *  derives it on its own. */
export async function mintIncidenceRecord(record: Omit<LinkIncidenceRecord, 'v'>): Promise<boolean> {
  const valid = validate({ ...record, v: 1 })
  if (!valid) return false
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.getPool || !store.putPoolDoc) return false
  const pool = await store.getPool(LINK_INCIDENCES_POOL)
  if (!pool) return false
  const bytes = new TextEncoder().encode(JSON.stringify(valid))
  return !!(await store.putPoolDoc(pool, bytes.buffer as ArrayBuffer, valid.key, { keep: 'current' }))
}

/** Records already read, by sub-bucket name. A record is minted once on a
 *  miss and never rewritten, so a bucket read once need not be read again —
 *  the listing alone says which are new, and which are gone (a wiped pool). */
const readBuckets = new Map<string, LinkIncidenceRecord>()
/** New buckets read per listing, at most. The pool only grows, so a cold
 *  read of a large one is spread over several views instead of one stall.
 *  Until every bucket has been read the listing answers nothing: a partial
 *  set could fold a source to an older record whose newer one is unread. */
const MAX_NEW_READS = 256

/** Every record here. The pool's sub-buckets are its records; each carries
 *  its own key, so nothing need be inverted from a folder name. */
export async function listIncidenceRecords(): Promise<LinkIncidenceRecord[]> {
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.openPool || !store.getPoolDoc) return []
  const pool = await store.openPool(LINK_INCIDENCES_POOL)
  if (!pool) return []
  const out: LinkIncidenceRecord[] = []
  const listed = new Set<string>()
  let reads = 0
  let partial = false
  try {
    const dirs = (pool as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()
    for await (const handle of dirs) {
      if (handle.kind !== 'directory') continue
      listed.add(handle.name)
      let record = readBuckets.get(handle.name) ?? null
      if (!record) {
        if (reads >= MAX_NEW_READS) { partial = true; continue }
        reads++
        // A bucket with no record yet (mid-mint) is not remembered, so it is read again next time.
        record = parse(await store.getPoolDoc(handle as FileSystemDirectoryHandle))
        if (record) readBuckets.set(handle.name, record)
      }
      if (record) out.push(record)
    }
  } catch { /* an unreadable pool is an empty one */ }
  for (const name of [...readBuckets.keys()]) if (!listed.has(name)) readBuckets.delete(name)
  return partial ? [] : out
}

/** One end of a cluster edge: a creation (by key) on a zone. */
export interface ClusterEnd {
  readonly lineageKey: string
  readonly zone: string
  readonly address?: string
  readonly count: number
}

export interface Cluster {
  /** Who names this creation: pages elsewhere whose copy says its name. */
  readonly inbound: ClusterEnd[]
  /** Whom this creation's page names. */
  readonly outbound: ClusterEnd[]
}

/** A creation's identity in a cluster: its key ON a zone. A path is a route,
 *  never an identity — two publishers' `business-card` are two creations. */
export const clusterId = (lineageKey: string, zone: string): string => `${lineageKey}@${zone.toLowerCase()}`

/** Fold the records to clusters, keyed by `clusterId`. Only a page with a
 *  known `from` makes edges — an edge has two ends. Each source creation
 *  answers with the newest record it was read with, so an edited page
 *  replaces its older versions. Given the current door table, only records
 *  made with it count: a record from another table answers inputs that no
 *  longer hold (a door since withdrawn), and a cold read would not give it. */
export const clustersOf = (records: readonly LinkIncidenceRecord[], table?: string): Map<string, Cluster> => {
  const newestPerSource = new Map<string, LinkIncidenceRecord>()
  for (const r of records) {
    if (!r.from) continue   // a page nobody owns names, but is no one's edge
    if (table && r.table !== table) continue
    const id = clusterId(r.from.lineageKey, r.from.zone)
    const prior = newestPerSource.get(id)
    if (!prior || r.at > prior.at) newestPerSource.set(id, r)
  }
  const clusters = new Map<string, { inbound: Map<string, ClusterEnd>; outbound: Map<string, ClusterEnd> }>()
  const at = (key: string) => {
    let c = clusters.get(key)
    if (!c) { c = { inbound: new Map(), outbound: new Map() }; clusters.set(key, c) }
    return c
  }
  const add = (bag: Map<string, ClusterEnd>, end: ClusterEnd): void => {
    const id = `${end.lineageKey}@${end.zone}`
    const prior = bag.get(id)
    bag.set(id, prior ? { ...prior, count: prior.count + end.count } : end)
  }
  for (const r of newestPerSource.values()) {
    const from = r.from!
    const self = clusterId(from.lineageKey, from.zone)
    for (const n of r.names) {
      const named = clusterId(n.lineageKey, n.zone)
      if (named === self) continue   // a page naming itself is no edge
      add(at(named).inbound, { lineageKey: from.lineageKey, zone: from.zone, count: n.count })
      add(at(self).outbound, { lineageKey: n.lineageKey, zone: n.zone, address: n.address, count: n.count })
    }
  }
  const out = new Map<string, Cluster>()
  for (const [key, c] of clusters) {
    out.set(key, {
      inbound: [...c.inbound.values()].sort((a, b) => b.count - a.count),
      outbound: [...c.outbound.values()].sort((a, b) => b.count - a.count),
    })
  }
  return out
}

/** One creation's cluster across every zone it answers on: the ends of each,
 *  folded together. Undefined when no zone has one. */
export const clusterAt = (
  clusters: ReadonlyMap<string, Cluster>,
  lineageKey: string,
  zones: readonly string[],
): Cluster | undefined => {
  const found = [...new Set(zones.map(z => z.toLowerCase()))]
    .map(z => clusters.get(clusterId(lineageKey, z)))
    .filter((c): c is Cluster => !!c)
  if (found.length <= 1) return found[0]
  const fold = (ends: ClusterEnd[]): ClusterEnd[] => {
    const bag = new Map<string, ClusterEnd>()
    for (const end of ends) {
      const id = clusterId(end.lineageKey, end.zone)
      const prior = bag.get(id)
      bag.set(id, prior ? { ...prior, count: prior.count + end.count } : end)
    }
    return [...bag.values()].sort((a, b) => b.count - a.count)
  }
  return {
    inbound: fold(found.flatMap(c => c.inbound)),
    outbound: fold(found.flatMap(c => c.outbound)),
  }
}

// assistant/hive-showcase-read.ts
//
// A ZONE'S COMMUNITY, READ WHERE ITS OWNERS SIGN IT (jwize 2026-11-13: "If it
// can't understand how hypercomb works or it can't get the relevant data like
// explore across domains including shared community creations then we are not
// done").
//
// `pool showcase:<zone>` asked every host for a pool at sign('showcase:<zone>')
// and every host said none — rightly: a zone's showcase is not a pool. It is a
// record one of the zone's owners signs under the INDEX KEY `showcase:<zone>`
// (sharing/showcase-record.ts), in their own signed index on the zone. The
// front door reads it that way (hypercomb-shim showcase-record.ts
// readZoneOwners); this is the same read, for a model:
//
//   1. the zone's ledger (`host:publications`) names the zone's owners: the
//      publishers of the site that answers at the zone, the primary first;
//   2. each owner's signed index is read on the zone's own sites first, the
//      apex last (a home relay at an apex keeps a stray copy that names no
//      showcase); the first owner who names a showcase decides it;
//   3. the record is fetched by its signature and kept only if it hashes to it;
//   4. each creation it turns on is resolved to the head its owner's index
//      names, so a later `read <head>` opens it.
//
// THE SAME FENCE AS EVERY POOL READ. Only a zone this hive already asks (one of
// its network hosts is the zone or a site under it) is read, and only the zone
// and its own sites are asked: a meaning a model typed never aims a read at a
// stranger. Nothing is written; what goes out is signatures and keys.

import { SignatureService } from '@hypercomb/core'
import { fetchWithDeadline } from '../sharing/bounded-fetch.js'
import { lensOrigin } from '../sharing/community-lens.js'
import { fetchHiveIndex } from '../sharing/hive-pointer.js'
import { noteFoundAt } from './found-hosts.js'

/** The meanings read this way: a zone's showcase, by its index key. */
export const SHOWCASE_MEANING = /^showcase:([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+|localhost(?::\d+)?)$/

const SIG = /^[a-f0-9]{64}$/
/** Owners asked, the primary first. */
const OWNERS_MAX = 8
/** Sites under the zone asked before its apex. */
const SITES_MAX = 3
/** Keys whose index is read to resolve the creations shown. */
const ITEM_KEYS_MAX = 16
const RECORD_MAX_BYTES = 262_144
const HOST_TIMEOUT_MS = 6_000
/** Said with the record, so the model reads it right without a lesson of its own. */
export const SHOWN_NOTE = 'the community this zone shows: items are the creations its owners turned on for the public (lineage, publisher key, and head: read <head> opens its root tile; head null = turned on but not published now); domains are domains shown in full; communities are named groups of those items'

export interface ShowcaseReadDeps {
  /** sign(meaning). */
  address(meaning: string): Promise<string>
  /** A one-file index's text at a host's root (the ledger), or null. */
  document(origin: string, address: string, signal?: AbortSignal): Promise<string | null>
  /** One key's verified roots on one host, or null for none / not verified. */
  roots(host: string, pubkey: string, signal?: AbortSignal): Promise<Record<string, string> | null>
  /** Bytes at `/<sig>` (or the legacy `/content/<sig>`) that hash to the sig, or null. */
  atom(origin: string, sig: string, signal?: AbortSignal): Promise<Uint8Array | null>
  /** Tell the content broker where a head lives, so a later read finds it. */
  note?(sig: string, hosts: readonly string[]): void
}

const sha256 = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

export const liveShowcaseReadDeps = (document: ShowcaseReadDeps['document']): ShowcaseReadDeps => ({
  address: meaning => SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer),
  document,
  roots: async (host, pubkey, signal) => {
    const read = await fetchHiveIndex(host, pubkey, signal).catch(() => null)
    return read?.ok ? read.manifest.roots : null
  },
  atom: async (origin, sig, signal) => {
    for (const path of [`/${sig}`, `/content/${sig}`]) {
      try {
        const response = await fetchWithDeadline(`${origin}${path}`, { cache: 'no-store' }, { timeoutMs: HOST_TIMEOUT_MS, ...(signal ? { signal } : {}) })
        if (!response.ok) continue
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength && bytes.byteLength <= RECORD_MAX_BYTES && await sha256(bytes) === sig) return bytes
      } catch { /* the next spelling, then nothing */ }
    }
    return null
  },
  // Through the page's one attribution map, which tells the broker too.
  note: (sig, hosts) => noteFoundAt(sig, hosts),
})

/** What the read found: the record's text with each item's head beside it, the host it was read on, and the heads. */
export interface ShowcaseFound {
  readonly host: string
  readonly text: string
  readonly heads: readonly { readonly sig: string; readonly hosts: readonly string[] }[]
}

const under = (host: string, zone: string): boolean => host === zone || host.endsWith(`.${zone}`)

/** The zone's owners as its ledger names them (the site answering at the zone), primary first; the sites under it. */
const ledgerOf = (text: string, zone: string): { owners: string[]; sites: string[] } => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { owners: [], sites: [] } }
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { sites?: unknown })?.sites) ? (raw as { sites: unknown[] }).sites : []
  const owners: string[] = []
  const sites: string[] = []
  for (const row of rows.slice(0, 500)) {
    if (!row || typeof row !== 'object') continue
    const site = row as Record<string, unknown>
    const bindings = Array.isArray(site['hosts']) ? (site['hosts'] as unknown[]).slice(0, 24) : []
    const hosts = [site['host'], ...bindings.map(binding => (binding as { host?: unknown } | null)?.host)]
      .map(host => typeof host === 'string' ? host.trim().toLowerCase() : '').filter(Boolean)
    for (const host of hosts) if (host !== zone && under(host, zone) && !sites.includes(host)) sites.push(host)
    if (!hosts.includes(zone)) continue
    const publishers = (Array.isArray(site['publishers']) ? site['publishers'] as unknown[] : []).slice(0, 16)
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && SIG.test(String((p as Record<string, unknown>)['pubkey'] ?? '')))
      .sort((a, b) => Number(b['primary'] === true) - Number(a['primary'] === true))
    for (const publisher of publishers) {
      const key = String(publisher['pubkey']).toLowerCase()
      if (!owners.includes(key)) owners.push(key)
    }
  }
  return { owners: owners.slice(0, OWNERS_MAX), sites }
}

/**
 * The showcase a zone's owners signed, or null when the meaning is not a showcase, the zone is not one this hive
 * asks, or nothing signed and verified was found. Never throws for a host.
 */
export const readZoneShowcase = async (
  meaning: string,
  networkHosts: readonly string[],
  deps: ShowcaseReadDeps,
  signal?: AbortSignal,
): Promise<ShowcaseFound | null> => {
  const zone = SHOWCASE_MEANING.exec(meaning)?.[1]
  if (!zone) return null
  const known = networkHosts.map(host => String(host ?? '').trim().toLowerCase()).filter(host => under(host, zone))
  if (!known.length) return null

  // 1. The ledger, from the zone and the sites under it this hive already asks.
  const ledgerAt = await deps.address('host:publications')
  const ledgerHosts = [...known.filter(host => host !== zone), zone]
  let owners: string[] = []
  const sites: string[] = known.filter(host => host !== zone)
  for (const host of ledgerHosts) {
    if (signal?.aborted) return null
    const text = await deps.document(lensOrigin(host), ledgerAt, signal).catch(() => null)
    if (!text) continue
    const ledger = ledgerOf(text, zone)
    for (const site of ledger.sites) if (!sites.includes(site)) sites.push(site)
    if (ledger.owners.length) { owners = ledger.owners; break }
  }
  if (!owners.length) return null

  // 2. Each owner's index: the zone's own sites first, the apex last.
  const order = [...sites.slice(0, SITES_MAX), zone]
  const rootsOf = async (pubkey: string, first?: string): Promise<{ host: string; roots: Record<string, string> } | null> => {
    for (const host of first ? [first, ...order.filter(h => h !== first)] : order) {
      if (signal?.aborted) return null
      const roots = await deps.roots(host, pubkey, signal).catch(() => null)
      if (roots) return { host, roots }
    }
    return null
  }
  const key = `showcase:${zone}`
  for (const owner of owners) {
    const index = await rootsOf(owner)
    const sig = String(index?.roots[key] ?? '').toLowerCase()
    if (!index || !SIG.test(sig)) continue
    // 3. The record, by its signature. The first owner who names one decides it.
    const bytes = await deps.atom(lensOrigin(index.host), sig, signal).catch(() => null)
    if (!bytes) return null
    let record: Record<string, unknown>
    try { record = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return null }
    if (!record || typeof record !== 'object' || record['kind'] !== 'host:showcase' || record['zone'] !== zone) return null

    // 4. Each creation turned on, to the head its owner's index names now.
    const items = (Array.isArray(record['items']) ? record['items'] as unknown[] : [])
      .filter((item): item is { pubkey: string; lineage: string } =>
        !!item && typeof item === 'object' && SIG.test(String((item as { pubkey?: unknown }).pubkey ?? '')) && typeof (item as { lineage?: unknown }).lineage === 'string')
    const indexes = new Map<string, { host: string; roots: Record<string, string> } | null>([[owner, index]])
    for (const item of items) {
      if (indexes.has(item.pubkey) || indexes.size >= ITEM_KEYS_MAX) continue
      indexes.set(item.pubkey, await rootsOf(item.pubkey, index.host))
    }
    const heads = new Map<string, string[]>()
    const shown = items.map(item => {
      const at = indexes.get(item.pubkey)
      const head = String(at?.roots[item.lineage] ?? '').toLowerCase()
      if (!at || !SIG.test(head)) return { ...item, head: null }
      heads.set(head, [...new Set([...(heads.get(head) ?? []), at.host])])
      return { ...item, head }
    })
    for (const [head, hosts] of heads) deps.note?.(head, hosts)
    const text = JSON.stringify({ note: SHOWN_NOTE, ...record, items: shown, record: sig, signedBy: owner, readAt: index.host })
    return { host: index.host, text, heads: [...heads].map(([sig, hosts]) => ({ sig, hosts })) }
  }
  return null
}

// sharing/publish-results.ts
//
// THE RUNNING LIST OF PUBLISH AND UNPUBLISH RESULTS — owner of the
// `publish:results` pool of meaning (jwize, 2026-10-15: "some pool that
// keeps a running list of publish/unpublish results, that way we can get the
// list and compute the links in real time").
//
// `publish:heads` (publish-heads.ts) remembers the heads this participant
// advanced, one member per sealed head, and nothing of a withdrawal. This
// pool is the other half: EVERY outcome, in order, publish and unpublish
// alike, folded to one document. Reducing the list yields the DOORS — every
// creation of ours that is open right now, and the address it opens at —
// which is all the domain-link rule (domain-links.ts) needs to turn a name in
// a hosted page's copy into movement to that creation.
//
// TRUTH POOL, never minted from the optimize phase: "I published this here"
// and "I took it down" are remote acts no cold client could rebuild from
// layers (optimize-phase.md litmus). Written only from the one publish
// routine (publish-branch.ts), as a `keep: 'current'` document — the software
// writes it on its own, so it mints no kept version (a participant's save
// does). The list is bounded; the oldest results fall off the far end.
//
// A reader without the pool — a visitor on a hosted page, a hive looking at a
// host it follows — derives the same doors from the publisher's signed index
// instead (`doorsOfIndex`): roots, doors and addresses are the same facts,
// signed. The pool is the fast local source; the index is the public one.

import { EffectBus, get, lineageKey, registerPoolMeaning } from '@hypercomb/core'
import type { HiveManifest } from './hive-pointer.js'
import { implicitUrl, originOf, ownAddressHost, ownLabelOn, subdomainUrl } from './zone-door.js'

export const PUBLISH_RESULTS_POOL = 'publish:results'
/** Emitted with the record after every result lands in the pool. */
export const PUBLISH_RESULT_EFFECT = 'publish:result'
const MAX_RESULTS = 512
const STORE_KEY = '@hypercomb.social/Store'

export interface PublishResultRecord {
  v: 1
  op: 'publish' | 'unpublish'
  /** Epoch MS of the act. */
  at: number
  /** The branch path, verbatim — the last segment is the creation's NAME. */
  segments: string[]
  lineageKey: string
  /** Bare domain the index was written through. */
  host: string
  /** Where the creation opens (publish only): its own address on the primary
   *  domain, else the address the rule gives it there. */
  address?: string
  /** The primary domain the address is on — not always the host the index
   *  was written through (the primary may not answer yet). Absent on results
   *  from before it was recorded. */
  zone?: string
  /** True when `address` is an own address the publisher signed, so no rule
   *  derives it. Absent on results from before it was recorded. */
  own?: boolean
  sealed?: string
  status?: 'confirmed' | 'unconfirmed'
}

/** One open creation: the name a page's copy can say, and where it leads. */
export interface PublishedDoor {
  readonly name: string
  readonly segments: readonly string[]
  readonly lineageKey: string
  /** The domain the address is on. */
  readonly zone: string
  readonly address: string
  readonly at: number
}

type StoreLike = {
  opfsRoot?: FileSystemDirectoryHandle
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (
    pool: FileSystemDirectoryHandle,
    bytes: ArrayBuffer,
    subKey?: string,
    options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
}

const urlOf = (address: string): URL | null => {
  try { return new URL(address) } catch { return null }
}

/** The zone a result's door is on: the primary it recorded. An older result
 *  recorded only the host the index was written through, which is the zone
 *  unless the address says otherwise — a root path names its zone, a
 *  subdomain the zone below its first label. */
const zoneOf = (record: Pick<PublishResultRecord, 'host' | 'address' | 'zone'>): string => {
  const recorded = String(record.zone ?? '').trim().toLowerCase()
  if (recorded) return recorded
  const host = String(record.host ?? '').trim().toLowerCase()
  const url = urlOf(String(record.address ?? ''))
  const at = url?.hostname.toLowerCase() ?? ''
  if (!at || at === host || at.endsWith(`.${host}`)) return host || at
  if (url && url.pathname !== '/' && url.pathname !== '') return at
  const below = at.split('.').slice(1).join('.')
  return below.includes('.') ? below : at
}

/** A result's own address: the one the publisher signed, which no rule
 *  derives. An older result did not say, so it is read off the address — the
 *  bare zone is the apex own address, a root path or the derived subdomain is
 *  not one, and any other host on the zone is. */
const ownOf = (record: PublishResultRecord, zone: string): string => {
  const address = String(record.address ?? '').trim()
  if (!address) return ''
  if (record.own !== undefined) return record.own ? address : ''
  const url = urlOf(address)
  if (!url) return ''
  const at = url.hostname.toLowerCase()
  if (at === zone) return url.pathname === '/' || url.pathname === '' ? url.origin : ''
  if (address.replace(/\/+$/, '') === subdomainUrl(zone, record.segments)) return ''
  return address
}

/** WHERE A DOOR LEADS — only somewhere the host will open (the worker's
 *  resolveSite and publishedRoot), never a page that answers "nothing
 *  published here" (jwize, 2026-10-15: "the text in the copy needs to be auto
 *  href to the subdomains that match the text"):
 *
 *    - an own address the publisher signed, on its label or the apex;
 *    - `<key>.<zone>`, the host's implicit door, for a top-level creation
 *      whose key is already a DNS label;
 *    - `<top>.<zone>/<rest>` for a nested one, when its top place is itself
 *      open on that zone — the host serves the top place and the rest is a
 *      walk inside it. The wildcard maps one label, never a path.
 *
 *  Anything else has no address a reader could open: '' — no door, and the
 *  name stays text. Root paths are off on the hosts. */
export const doorAddress = (
  zone: string,
  segments: readonly string[],
  key: string,
  own = '',
  topOpen: (topKey: string) => boolean = () => false,
): string => String(own ?? '').trim() || implicitUrl(String(zone ?? '').trim().toLowerCase(), segments, key, topOpen)

const validate = (raw: unknown): PublishResultRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const op = o['op'] === 'unpublish' ? 'unpublish' : o['op'] === 'publish' ? 'publish' : null
  const segments = Array.isArray(o['segments'])
    ? (o['segments'] as unknown[]).map(s => String(s ?? '').trim()).filter(Boolean)
    : []
  if (!op || segments.length === 0) return null
  const key = String(o['lineageKey'] ?? '').trim() || lineageKey(segments)
  const address = String(o['address'] ?? '').trim()
  const zone = String(o['zone'] ?? '').trim().toLowerCase()
  const own = typeof o['own'] === 'boolean' ? o['own'] : undefined
  const sealed = String(o['sealed'] ?? '').trim().toLowerCase()
  const status = o['status'] === 'confirmed' || o['status'] === 'unconfirmed' ? o['status'] : undefined
  return {
    v: 1,
    op,
    at: Number(o['at'] ?? 0) || 0,
    segments,
    lineageKey: key,
    host: String(o['host'] ?? '').trim().toLowerCase(),
    ...(address ? { address } : {}),
    ...(zone ? { zone } : {}),
    ...(own !== undefined ? { own } : {}),
    ...(sealed ? { sealed } : {}),
    ...(status ? { status } : {}),
  }
}

const parse = (bytes: ArrayBuffer | null): PublishResultRecord[] => {
  if (!bytes) return []
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    const list = Array.isArray(raw) ? raw : (raw as { results?: unknown })?.results
    return Array.isArray(list) ? list.map(validate).filter((r): r is PublishResultRecord => r !== null) : []
  } catch { return [] }
}

const readOnlyPool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const root = get<StoreLike>(STORE_KEY)?.opfsRoot
  if (!root) return null
  try { return await root.getDirectoryHandle(await registerPoolMeaning(PUBLISH_RESULTS_POOL), { create: false }) }
  catch { return null }
}

/** Every result this participant has had, oldest first. Empty when the pool
 *  was never written — a reader never mints it. */
export async function listPublishResults(): Promise<PublishResultRecord[]> {
  const store = get<StoreLike>(STORE_KEY)
  const pool = await readOnlyPool()
  if (!pool || !store?.getPoolDoc) return []
  return parse(await store.getPoolDoc(pool))
}

/** The last result per creation decides its door (doorsOfResults), so
 *  bounding the list drops only results a later one for the same creation
 *  has superseded, oldest first — never the one that says a creation is
 *  open. A participant with more creations than the bound keeps them all. */
export const compactResults = (results: readonly PublishResultRecord[], max = MAX_RESULTS): PublishResultRecord[] => {
  if (results.length <= max) return [...results]
  const deciding = new Map<string, number>()
  results.forEach((r, i) => {
    const at = deciding.get(r.lineageKey)
    if (at === undefined || (results[at]?.at ?? 0) <= r.at) deciding.set(r.lineageKey, i)
  })
  const keep = new Set(deciding.values())
  const superseded = results.map((r, i) => ({ r, i })).filter(({ i }) => !keep.has(i))
    .sort((a, b) => a.r.at - b.r.at || a.i - b.i)
  const drop = new Set(superseded.slice(0, Math.max(0, results.length - max)).map(({ i }) => i))
  return results.filter((_, i) => !drop.has(i))
}

/** Whether the pool already holds a document — so a read that came back
 *  empty is a failed read, not an empty list. */
const holdsDocument = async (pool: FileSystemDirectoryHandle): Promise<boolean> => {
  try {
    for await (const name of (pool as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (/^[0-9a-f]{64}$/.test(name)) return true
    }
  } catch { return true }
  return false
}

/** Results are written one at a time, each reading the list the one before
 *  it wrote: two publishes finishing together must both be on the list. */
let writing: Promise<unknown> = Promise.resolve()

/** Append one result and say so. Complete-or-absent: an unreadable list is
 *  never rewritten as a list of one. */
export function recordPublishResult(result: Omit<PublishResultRecord, 'v'>): Promise<boolean> {
  const next = writing.then(() => appendResult(result), () => appendResult(result))
  writing = next.catch(() => false)
  return next
}

async function appendResult(result: Omit<PublishResultRecord, 'v'>): Promise<boolean> {
  const record = validate({ ...result, v: 1 })
  if (!record) return false
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.getPool || !store.putPoolDoc || !store.getPoolDoc) return false
  const pool = await store.getPool(PUBLISH_RESULTS_POOL)
  if (!pool) return false
  const bytes = await store.getPoolDoc(pool)
  if (!bytes && await holdsDocument(pool)) return false
  const list = compactResults([...parse(bytes), record])
  const out = new TextEncoder().encode(JSON.stringify({ meaning: PUBLISH_RESULTS_POOL, results: list }))
  const sig = await store.putPoolDoc(pool, out.buffer as ArrayBuffer, undefined, { keep: 'current' })
  if (!sig) return false
  EffectBus.emit(PUBLISH_RESULT_EFFECT, record)
  return true
}

/** Fold a result list to the doors open now: the LAST result per lineage
 *  key decides, only a publish with an address is open, and only an open
 *  creation with an address a reader can reach is a door. */
export const doorsOfResults = (results: readonly PublishResultRecord[]): PublishedDoor[] => {
  const last = new Map<string, PublishResultRecord>()
  for (const r of [...results].sort((a, b) => a.at - b.at)) last.set(r.lineageKey, r)
  const open = [...last.values()].filter(r => r.op === 'publish' && !!r.address)
  const openOn = new Set(open.map(r => `${r.lineageKey}@${zoneOf(r)}`))
  const doors: PublishedDoor[] = []
  for (const r of open) {
    const name = r.segments[r.segments.length - 1] ?? ''
    if (!name) continue
    const zone = zoneOf(r)
    const address = doorAddress(zone, r.segments, r.lineageKey, ownOf(r, zone), top => openOn.has(`${top}@${zone}`))
    if (!address) continue
    doors.push({ name, segments: r.segments, lineageKey: r.lineageKey, zone, address, at: r.at })
  }
  return doors
}

/** The same doors, read off a publisher's signed index: every root that is
 *  open on some zone, at the address that zone gives it. A root with no
 *  doors entry opens wherever its index is served (the host's opensOn), so
 *  it is a door on `readZone`, the zone the index was read from. The
 *  segments are the key's own (a canonical key is `a/b/c`), so the name is
 *  its last part. */
export const doorsOfIndex = (
  manifest: Pick<HiveManifest, 'roots' | 'doors' | 'addresses' | 'createdAt'>,
  readZone = '',
): PublishedDoor[] => {
  const roots = manifest.roots ?? {}
  const listed = manifest.doors ?? {}
  const zoneOfKey = (key: string): string =>
    String((listed[key] === undefined ? readZone : listed[key]?.[0]) ?? '').trim().toLowerCase()
  const opensOn = (key: string, zone: string): boolean => key in roots && (listed[key] === undefined
    ? zoneOfKey(key) === zone
    : (listed[key] ?? []).some(z => String(z).toLowerCase() === zone))
  const doors: PublishedDoor[] = []
  for (const key of Object.keys(roots)) {
    if (key.includes(':')) continue   // stage and pool pointers are not creations
    const zone = zoneOfKey(key)
    if (!zone) continue
    const segments = key.split('/').filter(Boolean)
    const name = segments[segments.length - 1] ?? ''
    if (!name) continue
    const label = ownLabelOn(manifest.addresses, zone, key)
    const own = label ? originOf(ownAddressHost(label, zone)) : ''
    const address = doorAddress(zone, segments, key, own, top => opensOn(top, zone))
    if (!address) continue
    doors.push({ name, segments, lineageKey: key, zone, address, at: (Number(manifest.createdAt) || 0) * 1000 })
  }
  return doors
}

/** The doors this participant holds open, from the pool. */
export async function publishedDoors(): Promise<PublishedDoor[]> {
  return doorsOfResults(await listPublishResults())
}

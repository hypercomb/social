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
import { creationUrl } from './zone-door.js'

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
   *  domain, else that domain's root path. */
  address?: string
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

const zoneOfAddress = (address: string): string => {
  try { return new URL(address).hostname.toLowerCase() } catch { return '' }
}

/** The zone a door's address lives on: the apex the index was written
 *  through. An own address `<label>.<zone>` and a root path `<zone>/<path>`
 *  both fold to the host that published them. */
const zoneOf = (record: { host: string; address?: string }): string =>
  String(record.host ?? '').trim().toLowerCase() || zoneOfAddress(record.address ?? '')

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

/** Append one result and say so. Complete-or-absent: the document is one
 *  write through the store's queue, so two results landing together cannot
 *  interleave. */
export async function recordPublishResult(result: Omit<PublishResultRecord, 'v'>): Promise<boolean> {
  const record = validate({ ...result, v: 1 })
  if (!record) return false
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.getPool || !store.putPoolDoc) return false
  const pool = await store.getPool(PUBLISH_RESULTS_POOL)
  if (!pool) return false
  const before = store.getPoolDoc ? parse(await store.getPoolDoc(pool)) : []
  const next = [...before, record].slice(-MAX_RESULTS)
  const bytes = new TextEncoder().encode(JSON.stringify({ meaning: PUBLISH_RESULTS_POOL, results: next }))
  const sig = await store.putPoolDoc(pool, bytes.buffer as ArrayBuffer, undefined, { keep: 'current' })
  if (!sig) return false
  EffectBus.emit(PUBLISH_RESULT_EFFECT, record)
  return true
}

/** Fold a result list to the doors open now: the LAST result per lineage
 *  key decides, and only a publish with an address is a door. */
export const doorsOfResults = (results: readonly PublishResultRecord[]): PublishedDoor[] => {
  const last = new Map<string, PublishResultRecord>()
  for (const r of [...results].sort((a, b) => a.at - b.at)) last.set(r.lineageKey, r)
  const doors: PublishedDoor[] = []
  for (const r of last.values()) {
    if (r.op !== 'publish' || !r.address) continue
    const name = r.segments[r.segments.length - 1] ?? ''
    if (!name) continue
    doors.push({ name, segments: r.segments, lineageKey: r.lineageKey, zone: zoneOf(r), address: r.address, at: r.at })
  }
  return doors
}

/** The same doors, read off a publisher's signed index: every root that has
 *  a door on some zone, at the address that zone gives it. The segments are
 *  the key's own (a canonical key is `a/b/c`), so the name is its last part. */
export const doorsOfIndex = (manifest: Pick<HiveManifest, 'roots' | 'doors' | 'addresses' | 'createdAt'>): PublishedDoor[] => {
  const doors: PublishedDoor[] = []
  for (const key of Object.keys(manifest.roots ?? {})) {
    if (key.includes(':')) continue   // stage and pool pointers are not creations
    const zones = (manifest.doors ?? {})[key] ?? []
    const zone = String(zones[0] ?? '').trim().toLowerCase()
    if (!zone) continue
    const segments = key.split('/').filter(Boolean)
    const name = segments[segments.length - 1] ?? ''
    if (!name) continue
    doors.push({
      name,
      segments,
      lineageKey: key,
      zone,
      address: creationUrl(zone, segments, key, manifest.addresses),
      at: (Number(manifest.createdAt) || 0) * 1000,
    })
  }
  return doors
}

/** The doors this participant holds open, from the pool. */
export async function publishedDoors(): Promise<PublishedDoor[]> {
  return doorsOfResults(await listPublishResults())
}

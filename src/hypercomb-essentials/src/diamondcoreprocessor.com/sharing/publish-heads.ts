// diamondcoreprocessor.com/sharing/publish-heads.ts
//
// THE PUBLISH LEDGER — what this participant has put into the world, and
// what they last saw of it. Owner of the `publish:heads` pool of meaning.
//
// Why this exists at all. The hive index (`/hive/<pubkey>`, kind 30564) is
// the ONE mutable object in static hosting, and it is REPLACEABLE, not
// mergeable: every PUT carries the complete `lineageKey → head` map. That
// makes the publisher's own memory of what they have published load-bearing
// in two separate ways:
//
//   1. SAFETY. To advance one branch you must rewrite the whole map. If the
//      read-back-before-merge fails — an offline moment, a CORS hiccup, an
//      edge 502 — a naive merge PUTs an index containing only the branch
//      being published, silently unpublishing every other branch. The ledger
//      is the independent record that lets the write refuse (publish-branch.ts).
//   2. HONESTY. A schnorr signature proves an index IS the publisher's; it
//      never proves it is the LATEST. Only comparing a fetched `created_at`
//      against one we ourselves signed can catch an edge serving a superseded
//      index — so the stamp has to be written down at publish time.
//
// TRUTH, NOT A DERIVED CACHE. "I advanced the index to head X at time T" is
// the record of a remote act. No cold client could rebuild it by walking
// layers, so by the optimize-phase litmus it is state and gets its own pool;
// it is never minted from `optimize()` and never written from the commit path.
//
// Two member shapes share the pool, exactly as `sign('host-push')` carries
// queue entries and `.public` markers side by side:
//
//   {sealedSig}                     — the PUBLISH RECORD (truth)
//   {sealedSig}.{hostHash}.seen     — an OBSERVATION (never load-bearing)
//
// The observation sidecar deliberately fails RECORD_RE, so listing records
// never surfaces one. Deleting every sidecar loses nothing but the "as of"
// line an offline panel shows.

import { get, SignatureService, registerPoolMeaning } from '@hypercomb/core'

const STORE_KEY = '@hypercomb.social/Store'
const POOL_MEANING = 'publish:heads'
const SIG_RE = /^[a-f0-9]{64}$/
/** Records are named by the published head sig and nothing else — the pool
 *  listing IS the index of everything ever published. */
const RECORD_RE = /^[a-f0-9]{64}$/
const SEEN_SUFFIX = '.seen'

/** One successful advance of the hive index. Immutable once written: a later
 *  publish of the same branch mints a NEW head and therefore a new member. */
export interface PublishRecord {
  v: 1
  /** The branch path, stored VERBATIM. `lineageKey` folds every non-alphanumeric
   *  to `-`, so it cannot be inverted — without the segments the panel could
   *  only ever show a mangled name, and could not re-seal the branch to compare. */
  segments: string[]
  /** The index key these segments fold to — what the published map is keyed by. */
  lineageKey: string
  /** Bare domain the index was PUT to. */
  host: string
  /** Pubkey the index was signed under. A later signer change makes a
   *  DIFFERENT hive; the panel says so rather than showing everything as gone. */
  pubkey: string
  /** Epoch MS of the local publish act. */
  at: number
  /** SECONDS-epoch `created_at` of the index event we signed. The freshness
   *  baseline. Note the unit differs from `at` on purpose — it must compare
   *  directly against `HiveManifest.createdAt`, which is seconds. */
  indexCreatedAt: number
  /** The hive-link bundle resource minted for this publish — the sig a
   *  visitor actually opens (`https://<origin>/<bundleSig>`). Recorded so the
   *  link can be re-offered later, and so it can be probed: index fresh +
   *  head served + bundle 404 is a green row with a dead link. */
  bundleSig?: string
}

/** What a probe pass saw. Rewritten in place each time; never truth. */
export interface PublishObservation {
  /** Epoch MS of the observation. */
  at: number
  verdict: string
  /** The `created_at` carried by the index we read, in seconds. */
  indexCreatedAt?: number
}

export interface PublishLedgerEntry {
  /** The published head — also the member's filename. */
  sealed: string
  record: PublishRecord
}

/** sign(meaning) → pool address, via the core registry. Deriving REGISTERS
 *  the meaning, so root walkers can tell this pool from a lineage sigbag —
 *  they share one flat namespace. Never hardcode the hex. */
const poolSignature = (): Promise<string> => registerPoolMeaning(POOL_MEANING)

/** hostHash — first 16 hex of sha256(lowercased domain). Same convention
 *  HostSyncService uses for receipt filenames, so the two agree on how a host
 *  is named on disk. */
const hostHashes = new Map<string, Promise<string>>()
const hostHash = (domain: string): Promise<string> => {
  const key = String(domain ?? '').trim().toLowerCase()
  let hash = hostHashes.get(key)
  if (!hash) {
    hash = SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer).then(s => s.slice(0, 16))
    hostHashes.set(key, hash)
  }
  return hash
}

const getPool = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  const store = get<{ opfsRoot?: FileSystemDirectoryHandle }>(STORE_KEY)
  const root = store?.opfsRoot
  if (!root) return null
  try { return await root.getDirectoryHandle(await poolSignature(), { create }) }
  catch { return null }
}

const validate = (raw: unknown): PublishRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const segments = Array.isArray(o['segments'])
    ? (o['segments'] as unknown[]).map(s => String(s ?? '').trim()).filter(Boolean)
    : []
  const lineageKey = String(o['lineageKey'] ?? '').trim()
  const pubkey = String(o['pubkey'] ?? '').trim().toLowerCase()
  if (segments.length === 0 || !lineageKey || !SIG_RE.test(pubkey)) return null
  const bundleSig = String(o['bundleSig'] ?? '').trim().toLowerCase()
  return {
    v: 1,
    segments,
    lineageKey,
    host: String(o['host'] ?? '').trim().toLowerCase(),
    pubkey,
    at: Number(o['at'] ?? 0) || 0,
    indexCreatedAt: Number(o['indexCreatedAt'] ?? 0) || 0,
    ...(SIG_RE.test(bundleSig) ? { bundleSig } : {}),
  }
}

/** Record a successful index advance. Complete-or-absent: the member is
 *  written in ONE write, so a half-written record can never be read back.
 *  Idempotent — re-publishing the same head overwrites with a fresher stamp. */
export async function writePublishRecord(sealed: string, record: PublishRecord): Promise<boolean> {
  const s = String(sealed ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return false
  const dir = await getPool(true)
  if (!dir) return false
  try {
    const handle = await dir.getFileHandle(s, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new TextEncoder().encode(JSON.stringify(record))) }
    finally { await writable.close() }
    return true
  } catch { return false }
}

/** Every publish record, newest first. Malformed members are skipped, not
 *  thrown on — one bad file must never blind the panel to the rest. */
export async function listPublishRecords(): Promise<PublishLedgerEntry[]> {
  const dir = await getPool(false)
  if (!dir) return []
  const out: PublishLedgerEntry[] = []
  try {
    for await (const [name, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (!RECORD_RE.test(name) || handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const record = validate(JSON.parse(await file.text()))
        if (record) out.push({ sealed: name, record })
      } catch { /* unreadable member — skip */ }
    }
  } catch { return [] }
  return out.sort((a, b) => b.record.at - a.record.at)
}

/** The newest record per lineage key, scoped to one publisher identity.
 *  Scoping by pubkey matters: after a signer change the old records describe
 *  a DIFFERENT hive that this participant can no longer advance. */
export async function latestByLineageKey(pubkey?: string): Promise<Map<string, PublishLedgerEntry>> {
  const key = String(pubkey ?? '').trim().toLowerCase()
  const out = new Map<string, PublishLedgerEntry>()
  for (const entry of await listPublishRecords()) {
    if (key && entry.record.pubkey !== key) continue
    const prior = out.get(entry.record.lineageKey)
    if (!prior || prior.record.at < entry.record.at) out.set(entry.record.lineageKey, entry)
  }
  return out
}

/** The roots map this participant KNOWS it published to `host` under
 *  `pubkey` — the reconstruction that makes an index rewrite safe when the
 *  read-back fails. Newest record per key wins, which is exactly the
 *  semantics of the index itself (one entry per key).
 *
 *  This is a floor, never a ceiling: it cannot know about branches published
 *  from another device. That is why a failed read-back must REFUSE the PUT
 *  rather than fall back to this map — the ledger's job there is to prove the
 *  danger is real, not to paper over it. */
export async function knownRoots(host: string, pubkey: string): Promise<Record<string, string>> {
  const h = String(host ?? '').trim().toLowerCase()
  const out: Record<string, string> = {}
  for (const [key, entry] of await latestByLineageKey(pubkey)) {
    if (h && entry.record.host && entry.record.host !== h) continue
    out[key] = entry.sealed
  }
  return out
}

/** Distinct branch paths that fold to the SAME index key. `lineageKey` maps
 *  many paths to one key (every separator becomes `-`), so `/my-notes` and
 *  `/my notes` share a single index entry and only one of them can be served.
 *  Silently showing one green row for both would be a lie, so the panel names
 *  the collision instead. */
export async function collidingPaths(pubkey?: string): Promise<Map<string, string[]>> {
  const byKey = new Map<string, Set<string>>()
  const key = String(pubkey ?? '').trim().toLowerCase()
  for (const entry of await listPublishRecords()) {
    if (key && entry.record.pubkey !== key) continue
    const paths = byKey.get(entry.record.lineageKey) ?? new Set<string>()
    paths.add('/' + entry.record.segments.join('/'))
    byKey.set(entry.record.lineageKey, paths)
  }
  const out = new Map<string, string[]>()
  for (const [k, paths] of byKey) if (paths.size > 1) out.set(k, [...paths])
  return out
}

/** Remember what a probe pass saw, so an offline panel can say "as of ..."
 *  instead of going blank. Best-effort in every direction — a failed write is
 *  not worth surfacing. */
export async function writeObservation(sealed: string, host: string, observation: PublishObservation): Promise<void> {
  const s = String(sealed ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return
  const dir = await getPool(true)
  if (!dir) return
  try {
    const handle = await dir.getFileHandle(`${s}.${await hostHash(host)}${SEEN_SUFFIX}`, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new TextEncoder().encode(JSON.stringify(observation))) }
    finally { await writable.close() }
  } catch { /* observations are disposable */ }
}

export async function readObservation(sealed: string, host: string): Promise<PublishObservation | null> {
  const s = String(sealed ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return null
  const dir = await getPool(false)
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(`${s}.${await hostHash(host)}${SEEN_SUFFIX}`, { create: false })
    const parsed = JSON.parse(await (await handle.getFile()).text()) as Record<string, unknown>
    return {
      at: Number(parsed?.['at'] ?? 0) || 0,
      verdict: String(parsed?.['verdict'] ?? ''),
      indexCreatedAt: Number(parsed?.['indexCreatedAt'] ?? 0) || 0,
    }
  } catch { return null }
}

/** The newest index `created_at` this participant has ever signed for
 *  `host`/`pubkey`. An index read whose stamp is OLDER than this is being
 *  served stale — the only detectable form of "authentic but superseded". */
export async function highWaterIndexStamp(host: string, pubkey: string): Promise<number> {
  const h = String(host ?? '').trim().toLowerCase()
  const key = String(pubkey ?? '').trim().toLowerCase()
  let max = 0
  for (const entry of await listPublishRecords()) {
    if (key && entry.record.pubkey !== key) continue
    if (h && entry.record.host && entry.record.host !== h) continue
    if (entry.record.indexCreatedAt > max) max = entry.record.indexCreatedAt
  }
  return max
}

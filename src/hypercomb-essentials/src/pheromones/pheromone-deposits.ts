// pheromones/pheromone-deposits.ts
//
// AUTHORED DEPOSITS — pheromones somebody ELSE (or their agent) put on exact
// bytes, verified and read the same way this participant's own marks are.
//
// documentation/pheromones.md's 2026-09-13 reframe: a pheromone is not a
// classifier, it is a signed interest-signal a depositor makes about content,
// and the depositor can be a person, another participant, or an agent that
// read the content and decided it was worth marking — no special case, any
// caller mints one the same way. This module is that build: it closes the
// gap documentation/intake-filter.md logs as "Owed: marks that travel with
// content" — a deposit is a signed record, mintable by anyone who holds the
// bytes, verifiable by anyone who receives it, independent of who wrote it.
//
// ── shape ───────────────────────────────────────────────────────────────
//
// A deposit is a nostr event: `{ kind: PHEROMONE_DEPOSIT_KIND, tags: [['d',
// target], ['k', mark]], content: <preimage>, ... }`, signed by the
// depositor's own key (sharing/nostr-signer.ts). The preimage rides verbatim
// as `content` — same reasoning as sharing/head-claim-signer.ts: NostrSigner
// only signs a nostr event whose `content` is a string, so there is no
// raw-bytes door, and the preimage IS the content rather than a derivative
// of it.
//
// Unlike a head claim, a deposit never supersedes an earlier one — many
// people (and agents) can each deposit their own opinion about the same
// target, forever, and read-time evaporation is a function over ALL of them
// (documentation/pheromones.md, "decay never rewrites or deletes markers").
// So there is no head, no `prev`, no `seq` — just an appendable set.
//
// ── storage: one lineage per target, bucketed per author ──────────────────
//
// documentation/pheromones.md's storage model is
//   <sign('pheromones:deposits')>/<lineage-per-target>/0000, 0001, …
// with each marker referencing a sig-addressed deposit record (signature-
// reference doctrine — never inline). Many independent authors can deposit on
// the SAME target, so "one lineage" is bucketed per depositor underneath the
// target — exactly the shape molecule/facet-succession.ts already proved for
// "one lineage per subject, many authors, no coordination needed to append":
//
//   <pool>/<targetSig>/<depositorPubkey>/00000000, 00000001, …
//
// Each marker's CONTENT is a pointer: the signature of the deposit record
// (the signed event JSON), minted at the flat content root via
// `Store.putResource`. This participant only ever numbers markers inside
// their OWN (target, pubkey) bucket, so two depositors can never collide on a
// marker name — the same reason facet-succession buckets by author.
//
// Reading ignores marker order entirely: every deposit stands alone (no fork
// resolution, no head), so a reader unions every bucket under a target and
// verifies each record independently. Order only matters for THIS
// participant's own next marker number, exactly like `HistoryService`'s
// private `#nextMarkerName` scans "whatever is already in the bag".
//
// This module does not yet carry deposits across a hive boundary alongside
// the content they mark (the mesh/publish half) — see documentation/
// pheromones.md "Not now". What is built: signing, verifying, local mint,
// and local read — including deposits a peer's replicated content already
// brought into this participant's own `pheromones:deposits` pool by any
// other path, which `readDeposits` reads exactly like a local mint.

import { EffectBus, MARKER_NAME, SIGNATURE_NAME, get, markerName } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools'
import { normalizeTags } from '../notes/note-tree.js'
import { readerPubkey } from '../sharing/head-claim-signer.js'

const DEPOSITS_MEANING = 'pheromones:deposits'

/** 30209-30217 are the swarm/peer-model kinds (sharing/swarm.drone.ts,
 *  peer-models.drone.ts); 30564-30566 are the hive-index/head-claim/vocabulary
 *  kinds (sharing/hive-link.ts, head-claim-signer.ts, molecule/vocabulary-
 *  signer.ts). 30218 sits clear of both clusters with room to spare. */
export const PHEROMONE_DEPOSIT_KIND = 30218

const D_TAG = 'd'
const K_TAG = 'k'
const DEPOSIT_DOMAIN = 'hc-pheromone-deposit-v1'
const SIG_RE = /^[0-9a-f]{64}$/i
const HEX64 = /^[0-9a-f]{64}$/

export type PheromoneDeposit = {
  readonly target: string
  readonly kind: string
  readonly depositor: string
  readonly at: number
}

export type DepositMintResult =
  | { ok: true; deposit: PheromoneDeposit }
  | { ok: false; reason: 'bad target' | 'bad kind' | 'no signer' | 'signing refused' | 'signer key changed' | 'self-verify failed' | 'no store' }

/** The signed preimage. Domain-tagged, `\n`-joined, no JSON — same shape as
 *  `headClaimPreimage` and for the same reason: an application-chosen byte
 *  string a reader can rebuild and compare, with nothing to escape.
 *
 *  Exported so a test can construct a byte-identical "stranger's deposit"
 *  without hand-duplicating the format — the writer must never be a weaker
 *  gate than the reader, and a copy of this string one keystroke off from
 *  the real one would prove nothing. */
export const depositPreimage = (target: string, kind: string, depositor: string, at: number): string =>
  [DEPOSIT_DOMAIN, target, kind, depositor, String(at)].join('\n')

const tagValue = (tags: unknown, key: string): string | null => {
  if (!Array.isArray(tags)) return null
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === key && typeof t[1] === 'string') return t[1]
  }
  return null
}

/**
 * Shape → address → content → curve, in that order — the same
 * cheapest-first discipline as `head-claim-signer.ts`'s `verifierFor`, and
 * the elliptic-curve check runs last on purpose. Returns the parsed deposit
 * only when every check passes; there is no partial credit.
 */
const parseDeposit = (evt: Record<string, unknown>): PheromoneDeposit | null => {
  if (Number(evt?.['kind']) !== PHEROMONE_DEPOSIT_KIND) return null
  const depositor = String(evt?.['pubkey'] ?? '').toLowerCase()
  if (!HEX64.test(depositor)) return null
  const target = String(tagValue(evt?.['tags'], D_TAG) ?? '').toLowerCase()
  if (!HEX64.test(target)) return null
  const kind = tagValue(evt?.['tags'], K_TAG) ?? ''
  if (normalizeTags([kind])[0] !== kind) return null
  const at = Number(evt?.['created_at'])
  if (!Number.isFinite(at) || at < 0) return null
  if (String(evt?.['content'] ?? '') !== depositPreimage(target, kind, depositor, at)) return null
  try { if (!verifyEvent(evt as never)) return null } catch { return null }
  return { target, kind, depositor, at }
}

// ── the two IoC-resolved dependencies, each a local accessor like the rest
// of this domain (pheromone-marks.ts, intake-filter.ts) keeps its own —
// essentials modules do not share one lookup helper for this. ──────────────

const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

interface SignerLike {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
}

const signer = (): SignerLike | undefined => {
  try { return get<SignerLike>(NOSTR_SIGNER_KEY) } catch { return undefined }
}

type FileLike = { getFile(): Promise<{ text(): Promise<string> }> }
type DirLike = {
  kind?: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileLike & { createWritable(): Promise<{ write(d: unknown): Promise<void>; close(): Promise<void> }> }>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirLike>
  entries?(): AsyncIterable<[string, { kind?: string }]>
}

type StoreLike = {
  getPool(meaning: string): Promise<DirLike | null>
  /** The read-only open. A read must never mint the pool. */
  openPool?(meaning: string): Promise<DirLike | null>
  putResource(blob: Blob): Promise<string | null>
  getResource(sig: string): Promise<Blob | null>
}

const store = (): StoreLike | undefined => {
  try { return get<StoreLike>('@hypercomb.social/Store') } catch { return undefined }
}

const isAbsent = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'NotFoundError'

/** Scan a bucket for its current max marker and write the next one, content
 *  = the pointer. Mirrors `HistoryService`'s private `#nextMarkerName`, which
 *  is not exported for reuse outside that class. */
async function appendMarker(bucket: DirLike, pointer: string): Promise<boolean> {
  let max = -1
  if (bucket.entries) {
    for await (const [name, handle] of bucket.entries()) {
      if (handle?.kind && handle.kind !== 'file') continue
      if (!MARKER_NAME.test(name)) continue
      const n = Number(name)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }
  const next = markerName(max + 1)
  if (next === null) return false // marker ceiling — refuse rather than collide
  try {
    const handle = await bucket.getFileHandle(next, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(pointer) } finally { await writable.close() }
    return true
  } catch { return false }
}

/**
 * Sign and store a deposit: this depositor marks `target` with `kind`.
 *
 * ANY caller reaches this the same way — a person's gesture in the
 * pheromone window, or an agent's routine that read the content and decided
 * it was worth marking. There is no separate "agent" path: the depositor is
 * whoever the registered signer identifies as, exactly as `mintDeposit`
 * cannot tell (and must not care) whether a human clicked or a bee acted.
 */
export async function mintDeposit(target: string, kind: string): Promise<DepositMintResult> {
  const t = String(target ?? '').toLowerCase()
  if (!SIG_RE.test(t)) return { ok: false, reason: 'bad target' }
  const cleanKind = normalizeTags([kind])[0]
  if (!cleanKind) return { ok: false, reason: 'bad kind' }

  const s = signer()
  if (!s?.signEvent) return { ok: false, reason: 'no signer' }
  const depositor = await readerPubkey()
  if (!depositor) return { ok: false, reason: 'no signer' }

  const at = Math.floor(Date.now() / 1000)
  const content = depositPreimage(t, cleanKind, depositor, at)

  let signed: Record<string, unknown>
  try {
    signed = await s.signEvent({
      kind: PHEROMONE_DEPOSIT_KIND,
      created_at: at,
      tags: [[D_TAG, t], [K_TAG, cleanKind]],
      content,
    })
  } catch { return { ok: false, reason: 'signing refused' } }

  if (String(signed?.['pubkey'] ?? '').toLowerCase() !== depositor) {
    return { ok: false, reason: 'signer key changed' }
  }

  // SIGN THEN SELF-VERIFY AGAINST THE ROUND-TRIPPED BYTES — the same reason
  // head-claim-signer.ts does: verifying the object the signer just handed
  // back would let `finalizeEvent`'s cached verified-symbol answer for it.
  const json = JSON.stringify(signed)
  let published: Record<string, unknown>
  try { published = JSON.parse(json) as Record<string, unknown> } catch { return { ok: false, reason: 'self-verify failed' } }
  const parsed = parseDeposit(published)
  if (!parsed) return { ok: false, reason: 'self-verify failed' }

  const st = store()
  if (!st) return { ok: false, reason: 'no store' }
  let recordSig: string | null
  try { recordSig = await st.putResource(new Blob([json], { type: 'application/json' })) }
  catch { recordSig = null }
  if (!recordSig) return { ok: false, reason: 'no store' }

  try {
    const pool = await st.getPool(DEPOSITS_MEANING)
    if (!pool) return { ok: false, reason: 'no store' }
    const targetBucket = await pool.getDirectoryHandle(t, { create: true })
    const authorBucket = await targetBucket.getDirectoryHandle(depositor, { create: true })
    if (!(await appendMarker(authorBucket, recordSig))) return { ok: false, reason: 'no store' }
  } catch { return { ok: false, reason: 'no store' } }

  remember(t, parsed.kind)
  EffectBus.emit('pheromones:deposit-minted', { target: t, kind: cleanKind, depositor, at })
  return { ok: true, deposit: parsed }
}

/** In-memory cache of verified deposit KINDS per target — same "an entry is
 *  only ever an answer" discipline as `pheromone-marks.ts`'s record cache.
 *
 *  UNLIKE `pheromone-marks.ts`, this pool has MANY writers: this participant
 *  via `mintDeposit`, and — once deposits travel across a hive boundary
 *  (documentation/pheromones.md, "Not now") — a future sync path writing a
 *  peer's markers straight into a bucket this cache may already have
 *  answered for. `remember` below optimistically extends the cache so a
 *  freshly-minted deposit of YOUR OWN is visible without a re-read; it is
 *  correct only because `mintDeposit` is, today, the only writer this module
 *  knows about. Any future code that writes a marker from outside
 *  `mintDeposit` MUST call `forgetDeposits(target)` first, or a target this
 *  cache already answered for will silently stay stale forever. */
const cache = new Map<string, readonly string[]>()
const NONE: readonly string[] = Object.freeze([])

function remember(target: string, kind: string): void {
  const prior = cache.get(target) ?? []
  if (prior.includes(kind)) return
  cache.set(target, Object.freeze([...prior, kind].sort()))
}

/** Drop a target's cached answer, forcing the next read to re-scan the pool
 *  from disk. Call this after writing a marker into `pheromones:deposits`
 *  from OUTSIDE `mintDeposit` — a merge, a sync pass, a replicated peer
 *  bucket landing for the first time — so the cache this module already
 *  answered for does not shadow the new evidence. */
export function forgetDeposits(target: string): void {
  cache.delete(target.toLowerCase())
}

/** ONE READ, and whether it landed — mirrors `pheromone-marks.ts`'s
 *  `readFromPool`: only "the bucket is genuinely absent" is an answer;
 *  anything else (no Store, a torn handle) must not be cached as one. */
async function readFromPool(target: string): Promise<{ landed: boolean; kinds: string[] }> {
  const st = store()
  if (!st) return { landed: false, kinds: [] }

  let pool: DirLike | null
  try { pool = await (st.openPool?.(DEPOSITS_MEANING) ?? st.getPool(DEPOSITS_MEANING)) }
  catch { return { landed: false, kinds: [] } }
  // No pool at all means nobody's deposit has ever reached this participant.
  if (!pool) return { landed: true, kinds: [] }

  let targetBucket: DirLike
  try { targetBucket = await pool.getDirectoryHandle(target, { create: false }) }
  catch (err) { return isAbsent(err) ? { landed: true, kinds: [] } : { landed: false, kinds: [] } }

  const kinds = new Set<string>()
  try {
    if (!targetBucket.entries) return { landed: true, kinds: [] }
    for await (const [depositor, authorHandle] of targetBucket.entries()) {
      if (authorHandle?.kind && authorHandle.kind !== 'directory') continue
      if (!SIGNATURE_NAME.test(depositor)) continue
      const authorBucket = authorHandle as unknown as DirLike
      if (!authorBucket.entries) continue
      for await (const [marker, fileHandle] of authorBucket.entries()) {
        if (fileHandle?.kind && fileHandle.kind !== 'file') continue
        if (!MARKER_NAME.test(marker)) continue
        try {
          const file = await (fileHandle as unknown as FileLike).getFile()
          const pointer = (await file.text()).trim().toLowerCase()
          if (!SIG_RE.test(pointer)) continue
          const blob = await st.getResource(pointer)
          if (!blob) continue
          const evt = JSON.parse(await blob.text()) as Record<string, unknown>
          const parsed = parseDeposit(evt)
          // The bucket's own name is a claimed pubkey; only trust a record
          // that is BOTH validly signed AND actually signed by that pubkey.
          if (parsed && parsed.target === target && parsed.depositor === depositor) kinds.add(parsed.kind)
        } catch { /* one unreadable marker must not sink the whole read */ }
      }
    }
  } catch { return { landed: false, kinds: [] } }

  return { landed: true, kinds: [...kinds] }
}

async function readKinds(target: string): Promise<readonly string[]> {
  const known = cache.get(target)
  if (known) return known
  const read = await readFromPool(target)
  if (!read.landed) return NONE
  const frozen = Object.freeze(read.kinds.sort())
  cache.set(target, frozen)
  return frozen
}

/**
 * THE KINDS ALREADY IN HAND — synchronous, `undefined` when never read. Same
 * contract as `sigMarksKnown`: an empty array IS an answer ("read it, no
 * deposits"); `undefined` means "no idea yet, allow and kick a read".
 */
export function depositKindsKnown(target: string): readonly string[] | undefined {
  if (!SIG_RE.test(target)) return undefined
  return cache.get(target.toLowerCase())
}

/** Every mark ANYONE has authored on these exact bytes, verified. This is
 *  the "read pheromones from other people" half — a peer's deposit that
 *  reached this participant's own `pheromones:deposits` pool by any path
 *  reads identically to one minted locally. */
export async function depositKindsOf(target: string): Promise<readonly string[]> {
  if (!SIG_RE.test(target)) return []
  return await readKinds(target.toLowerCase())
}

// Reachable from OUTSIDE essentials — the same loose-IoC seam PheromoneMarks
// and IntakeFilter use.
window.ioc.register('@diamondcoreprocessor.com/PheromoneDeposits', {
  PHEROMONE_DEPOSIT_KIND,
  mintDeposit,
  depositKindsOf,
  depositKindsKnown,
  forgetDeposits,
})

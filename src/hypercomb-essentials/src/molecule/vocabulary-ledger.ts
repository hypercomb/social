// molecule/vocabulary-ledger.ts
//
// TWO POOLS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE FILE.
//
//   sign('vocabulary:published')  MY OWN acts. "I signed claim C at seq N and
//       advanced my index to it." No cold client could rebuild that by walking
//       layers, so by the optimize-phase litmus it is STATE — its own pool, and
//       never minted from `optimize()` or from the commit path. It is also the
//       `minted` half of `planVocabularyClaim`'s anti-rollback rule: a host
//       that is merely BEHIND must never be able to make me re-sign a counter
//       I already passed.
//
//   sign('vocabulary:seen')  WHAT I HAVE PROVEN ABOUT OTHERS. One record per
//       publisher, `{at, seq}` and NOTHING ELSE — read the next paragraph
//       before adding a field.
//
// NO STRANGER'S SIGNATURE GOES IN THE SEEN POOL. `referencesOutside` /
// `sigsReferencedOutside` credit every 64-hex string found in a pool member's
// bytes, so a `bodySig` in a seen record would PIN another participant's atoms
// in my store against prune. That is not a cache, it is litter that never
// drains. My OWN records may name my own atoms — there, pinning is the point:
// an unpinned published claim would be collected and my pointer would dangle.
//
// The two-shape trick from `sharing/publish-heads.ts` is not needed here
// (different pools, different lifetimes), but the write discipline is the same:
// one write per member, complete-or-absent, and a malformed member is skipped
// rather than thrown on — one bad file must never blind the reader to the rest.

import { get, registerPoolMeaning } from '@hypercomb/core'

const STORE_KEY = '@hypercomb.social/Store'
const SIG_RE = /^[a-f0-9]{64}$/

/** MY acts. */
export const VOCABULARY_LEDGER_MEANING = 'vocabulary:published'
/** WHAT I have proven about others. */
export const VOCABULARY_SEEN_MEANING = 'vocabulary:seen'

/** One vocabulary publish, recorded BEFORE the act is reported as done. */
export interface VocabularyPublishRecord {
  v: 1
  /** The key the claim was signed under. */
  pubkey: string
  /** `sign('vocabulary:hive')` — the surface the claim binds to. */
  surface: string
  /** The canonical body atom this claim commits to. */
  body: string
  /** The previous claim's body sig, or null at genesis. */
  prev: string | null
  /** The signed counter. THE anti-rollback value. */
  seq: number
  /** How many addresses the body held. */
  count: number
  /** Was the picture whole? */
  complete: boolean
  /** Bare domain the index was advanced on. */
  host: string
  /** Epoch MS of the local act. */
  at: number
}

/** What this reader has PROVEN about one publisher. No signatures — ever. */
export interface VocabularySeenRecord {
  at: number
  seq: number
}

const poolAddress = (meaning: string): Promise<string> => registerPoolMeaning(meaning)

const getPool = async (meaning: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  const store = get<{ opfsRoot?: FileSystemDirectoryHandle }>(STORE_KEY)
  const root = store?.opfsRoot
  if (!root) return null
  try { return await root.getDirectoryHandle(await poolAddress(meaning), { create }) }
  catch { return null }
}

const writeMember = async (
  meaning: string,
  name: string,
  value: unknown,
): Promise<boolean> => {
  const dir = await getPool(meaning, true)
  if (!dir) return false
  try {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new TextEncoder().encode(JSON.stringify(value))) }
    finally { await writable.close() }
    return true
  } catch { return false }
}

const readMember = async (meaning: string, name: string): Promise<unknown> => {
  const dir = await getPool(meaning, false)
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(name, { create: false })
    return JSON.parse(await (await handle.getFile()).text()) as unknown
  } catch { return null }
}

const validateRecord = (raw: unknown): VocabularyPublishRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const pubkey = String(o['pubkey'] ?? '').trim().toLowerCase()
  const surface = String(o['surface'] ?? '').trim().toLowerCase()
  const body = String(o['body'] ?? '').trim().toLowerCase()
  const prevRaw = String(o['prev'] ?? '').trim().toLowerCase()
  const seq = Number(o['seq'] ?? -1)
  const count = Number(o['count'] ?? -1)
  if (!SIG_RE.test(pubkey) || !SIG_RE.test(surface) || !SIG_RE.test(body)) return null
  if (!Number.isSafeInteger(seq) || seq < 0) return null
  if (!Number.isSafeInteger(count) || count < 0) return null
  return {
    v: 1,
    pubkey,
    surface,
    body,
    prev: SIG_RE.test(prevRaw) ? prevRaw : null,
    seq,
    count,
    complete: o['complete'] === true,
    host: String(o['host'] ?? '').trim().toLowerCase(),
    at: Number(o['at'] ?? 0) || 0,
  }
}

/** Record a vocabulary publish. Named by the CLAIM sig — the pool listing is
 *  the complete index of every vocabulary this participant ever signed. */
export const writeVocabularyRecord = async (
  claimSig: string,
  record: VocabularyPublishRecord,
): Promise<boolean> => {
  const s = String(claimSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return false
  return await writeMember(VOCABULARY_LEDGER_MEANING, s, record)
}

/** Every vocabulary publish record, newest first. */
export const listVocabularyRecords = async (): Promise<
  { claim: string; record: VocabularyPublishRecord }[]
> => {
  const dir = await getPool(VOCABULARY_LEDGER_MEANING, false)
  if (!dir) return []
  const out: { claim: string; record: VocabularyPublishRecord }[] = []
  try {
    for await (const [name, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (!SIG_RE.test(name) || handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const record = validateRecord(JSON.parse(await file.text()))
        if (record) out.push({ claim: name, record })
      } catch { /* one bad member never blinds the rest */ }
    }
  } catch { return [] }
  return out.sort((a, b) => b.record.seq - a.record.seq || b.record.at - a.record.at)
}

/**
 * THE STRONGEST CLAIM THIS DEVICE ACTUALLY SIGNED — `planVocabularyClaim`'s
 * `minted`. Highest seq wins; the ledger is per-device by nature, which is a
 * floor and never a ceiling.
 */
export const mintedVocabularyClaim = async (
  pubkey: string,
): Promise<{ body: string; seq: number } | null> => {
  const key = String(pubkey ?? '').trim().toLowerCase()
  let best: { body: string; seq: number } | null = null
  for (const { record } of await listVocabularyRecords()) {
    if (key && record.pubkey !== key) continue
    if (!best || record.seq > best.seq) best = { body: record.body, seq: record.seq }
  }
  return best
}

/** The proven high-water per publisher, as one map — the search reader wants
 *  it synchronously, and a pool read is not. */
export const loadProvenSeqs = async (): Promise<Map<string, number>> => {
  const out = new Map<string, number>()
  const dir = await getPool(VOCABULARY_SEEN_MEANING, false)
  if (!dir) return out
  try {
    for await (const [name, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (!SIG_RE.test(name) || handle.kind !== 'file') continue
      try {
        const raw = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as Record<string, unknown>
        const seq = Number(raw?.['seq'] ?? -1)
        if (Number.isSafeInteger(seq) && seq >= 0) out.set(name, seq)
      } catch { /* skip */ }
    }
  } catch { return out }
  return out
}

/** Remember the highest seq PROVEN for a publisher. Monotone in one place:
 *  a lower value is a no-op, so a replaying host cannot lower my own floor. */
export const rememberProvenSeq = async (pubkey: string, seq: number): Promise<void> => {
  const key = String(pubkey ?? '').trim().toLowerCase()
  if (!SIG_RE.test(key) || !Number.isSafeInteger(seq) || seq < 0) return
  const held = await readMember(VOCABULARY_SEEN_MEANING, key) as Record<string, unknown> | null
  const heldSeq = Number(held?.['seq'] ?? -1)
  if (Number.isSafeInteger(heldSeq) && heldSeq >= seq) return
  const record: VocabularySeenRecord = { at: Date.now(), seq }
  await writeMember(VOCABULARY_SEEN_MEANING, key, record)
}

/** Exported for the spec — the shape gate the writers share. */
export const readableVocabularyRecord = validateRecord

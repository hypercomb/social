// sharing/stage-succession.ts
//
// THE STAGE LISTS — documentation/deployment-stages.md.
//
// A stage is a word, and a word is a molecule: `sign(word)`. An author's
// stage list is their ONE succession atom in that molecule's bucket for their
// key, and a creation is AT the stage when an envelope over its head is a
// member of that list. Advancing a creation mints the author's next succession
// with the member added (and the creation's previous head dropped, so one
// creation is one member); leaving mints the next one without it — an unlink,
// never a forget. Every prior list is one `prev` back and nothing is deleted.
//
// The pointer `stage:<word>` → the succession's sig rides the SAME signed hive
// index PUT as `roots` and `doors` (publish-branch.ts): one write, two
// pointers, never two facts. `hosted` is not a stage — it is the requirement
// the gestures check (`isClosureAvailable`) — and `published` / `live` are
// what the index already says, listed here by their successions.
//
// The words are protocol until a second lifecycle exists (deployment-stages.md
// R1). They are ordinary words under the collision rule (R11): an author's
// tile named `published` and their published list are the same succession in
// the same bucket, by design.
import { moleculeAddress, moleculeKey } from '@hypercomb/core'
import {
  readSuccessionMembers,
  writeSuccessionHead,
  type FacetReadStore,
  type FacetStore,
  type SuccessionWriteResult,
} from '../molecule/facet-succession.js'
import { cachedPubkey } from './head-claim-signer.js'

const SIG_RE = /^[0-9a-f]{64}$/

export const STAGE_SHARED = 'shared'
export const STAGE_PUBLISHED = 'published'
export const STAGE_LIVE = 'live'
export type StageWord = typeof STAGE_SHARED | typeof STAGE_PUBLISHED | typeof STAGE_LIVE
export const STAGE_WORDS: readonly StageWord[] = Object.freeze([STAGE_SHARED, STAGE_PUBLISHED, STAGE_LIVE])

/** The reserved index root key that points at an author's stage list. A
 *  pointer's name, not a molecule address: the molecule is the bare word. */
export const STAGE_ROOT_PREFIX = 'stage:'
export const stageRootKey = (word: StageWord): string => `${STAGE_ROOT_PREFIX}${word}`
export const isStageRootKey = (key: unknown): boolean => String(key ?? '').startsWith(STAGE_ROOT_PREFIX)

export type StageStore = FacetStore & FacetReadStore

const storeFromIoc = (): StageStore | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<StageStore>('@hypercomb.social/Store')

export interface StageIo {
  store?: StageStore
  /** The author key. `undefined` reads the cached signer key; `null` writes nothing. */
  pubkey?: string | null
  sign?: Parameters<typeof writeSuccessionHead>[0]['sign']
  now?: () => number
}

export type StageWriteResult = SuccessionWriteResult

/** What THIS author lists at a stage: the member heads, in slot order. Empty
 *  when nothing was ever listed. Reads only the author's own bucket. */
export const readStageHeads = async (word: StageWord, io: StageIo = {}): Promise<string[]> => {
  const pubkey = io.pubkey === undefined ? cachedPubkey() : io.pubkey
  const store = io.store ?? storeFromIoc()
  if (!pubkey || !store) return []
  try {
    const molecule = await moleculeAddress(word)
    const read = await readSuccessionMembers({ meaning: moleculeKey(word), molecule, store, ownPubkey: pubkey, ownOnly: true })
    return read?.members ?? []
  } catch { return [] }
}

const writeStage = async (word: StageWord, members: readonly string[], io: StageIo): Promise<StageWriteResult> => {
  const pubkey = io.pubkey === undefined ? cachedPubkey() : io.pubkey
  if (!pubkey) return { ok: false, reason: 'no identity' }
  const store = io.store ?? storeFromIoc()
  if (!store) return { ok: false, reason: 'no store' }
  let molecule: string
  try { molecule = await moleculeAddress(word) } catch (err) { return { ok: false, reason: 'bad subject', detail: String(err) } }
  const key = moleculeKey(word)
  return writeSuccessionHead({
    meaning: key,
    molecule,
    members,
    kind: 'layer',
    incidence: (slot) => ({ relation: key, root: key, slot }),
    store,
    pubkey,
    sign: io.sign,
    now: io.now,
  })
}

/**
 * ADVANCE: list `add` at the stage, dropping `remove` (a creation's previous
 * head) so one creation is one member. Order is kept; a new member goes last.
 * The same list writes nothing (`changed: false`). Never throws.
 */
export const advanceStage = async (
  word: StageWord,
  change: {
    add: readonly string[]
    remove?: readonly string[]
    /** RECONCILE: a listed head this predicate refuses is dropped too. The
     *  publish path passes "still named by my index", so a head an earlier
     *  failed write or a republish left behind never lingers (a list is
     *  reconciled against the index every time it is written). */
    keep?: (head: string) => boolean
  },
  io: StageIo = {},
): Promise<StageWriteResult> => {
  const add = change.add.map(s => String(s ?? '').toLowerCase()).filter(s => SIG_RE.test(s))
  const remove = new Set((change.remove ?? []).map(s => String(s ?? '').toLowerCase()))
  const keep = change.keep ?? (() => true)
  const current = await readStageHeads(word, io)
  const next = current.filter(h => !remove.has(h) && !add.includes(h) && keep(h))
  for (const h of add) if (!next.includes(h)) next.push(h)
  return writeStage(word, next, io)
}

/** WITHDRAW: the next list without these heads (and without any head `keep`
 *  refuses — the same reconciliation as advance). A head that was never
 *  listed changes nothing. Never throws. */
export const withdrawStage = async (
  word: StageWord,
  remove: readonly string[],
  io: StageIo = {},
  keep: (head: string) => boolean = () => true,
): Promise<StageWriteResult> => {
  const gone = new Set(remove.map(s => String(s ?? '').toLowerCase()))
  const current = await readStageHeads(word, io)
  const next = current.filter(h => !gone.has(h) && keep(h))
  return writeStage(word, next, io)
}

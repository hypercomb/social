// molecule/vocabulary-search.ts
//
// SAY A WORD, HASH IT, ASK YOUR HOSTS — with honest absence.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS FILE EXISTS TO PREVENT, NAMED FIRST.
// ═══════════════════════════════════════════════════════════════════════════
// `hypercomb-runtime/src/host-packages.ts` says it in writing: a host that
// "publishes nothing, that cannot be reached, or that is not a host at all —
// the three are deliberately one outcome here." `findPool` returns null for
// all three and `listHostPackages` returns `[]`. There is no status field in
// those types, so there is no channel to carry UNKNOWN at all. A reader
// looking at an empty array cannot tell a genuine empty from a failed lookup,
// and at that point the discovery model is a lie.
//
// FOUR STRUCTURAL PROPERTIES MAKE THE CONFLATION UNREPRESENTABLE HERE. Not one
// of them is documentary:
//
//  1. `why` is `VocabularyUnknown | null` under the invariant
//     `(verdict === 'unknown') === (why !== null)`, enforced in the ONLY three
//     constructors that can build a finding. You cannot mint an `unknown`
//     without naming what stopped you, and you cannot mint an `absent` while
//     naming one.
//  2. `VocabularySearch` carries EXACTLY TWO FIELDS. There is deliberately no
//     `declared: string[]`, no `hosts`, no `count`. Every convenience field is
//     a place a `.length === 0` becomes "nobody has it", so a caller must walk
//     `findings` and read each `verdict` — the unknowns are never off-screen.
//  3. THE ROW SET IS FIXED BEFORE ANY I/O. One row per publisher in the
//     horizon, built before a socket opens; I/O only fills verdicts in. A dead
//     host, a blown deadline or a thrown fetch changes a row and can never
//     delete one, so AN ANSWER CAN NEVER SHRINK INTO AN ABSENCE. (This is the
//     direct repair of `findPool`'s `continue`, where "this host declared
//     nothing" silently becomes "try the next base" and then "nothing found".)
//  4. `absent` is minted in exactly ONE place — by core's `membershipOf`,
//     which returns it only when a claim whose SIGNED `complete` is true omits
//     the word at a seq strictly higher than any claim that named it. And the
//     `absent` finding CARRIES the verified claim it was derived from, so no
//     code path can construct an absence without holding the evidence for it.
//
// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION ORDER — cheapest first, crypto once, BEFORE any body fetch.
// ═══════════════════════════════════════════════════════════════════════════
//   0. SHAPE       pure, local, no I/O.
//   1. SIGNATURE   ONE call, and it is ALSO the placement check: lines 2 and 3
//                  of the preimage are RENDERED BY THE READER from the key it
//                  asked for and the surface it opened. Runs before every
//                  policy branch, so `authentic` is never a guess — and a
//                  hostile host cannot make a reader download a megabyte by
//                  serving an unsigned claim.
//   2. REGRESSION  against the reader's own proven high-water. Behind →
//                  UNKNOWN/'regressed'. Never `absent`, never an accusation.
//   3. BODY        fetch, hash-check against the SIGNED body sig, refuse-or-
//                  parse, then compare the parsed length to the signed count
//                  and the body's self-declared pubkey to `expected`.
//   4. MEMBERSHIP  one lookup, folded by `membershipOf` — over the CURRENT
//                  generation ONLY. An observation from a superseded claim is
//                  dropped, never folded: "the newest claim verified but its
//                  body has not replicated yet" is the ordinary state here,
//                  and any second door still holding an older COMPLETE claim
//                  would otherwise turn that lag into a signed-looking NO.
//
// RANK ACROSS DOORS, NEVER FIRST-WINS. `fetchHiveManifestFromAny` takes the
// first verified index, which would let one replaying door decide. Every door
// is asked CONCURRENTLY, every authentic claim is kept, and
// `resolveVocabularyClaim` picks the winner — so a replay only succeeds if
// EVERY reachable door replays the same old claim AND this reader has never
// seen newer.
//
// `fetchHiveIndex`, never `fetchHiveManifest`: the former already returns the
// four states unconflated and the latter collapses them to null.
//
// NEVER `readerPubkey()` ON A READ PATH — it mints and persists an identity on
// a miss. Search needs no key at all: verification is always against the
// CLAIMANT's key.

import {
  SignatureService,
  acceptVocabularyClaim,
  membershipOf,
  parseVocabularyBody,
  registerPoolMeaning,
  VOCABULARY_BODY_MAX_BYTES,
  resolveVocabularyClaim,
  vocabularyBodyHolds,
  type OfferedVocabularyClaim,
  type VerifiedVocabularyClaim,
  type VocabularyClaimVerifier,
  type VocabularyObservation,
} from '@hypercomb/core'
import { byDeadline } from '../link/deadline.js'
import { fetchHiveIndex, type HiveIndexResult } from '../sharing/hive-pointer.js'
import { VOCABULARY_ROOT_KEY, vocabularyRootOf } from '../sharing/hive-link.js'
import { readVocabularyEntry, verifierFor } from './vocabulary-signer.js'

/** The SURFACE — line 3 of every claim preimage, and the reserved hive-index
 *  root key. Same spelling in both places, deliberately. */
export const VOCABULARY_SURFACE_MEANING = VOCABULARY_ROOT_KEY

/** `sign('vocabulary:hive')`. Derived, never hardcoded — and deriving it
 *  REGISTERS the meaning, so a root walker can tell the address from a
 *  lineage sigbag. */
export const vocabularySurface = (): Promise<string> =>
  registerPoolMeaning(VOCABULARY_SURFACE_MEANING)

const HEX64 = /^[0-9a-f]{64}$/
const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i
/** A bare `host[:port]` — letters, digits, dots and dashes, or a bracketed
 *  IPv6 literal. No scheme, no path, no query, no userinfo. */
const AUTHORITY_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/i

// ---------------------------------------------------------------------------
// THE RESULT — no boolean anywhere, and no field whose emptiness reads as "no"
// ---------------------------------------------------------------------------

export type VocabularyVerdict = 'declared' | 'absent' | 'unknown'

/** WHY a lookup did not reach an answer. Every value is a distinct fact, and
 *  none of them is an absence. `no-claim` and `no-index` are PROVEN unknowns —
 *  the publisher signed an index that answers no vocabulary questions, or the
 *  host asserted nothing is published — which is still a different fact from
 *  "that word is not in this hive". */
export type VocabularyUnknown =
  /** No publisher key to ask with — the row could not even be attempted. */
  | 'no-key'
  /** No door answered, or the deadline passed. */
  | 'unreachable'
  /** The host ANSWERED 404: this publisher has published nothing. */
  | 'no-index'
  /** A verified index that names no vocabulary root. */
  | 'no-claim'
  /** `fetchHiveIndex` said malformed or forged — the host is serving something
   *  that is not the publisher's. */
  | 'index-unsafe'
  /** The index named a claim atom that did not arrive, or did not hash. */
  | 'claim-absent'
  /** The claim parsed but carried no valid signature by this key at this address. */
  | 'unsigned'
  /** Bytes arrived that are not a canonical v1 claim. */
  | 'malformed'
  /** The claim verified; its body atom did not arrive. */
  | 'body-absent'
  /** The body's bytes do not agree with the SIGNED body sig, count, or key. */
  | 'body-mismatch'
  /** Authentic, admits it is partial, and does not name the word. Says nothing. */
  | 'partial'
  /** Every reachable door served a claim behind one this reader already proved. */
  | 'regressed'
  /** The CURRENT generation was seen and could not be read; only a superseded
   *  one answered. Reading an old generation is not an absence and not a
   *  declaration — it is a failure to read the current one. */
  | 'superseded'

/** What one door answered. `claim` means an authentic claim with a verified
 *  body; every other value is one of the unknowns above. */
export type VocabularyDoorOutcome = 'claim' | VocabularyUnknown

export interface VocabularyDoor {
  readonly host: string
  readonly outcome: VocabularyDoorOutcome
  /** The seq this door served, when it served an authentic claim. */
  readonly seq: number | null
}

/**
 * ONE ROW PER PUBLISHER — created before any I/O, and never removed.
 *
 * The invariant `(verdict === 'unknown') === (why !== null)` holds by
 * construction: `declared`, `absent` and `unknown` are the only constructors,
 * and an `absent` additionally REQUIRES the verified claim it was derived
 * from.
 */
export type VocabularyFinding =
  | {
      readonly publisher: string
      readonly verdict: 'declared'
      readonly why: null
      readonly evidence: VerifiedVocabularyClaim
      readonly host: string | null
      readonly seq: number
      readonly complete: boolean
      readonly doors: readonly VocabularyDoor[]
    }
  | {
      readonly publisher: string
      readonly verdict: 'absent'
      readonly why: null
      /** THE PROOF. An absence cannot be constructed without it. */
      readonly evidence: VerifiedVocabularyClaim
      readonly host: string | null
      readonly seq: number
      readonly complete: boolean
      readonly doors: readonly VocabularyDoor[]
    }
  | {
      readonly publisher: string
      readonly verdict: 'unknown'
      readonly why: VocabularyUnknown
      readonly evidence: null
      readonly host: string | null
      readonly seq: number | null
      readonly complete: boolean | null
      readonly doors: readonly VocabularyDoor[]
    }

/** EXACTLY TWO FIELDS. Adding `declared: string[]` here would hand every
 *  caller a list whose emptiness means three different things. */
export interface VocabularySearch {
  /** The molecule address that was actually asked about. */
  readonly address: string
  readonly findings: readonly VocabularyFinding[]
}

/** How many rows did not reach an answer. A count, never a filtered list — a
 *  surface rendering zero results MUST be able to say "and 4 hosts did not
 *  answer", and must not be able to quietly drop them. */
export const unknownCount = (search: VocabularySearch): number =>
  search.findings.reduce((n, f) => n + (f.verdict === 'unknown' ? 1 : 0), 0)

// ---------------------------------------------------------------------------
// THE HORIZON — the routing table, assembled from what the reader already holds
// ---------------------------------------------------------------------------

export interface VocabularyPublisher {
  readonly pubkey: string
  readonly hosts: readonly string[]
}

export interface VocabularyHorizon {
  readonly publishers: readonly VocabularyPublisher[]
}

/** Fold duplicate publishers, drop relay (ws/wss) addresses — those are mesh
 *  addresses and a guaranteed miss for a content read — and keep host order. */
export const foldHorizon = (publishers: Iterable<VocabularyPublisher>): VocabularyHorizon => {
  const rows: { pubkey: string; hosts: string[] }[] = []
  const indexOf = new Map<string, number>()
  for (const p of publishers ?? []) {
    const key = String(p?.pubkey ?? '').trim().toLowerCase()
    const hosts = (p?.hosts ?? [])
      .map((h) => String(h ?? '').trim().toLowerCase())
      .filter((h) => h.length > 0 && !/^wss?:\/\//.test(h))
      .map((h) => h.replace(/^https?:\/\//, '').replace(/\/+$/, ''))
      // A HOST IS A BARE AUTHORITY, NOTHING ELSE. `contentUrl` interpolates
      // this straight into the URL, so an entry carrying a path, a query or
      // credentials (`evil.example/collect?s=`) would send the signatures this
      // reader is probing for to somewhere of the horizon-writer's choosing.
      // A dropped host is one fewer door — an UNKNOWN row, the safe direction.
      .filter((h) => AUTHORITY_RE.test(h))
    // ONLY A REAL KEY FOLDS. Two entries whose pubkey is empty, whitespace or
    // otherwise non-hex used to share one map slot, so N publishers in could
    // become fewer than N findings out — the exact shape of the defect the
    // rest of this file exists to prevent, one step upstream of the row set.
    // A malformed entry gets its OWN row and answers `no-key`.
    const foldable = HEX64.test(key)
    let at = foldable ? indexOf.get(key) : undefined
    if (at === undefined) {
      at = rows.length
      rows.push({ pubkey: key, hosts: [] })
      if (foldable) indexOf.set(key, at)
    }
    const held = rows[at] as { pubkey: string; hosts: string[] }
    for (const h of hosts) if (!held.hosts.includes(h)) held.hosts.push(h)
  }
  return { publishers: rows }
}

// ---------------------------------------------------------------------------
// DEADLINES — a slow host degrades to UNKNOWN, never to a hang and never to no
// ---------------------------------------------------------------------------

export interface VocabularyDeadlines {
  /** One index read. */
  index: number
  /** One atom fetch. */
  atom: number
  /** One publisher's whole leg. */
  publisher: number
  /** The whole search. */
  search: number
}

export const VOCABULARY_DEADLINES: VocabularyDeadlines = Object.freeze({
  index: 2_500,
  atom: 4_000,
  publisher: 8_000,
  search: 10_000,
})

/**
 * HOW MUCH LEAVES AT ONCE. The deadlines bound how long the SURFACE waits;
 * they never bounded how much one keystroke sends. Twenty visited branches
 * times four doors was eighty simultaneous outbound requests. Every door is
 * still asked — concurrently within the cap, so no single door decides — but
 * never more than this many at a time.
 */
export const VOCABULARY_FANOUT = 8

type Gate = <T>(work: () => Promise<T>) => Promise<T>

/** A counting semaphore. Order of admission is FIFO. */
const semaphore = (limit: number): Gate => {
  let active = 0
  const waiting: (() => void)[] = []
  const release = (): void => {
    active -= 1
    waiting.shift()?.()
  }
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    active += 1
    try { return await work() } finally { release() }
  }
}

// ---------------------------------------------------------------------------
// DEPENDENCIES — every one of them injectable, so a spec never touches a socket
// ---------------------------------------------------------------------------

export type VocabularyAtomRead =
  | { ok: true; text: string }
  | { ok: false; reason: 'absent' | 'mismatch' }

export interface VocabularySearchDeps {
  /** `sign('vocabulary:hive')`, rendered by the READER. */
  readonly surface: string
  readonly readIndex?: (host: string, pubkey: string, signal?: AbortSignal) => Promise<HiveIndexResult>
  readonly readAtom?: (host: string, sig: string, signal?: AbortSignal) => Promise<VocabularyAtomRead>
  readonly readClaim?: (text: string) => { offered: OfferedVocabularyClaim; event: Record<string, unknown> } | null
  readonly verifierFor?: (event: Record<string, unknown>) => VocabularyClaimVerifier
  /** The highest seq this reader has already PROVEN for a publisher. */
  readonly provenSeq?: (pubkey: string) => number | undefined
  readonly rememberSeq?: (pubkey: string, seq: number) => void | Promise<void>
  readonly deadlines?: Partial<VocabularyDeadlines>
}

/** `https://<host>/<sig>` — the ONE shape every host kind serves. Loopback
 *  gets plain http, the same rule `hiveIndexUrl` uses. */
export const contentUrl = (host: string, sig: string): string => {
  const bare = String(host ?? '')
    .replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
  return `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}/${sig}`
}

/** Fetch an atom and CHECK THE BYTES AGAINST THEIR OWN ADDRESS before
 *  believing them. A mismatch is the HOST being wrong, not the hive. */
const defaultReadAtom = async (
  host: string,
  sig: string,
  signal?: AbortSignal,
): Promise<VocabularyAtomRead> => {
  let res: Response
  try { res = await fetch(contentUrl(host, sig), { cache: 'no-store', signal }) }
  catch { return { ok: false, reason: 'absent' } }
  if (!res.ok) return { ok: false, reason: 'absent' }
  // BOUNDED BEFORE THE BYTES ARE READ. The hash check is the belief gate, but
  // it runs AFTER the download, so without this a hostile host could make a
  // reader hold an arbitrary buffer for the whole atom deadline. Neither atom
  // this reader fetches can legitimately exceed the body cap.
  const declaredLength = Number(res.headers?.get?.('content-length') ?? NaN)
  if (Number.isFinite(declaredLength) && declaredLength > VOCABULARY_BODY_MAX_BYTES) {
    return { ok: false, reason: 'mismatch' }
  }
  let bytes: ArrayBuffer
  try { bytes = await res.arrayBuffer() } catch { return { ok: false, reason: 'absent' } }
  if (bytes.byteLength > VOCABULARY_BODY_MAX_BYTES) return { ok: false, reason: 'mismatch' }
  let actual: string
  try { actual = await SignatureService.sign(bytes) } catch { return { ok: false, reason: 'mismatch' } }
  if (actual.toLowerCase() !== sig.toLowerCase()) return { ok: false, reason: 'mismatch' }
  try { return { ok: true, text: new TextDecoder().decode(bytes) } }
  catch { return { ok: false, reason: 'mismatch' } }
}

// ---------------------------------------------------------------------------
// THE THREE CONSTRUCTORS — the only ways a finding is ever built
// ---------------------------------------------------------------------------

const declared = (
  publisher: string,
  evidence: VerifiedVocabularyClaim,
  host: string | null,
  doors: readonly VocabularyDoor[],
): VocabularyFinding => ({
  publisher, verdict: 'declared', why: null, evidence, host,
  seq: evidence.seq, complete: evidence.complete, doors,
})

/**
 * THE ONLY PLACE A "NO" IS BUILT, and it takes the proof as an argument — AND
 * the highest authentic seq this reader saw, so an absence derived from a
 * SUPERSEDED generation is unrepresentable rather than merely avoided. If the
 * evidence is not the current generation the reader does not know: it read an
 * old claim and failed to read the new one.
 */
const absent = (
  publisher: string,
  evidence: VerifiedVocabularyClaim,
  current: number,
  host: string | null,
  doors: readonly VocabularyDoor[],
): VocabularyFinding =>
  evidence.seq !== current
    ? unknown(publisher, 'superseded', doors, { host, seq: evidence.seq, complete: evidence.complete })
    : {
        publisher, verdict: 'absent', why: null, evidence, host,
        seq: evidence.seq, complete: evidence.complete, doors,
      }

const unknown = (
  publisher: string,
  why: VocabularyUnknown,
  doors: readonly VocabularyDoor[],
  known: { host?: string | null; seq?: number | null; complete?: boolean | null } = {},
): VocabularyFinding => ({
  publisher, verdict: 'unknown', why, evidence: null,
  host: known.host ?? null, seq: known.seq ?? null, complete: known.complete ?? null, doors,
})

/** WHICH not-knowing to report when several doors failed differently. Most
 *  informative first: a host serving something that will not verify is the
 *  alarming fact, and an unreachable host is the least informative of all. */
const WHY_ORDER: readonly VocabularyUnknown[] = [
  'unsigned', 'body-mismatch', 'malformed', 'superseded', 'body-absent', 'claim-absent',
  'index-unsafe', 'partial', 'no-claim', 'no-index', 'unreachable', 'no-key', 'regressed',
]

const worstOf = (outcomes: readonly VocabularyDoorOutcome[]): VocabularyUnknown => {
  for (const why of WHY_ORDER) if (outcomes.includes(why)) return why
  return 'unreachable'
}

// ---------------------------------------------------------------------------
// ONE DOOR
// ---------------------------------------------------------------------------

interface DoorAnswer {
  readonly door: VocabularyDoor
  readonly claim: VerifiedVocabularyClaim | null
  readonly observation: VocabularyObservation | null
}

const askDoor = async (
  address: string,
  pubkey: string,
  host: string,
  deps: VocabularySearchDeps,
  deadlines: VocabularyDeadlines,
): Promise<DoorAnswer> => {
  const readIndex = deps.readIndex ?? fetchHiveIndex
  const readAtom = deps.readAtom ?? defaultReadAtom
  const readClaim = deps.readClaim ?? readVocabularyEntry
  const verify = deps.verifierFor ?? verifierFor

  const miss = (outcome: VocabularyUnknown, seq: number | null = null): DoorAnswer =>
    ({ door: { host, outcome, seq }, claim: null, observation: null })

  const index = await byDeadline<HiveIndexResult>(
    (signal) => readIndex(host, pubkey, signal),
    deadlines.index,
    { ok: false, reason: 'unreachable' },
  )
  if (!index.ok) {
    if (index.reason === 'unreachable') return miss('unreachable')
    if (index.reason === 'http') return miss('no-index')
    return miss('index-unsafe')
  }

  const claimSig = vocabularyRootOf(index.manifest.roots)
  if (!claimSig) return miss('no-claim')

  const entry = await byDeadline<VocabularyAtomRead>(
    (signal) => readAtom(host, claimSig, signal),
    deadlines.atom,
    { ok: false, reason: 'absent' },
  )
  if (!entry.ok) return miss('claim-absent')

  const read = readClaim(entry.text)
  if (!read) return miss('malformed')

  // SIGNATURE FIRST, AND IT IS ALSO THE PLACEMENT CHECK. `pubkey` and
  // `deps.surface` are the address the READER asked for; nothing offered by
  // the bytes chooses either.
  const verdict = await acceptVocabularyClaim(
    { pubkey, surface: deps.surface },
    read.offered,
    verify(read.event),
  )
  if (!verdict.authentic) return miss(verdict.reason === 'malformed' ? 'malformed' : 'unsigned')
  const claim = verdict.claim

  const body = await byDeadline<VocabularyAtomRead>(
    (signal) => readAtom(host, claim.body, signal),
    deadlines.atom,
    { ok: false, reason: 'absent' },
  )
  if (!body.ok) {
    return {
      door: { host, outcome: body.reason === 'mismatch' ? 'body-mismatch' : 'body-absent', seq: claim.seq },
      claim,
      observation: null,
    }
  }

  const parsed = parseVocabularyBody(body.text)
  // The body's self-declared pubkey is COMPARED, never trusted; the parsed
  // length must equal the SIGNED count. Both are belt-and-braces on top of
  // the body sig, and both cost one comparison.
  if (!parsed || parsed.pubkey !== pubkey || parsed.words.length !== claim.count) {
    return { door: { host, outcome: 'body-mismatch', seq: claim.seq }, claim, observation: null }
  }

  return {
    door: { host, outcome: 'claim', seq: claim.seq },
    claim,
    observation: {
      seq: claim.seq,
      complete: claim.complete,
      present: vocabularyBodyHolds(parsed, address),
    },
  }
}

// ---------------------------------------------------------------------------
// ONE PUBLISHER
// ---------------------------------------------------------------------------

const askPublisher = async (
  address: string,
  publisher: VocabularyPublisher,
  deps: VocabularySearchDeps,
  deadlines: VocabularyDeadlines,
  gate: Gate,
): Promise<VocabularyFinding> => {
  const pubkey = publisher.pubkey
  const hosts = publisher.hosts

  // A row that cannot even be ATTEMPTED is still a row. Dropping it is the
  // same defect as dropping an unreachable host, one step earlier.
  if (!HEX64.test(pubkey)) return unknown(pubkey, 'no-key', [])
  if (hosts.length === 0) return unknown(pubkey, 'unreachable', [])

  // EVERY DOOR, CONCURRENTLY — within the fan-out cap. Sequential probing
  // multiplies a stall, and first-wins would let one replaying door decide;
  // the gate bounds how much is in flight, not which doors are asked.
  const answers = await Promise.all(
    hosts.map((host) =>
      gate(() => askDoor(address, pubkey, host, deps, deadlines))
        .catch((): DoorAnswer => ({ door: { host, outcome: 'unreachable', seq: null }, claim: null, observation: null })),
    ),
  )
  const doors = answers.map((a) => a.door)
  const outcomes = doors.map((d) => d.outcome)

  const claims = answers.map((a) => a.claim).filter((c): c is VerifiedVocabularyClaim => !!c)
  const winner = resolveVocabularyClaim(claims)
  if (!winner) return unknown(pubkey, worstOf(outcomes), doors)

  const winnerHost = answers.find((a) => a.claim === winner)?.door.host ?? null

  // REGRESSION, on the publisher's own signed counter. Behind is UNKNOWN and
  // never absence — and the losing claims are kept, never discarded.
  const proven = deps.provenSeq?.(pubkey)
  if (typeof proven === 'number' && Number.isFinite(proven) && winner.seq < proven) {
    return unknown(pubkey, 'regressed', doors, {
      host: winnerHost, seq: winner.seq, complete: winner.complete,
    })
  }
  try { await deps.rememberSeq?.(pubkey, winner.seq) } catch { /* a memory, never a gate */ }

  // ═══════════════════════════════════════════════════════════════════════
  // ONLY THE CURRENT GENERATION SPEAKS.
  // ═══════════════════════════════════════════════════════════════════════
  // `winner` is the highest AUTHENTIC claim any door served. Folding an
  // observation from a lower generation is how a stale door mints a
  // signed-looking NO for a word the publisher's current claim declares — and
  // "the current claim verified, its body has not replicated yet" is the
  // ordinary state of this architecture, not an attack. The mirror case is a
  // withdrawal defeated by withholding one atom. So the fold sees ONLY
  // `winner.seq`, and a generation nobody could read is UNKNOWN.
  const current = answers.filter((a) => a.observation && a.observation.seq === winner.seq)
  const observations = current
    .map((a) => a.observation)
    .filter((o): o is VocabularyObservation => !!o)

  /** Why the CURRENT generation did not answer — read off the doors that
   *  served it, never off a superseded door's outcome. */
  const currentWhy = (): VocabularyUnknown => {
    const served = doors.filter((d) => d.seq === winner.seq).map((d) => d.outcome)
    return served.length > 0 ? worstOf(served) : worstOf(outcomes)
  }

  switch (membershipOf(observations, winner.seq)) {
    case 'declared': {
      const naming = resolveVocabularyClaim(
        current.filter((a) => a.observation?.present).map((a) => a.claim!).filter(Boolean),
      ) ?? winner
      const host = answers.find((a) => a.claim === naming)?.door.host ?? winnerHost
      return declared(pubkey, naming, host, doors)
    }
    case 'absent': {
      // The evidence is the COMPLETE CURRENT claim that omits the word — the
      // only shape from which core will mint an absence.
      const omitting = resolveVocabularyClaim(
        current
          .filter((a) => a.observation && a.observation.complete && !a.observation.present)
          .map((a) => a.claim!)
          .filter(Boolean),
      )
      if (!omitting) return unknown(pubkey, currentWhy(), doors)
      const host = answers.find((a) => a.claim === omitting)?.door.host ?? winnerHost
      return absent(pubkey, omitting, winner.seq, host, doors)
    }
    default:
      // Authentic, and it still did not answer: the current claim admits it is
      // partial, or its body never arrived, or only a superseded generation
      // could be read at all.
      return unknown(
        pubkey,
        observations.length > 0 ? 'partial' : currentWhy(),
        doors,
        { host: winnerHost, seq: winner.seq, complete: winner.complete },
      )
  }
}

// ---------------------------------------------------------------------------
// THE SEARCH
// ---------------------------------------------------------------------------

/**
 * ASK THE HOSTS THAT MIGHT DECLARE THE WORD.
 *
 * `address` is a 64-HEX MOLECULE ADDRESS, not a word — the caller derives it
 * with `moleculeIndexReader().addressOf(word)`, which already swallows
 * `moleculeAddress('')`'s RangeError to null. One responsibility each. A
 * malformed address does NOT return an empty list: it returns one
 * `unknown/'malformed'` finding per publisher, so even a caller bug fails
 * toward UNKNOWN and never toward absence.
 */
export const searchVocabulary = async (
  address: string,
  horizon: VocabularyHorizon,
  deps: VocabularySearchDeps,
): Promise<VocabularySearch> => {
  const deadlines: VocabularyDeadlines = { ...VOCABULARY_DEADLINES, ...(deps.deadlines ?? {}) }
  const folded = foldHorizon(horizon?.publishers ?? [])
  const asked = String(address ?? '').trim().toLowerCase()

  // ── THE ROW SET, FIXED BEFORE ANY I/O ──────────────────────────────────
  // Prefilled with the least informative unknown. Every leg can only REPLACE
  // a row; nothing anywhere can remove one.
  const rows: VocabularyFinding[] = folded.publishers.map((p) =>
    unknown(p.pubkey, 'unreachable', p.hosts.map((host) => ({ host, outcome: 'unreachable' as const, seq: null }))),
  )
  if (rows.length === 0) return { address: asked, findings: [] }

  if (!HEX64.test(asked) || !HEX64.test(String(deps?.surface ?? ''))) {
    return {
      address: asked,
      findings: rows.map((r) => unknown(r.publisher, 'malformed', r.doors)),
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlines.search) })
  // One gate per search: the cap is on what THIS keystroke sends.
  const gate = semaphore(VOCABULARY_FANOUT)
  try {
    const legs = folded.publishers.map((p, i) =>
      byDeadline(
        () => askPublisher(asked, p, deps, deadlines, gate),
        deadlines.publisher,
        rows[i] as VocabularyFinding,
      )
        .then((finding) => { rows[i] = finding })
        .catch(() => { /* the prefilled unknown stands */ }),
    )
    await Promise.race([Promise.all(legs), expiry])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  // A COPY. A leg that outran the search deadline is still running, and it
  // must not be able to mutate an answer the caller is already reading.
  return { address: asked, findings: [...rows] }
}

// core/vocabulary-claim.ts
//
// THE SIGNED VOCABULARY CLAIM — what words a participant says they hold.
//
// `molecule/molecule-index.ts` states the gap plainly: "NOTHING is ever placed
// AT a molecule address. Placement is a publish act; this is only the
// declaration." A hive can therefore DERIVE which words it holds and nothing
// else can see it. Cross-host search — say a word, hash it, ask your hosts —
// is not reachable.
//
// IT IS CLOSED WITH A PUBLISH, NEVER BY SERVING THE DERIVED CACHE. The index
// record lives in `sign('molecule:index')`, which is declared `index` kind:
// recomputable, wipe-safe, GC-able. Serving it would make search rest on
// something nobody may depend on, and — worse — it would destroy HONEST
// ABSENCE: an empty answer would mean either "nobody said anything" or "that
// host has not recomputed yet", and those two must never be confusable. A
// signed claim is a statement the publisher MADE; a wiped cache is a statement
// nobody made. Only the first can ever license the word "no".
//
// ─── WHAT IS SIGNED, AND WHY EACH LINE ─────────────────────────────────────
//
// Eight lines, joined by `\n`, no trailing newline. Every field is lowercase
// hex, `-`, or digits, so no field can contain the delimiter and no escaping
// rule can ever be needed — `headClaimPreimage`'s argument restated, not
// re-derived.
//
//     hc:molecule-vocabulary:v1
//     <pubkey>      64 hex   the key the reader ASKED FOR, and the verifying key
//     <surface>     64 hex   the door the reader OPENED (sign('vocabulary:hive'))
//     <body>        64 hex   sha256 of the canonical vocabulary atom
//     <prev | "-">  64 hex   the previous claim's body sig, or "-" at genesis
//     <seq>         digits   the ONLY recency axis
//     <count>       digits   how many addresses the body holds
//     <complete>    1 | 0    1 iff the publisher's own picture was whole
//
// Line 1 is domain separation. The same key already signs kind-30564 hive
// indexes, kind-27235 NIP-98 headers and kind-30565 head claims; a harvested
// signature from any of them renders a different string here. `:v1` lets a
// `:v2` exist while this verifier REFUSES rather than mis-parses.
//
// Lines 2 and 3 are THE ADDRESS THE READER ASKED FOR, rendered by the reader
// and never parsed out of the bytes — `head-claim.ts`'s rule one level up.
// A genuine claim by A, served when the reader asked for B, renders a string
// that never verifies. There is no `declared === askedFor` comparison for a
// refactor to delete, because nothing is declared. Line 3 buys nothing today
// (there is exactly one surface); it is the namespace hinge that lets a second
// surface exist later, and adding a line afterwards would change every
// signature ever minted. One line now, or a migration later.
//
// Line 4 defeats a PADDED word list and a TRUNCATED one with one field. The
// preimage's fixed alphabet forbids embedding a variable list, so the claim
// commits to `sha256(bodyBytes)`. Add a word, drop a word, reorder the array,
// change one hex digit — the body no longer hashes to line 4. A host can
// WITHHOLD the body; it can never edit it under a valid signature.
//
// Line 5 puts the chain link inside the signature so a genuine claim cannot be
// re-parented. Line 6 defeats a REPLAYED old claim: `seq`, not a clock — it
// needs no clock to be right, cannot be raised without the secret, and a
// mis-clocked device can never set a permanent freshness floor against its own
// bucket. A schnorr signature proves authorship and NEVER recency.
//
// Line 7's only unique job is bounding the fetch BEFORE it starts; once line 4
// is checked it is redundant, and it is duplicated on purpose (the same note
// `head-map.ts` puts on `refs`). Line 8 is what makes an absence mintable at
// all — see `membershipOf`.
//
// ─── WHAT IS DELIBERATELY ABSENT FROM THE BODY ─────────────────────────────
//
// `MoleculeWord` is `{a, n, c}`. The body carries only `a`. Three reasons, all
// hostile-host:
//
//   (a) `n` is attacker-chosen TEXT that a reader would render next to a word.
//       The reader already has the word it typed and never needs a stranger's
//       spelling. Dropping it means this surface cannot inject a single
//       non-hex byte into a reader's UI.
//   (b) `c` is ranking data, and `molecule-index.ts` already says nothing may
//       branch on it. A signed count from a stranger is a sybil-weighting
//       lever aimed straight at a routing table.
//   (c) with only hex in the array the fixed-literal encoding needs no
//       escaping at all — the same argument the preimage makes one level down.
//
// A body is also ENTIRELY molecule addresses, which are directory addresses
// with no bytes behind them. `words` must therefore never be registered in
// `core/edge-registry.ts`: a closure walker descending them is a permanent 404
// cascade (`head-map.ts` records the hazard for a far shorter list).
//
// CORE IMPORTS NOTHING and carries no asymmetric primitive, so the verifier
// arrives as a PARAMETER. It takes a STRING, not bytes, because a NIP-07
// extension signs a nostr event whose `content` is a string; the adapter must
// assert the event's declared pubkey equals the bucket AND its content equals
// the rebuilt preimage BEFORE any curve maths.

/** A 64-hex lowercase address: a public key, a pool address, or an atom. */
const HEX64 = /^[0-9a-f]{64}$/

/** Domain + version tag. Line one of every preimage. */
export const VOCABULARY_CLAIM_V1 = 'hc:molecule-vocabulary:v1'

/** The genesis marker in the `prev` line. A hex address can never equal it. */
export const VOCABULARY_GENESIS = '-'

/** The body record's `kind` literal. */
export const VOCABULARY_BODY_KIND = 'hypercomb.vocabulary'

/** The body record's schema version. */
export const VOCABULARY_BODY_V1 = 1

/** How many addresses one claim may carry. Matches `MAX_RECORD_WORDS` so a
 *  whole index record fits in one claim; past it the publisher signs
 *  `complete: false` with the first N in ascending address order — which is
 *  deterministic, and harmless because no absence is mintable from an
 *  incomplete claim. */
export const MAX_CLAIM_WORDS = 8000

/**
 * THE HIGHEST COUNTER A CLAIM MAY CARRY.
 *
 * `seq` had only `Number.isSafeInteger` under it, and `seq` is the one field a
 * publisher rebuilds FROM A HOST (`planVocabularyClaim`'s `held`). A host that
 * serves `MAX_SAFE_INTEGER - 1` therefore gets the participant to sign
 * `MAX_SAFE_INTEGER`, which is written to the permanent local ledger — and
 * every later plan is then `MAX_SAFE_INTEGER + 1`, which the reader's own
 * shape gate refuses. One lie, and that device can never publish again.
 *
 * A billion publishes by one key is already absurd; past the cap the value is
 * not a counter, it is an attack, and both the parser and the planner refuse
 * it. `count` has had a cap since the first line of this file for the same
 * reason — a bound must never be a stranger's generosity.
 */
export const MAX_CLAIM_SEQ = 1_000_000_000

/** The largest body a reader will even attempt to parse. `head-map.ts` caps
 *  its own input for the same reason: a reader's parse cost must be bounded by
 *  something other than a stranger's generosity. */
export const VOCABULARY_BODY_MAX_BYTES = 1 << 20

/**
 * THE ADDRESS A READER ASKED FOR. Both fields come from the reader's own walk
 * — the key it routed to, and the surface it opened. NEVER from bytes.
 */
export interface VocabularyClaimAddress {
  /** 64-hex lowercase: the publisher's key, AND the verifying key. */
  readonly pubkey: string
  /** 64-hex lowercase: `sign('vocabulary:hive')`, the door that was opened. */
  readonly surface: string
}

/**
 * What one claim offers.
 *
 * NOTE WHAT IS ABSENT: no `pubkey`, no `surface`. A claim does not declare its
 * own location, because location is not a property of bytes.
 */
export interface OfferedVocabularyClaim {
  /** 64-hex: sha256 of the canonical body atom. */
  readonly body: string
  /** 64-hex predecessor body sig, or `null` for genesis. */
  readonly prev: string | null
  /** Monotone per-publisher counter. 0 iff `prev` is null. Never a clock. */
  readonly seq: number
  /** How many addresses the body holds. Bounds the fetch before it starts. */
  readonly count: number
  /** Was the publisher's own picture whole when this was signed? */
  readonly complete: boolean
  /** The detached signature over the preimage (hex; length is the verifier's business). */
  readonly sig: string
}

/** A claim whose signature has been checked against the address asked for. */
export interface VerifiedVocabularyClaim {
  readonly pubkey: string
  readonly surface: string
  readonly body: string
  readonly prev: string | null
  readonly seq: number
  readonly count: number
  readonly complete: boolean
}

/**
 * THE INJECTED VERIFIER. Returns true ONLY if `pubkeyHex` signed EXACTLY
 * `preimage` producing `sigHex`. It must not parse the preimage, must not
 * accept a prefix, and must not trust any identity carried inside `sigHex`'s
 * envelope without comparing it to `pubkeyHex`.
 */
export type VocabularyClaimVerifier = (
  pubkeyHex: string,
  preimage: string,
  sigHex: string,
) => boolean | Promise<boolean>

/** Why a claim is not this publisher's declaration at this address. */
export type VocabularyClaimRefusal =
  /** Shape: a field is not the alphabet it must be. */
  | 'malformed'
  /** No valid signature by this key over THIS address's preimage. */
  | 'unsigned'

/**
 * TWO BITS, NOT FIVE — and the exposed one is `authentic`.
 *
 * `ok` answers a question about a TRANSITION ("may this become what I hold
 * RIGHT NOW"), and it has no meaning when re-reading something already
 * published. `head-map.ts` makes exactly this argument for why `verifyHeadMap`
 * reads `authentic` and never `ok`. There is no bucket to converge here and
 * nothing of a stranger's is stored, so `keep` is not needed either.
 *
 * RECENCY IS A SEPARATE PURE CALL. Folding it in here is precisely how "I gave
 * up looking" becomes "no": a stale-but-genuine claim would stop being
 * authentic, the reader would discard it, and a host would once again get to
 * pin a reader to whichever generation it chose to answer with.
 */
export type VocabularyClaimVerdict =
  | { readonly authentic: true; readonly claim: VerifiedVocabularyClaim }
  | { readonly authentic: false; readonly reason: VocabularyClaimRefusal; readonly detail?: string }

const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v)

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** A counter, bounded. See `MAX_CLAIM_SEQ`: an unbounded `seq` is a one-shot,
 *  unrecoverable publish DoS that any host can fire. */
const isSeq = (v: unknown): v is number => isCount(v) && v <= MAX_CLAIM_SEQ

// ---------------------------------------------------------------------------
// THE PREIMAGE
// ---------------------------------------------------------------------------

/**
 * THE EXACT BYTES THAT GET SIGNED. Eight lines, joined by `\n`, no trailing
 * newline. See the header for what each line defeats.
 *
 * Deliberately NOT canonical JSON: the string must survive verbatim inside a
 * nostr event's `content`, and a serializer both sides must agree on
 * byte-for-byte is a second thing to get wrong.
 */
export const vocabularyClaimPreimage = (
  pubkey: string,
  surface: string,
  body: string,
  prev: string | null,
  seq: number,
  count: number,
  complete: boolean,
): string =>
  [
    VOCABULARY_CLAIM_V1,
    pubkey,
    surface,
    body,
    prev ?? VOCABULARY_GENESIS,
    String(seq),
    String(count),
    complete ? '1' : '0',
  ].join('\n')

/**
 * Split a preimage back into its parts. Returns null unless the string is
 * EXACTLY the canonical v1 form — a trailing newline, a wrong field alphabet,
 * a leading zero in `seq`, a `complete` spelled `true`, or a `:v2` tag all
 * refuse rather than mis-parse.
 *
 * This exists for the TRANSPORT, for DIAGNOSTICS, and as THE SHAPE GATE THE
 * MINT PATH OWES: a writer that can sign bytes no reader can parse is a
 * strictly weaker gate than the reader, and under new-before-old publishing it
 * would retire a live claim in favour of one nobody can read.
 */
export const parseVocabularyClaimPreimage = (
  content: string,
): {
  pubkey: string
  surface: string
  body: string
  prev: string | null
  seq: number
  count: number
  complete: boolean
} | null => {
  if (typeof content !== 'string') return null
  const lines = content.split('\n')
  if (lines.length !== 8) return null
  const [tag, pubkey, surface, body, prev, seq, count, complete] = lines as [
    string, string, string, string, string, string, string, string,
  ]
  if (tag !== VOCABULARY_CLAIM_V1) return null
  if (!isHex64(pubkey) || !isHex64(surface) || !isHex64(body)) return null
  if (prev !== VOCABULARY_GENESIS && !isHex64(prev)) return null
  if (!/^(0|[1-9][0-9]*)$/.test(seq)) return null
  if (!/^(0|[1-9][0-9]*)$/.test(count)) return null
  if (complete !== '1' && complete !== '0') return null
  const n = Number(seq)
  const c = Number(count)
  if (!isSeq(n) || !isCount(c)) return null
  if (c > MAX_CLAIM_WORDS) return null
  // Genesis is exactly seq 0, and seq 0 is exactly genesis. Anything else is a
  // claim whose counter and chain link disagree — refuse rather than choose.
  if ((prev === VOCABULARY_GENESIS) !== (n === 0)) return null
  return {
    pubkey,
    surface,
    body,
    prev: prev === VOCABULARY_GENESIS ? null : prev,
    seq: n,
    count: c,
    complete: complete === '1',
  }
}

// ---------------------------------------------------------------------------
// THE BODY ATOM
// ---------------------------------------------------------------------------

export interface VocabularyBodyRecord {
  readonly kind: typeof VOCABULARY_BODY_KIND
  readonly v: typeof VOCABULARY_BODY_V1
  /** Self-declared, and COMPARED against `expected` — never trusted. */
  readonly pubkey: string
  /** Molecule addresses, deduped and sorted ascending. */
  readonly words: readonly string[]
}

/**
 * THE CANONICAL REPRESENTATIVE OF A SET. Dedupes and sorts ascending; every
 * token is fixed-width lowercase hex, so codepoint order IS byte order, the
 * order is TOTAL, and there is no locale, collation or tie-break left to
 * specify. `molecule-index.ts` already sorts its words by address, so the
 * input is canonical-ready.
 *
 * Returns null on any malformed input rather than repairing it.
 */
export const canonicalVocabularyBody = (
  pubkey: string,
  words: Iterable<string>,
): VocabularyBodyRecord | null => {
  if (!isHex64(pubkey)) return null
  const set = new Set<string>()
  for (const word of words ?? []) {
    if (!isHex64(word)) return null
    set.add(word)
  }
  if (set.size > MAX_CLAIM_WORDS) return null
  return {
    kind: VOCABULARY_BODY_KIND,
    v: VOCABULARY_BODY_V1,
    pubkey,
    words: [...set].sort(),
  }
}

/**
 * THE EXACT BYTES. Four fields in a FIXED LITERAL ORDER, composed from arrays
 * only, so nothing anywhere depends on a serializer's property-order rule:
 *
 *   {"kind":"hypercomb.vocabulary","v":1,"pubkey":"<64hex>","words":["<64hex>",…]}
 *
 * THROWS on a non-canonical record. A writer that can emit bytes no reader will
 * parse is a strictly weaker gate than the reader. Mint through
 * `canonicalVocabularyBody` and this never throws.
 */
export const encodeVocabularyBody = (record: VocabularyBodyRecord): string => {
  const rebuilt = record && record.kind === VOCABULARY_BODY_KIND && record.v === VOCABULARY_BODY_V1
    ? canonicalVocabularyBody(record.pubkey, record.words ?? [])
    : null
  if (!rebuilt) throw new TypeError('vocabulary body: not a canonical hypercomb.vocabulary v1 record')
  const words = record.words ?? []
  if (rebuilt.words.length !== words.length) {
    throw new TypeError('vocabulary body: words carry a duplicate address')
  }
  for (let i = 0; i < rebuilt.words.length; i++) {
    if (rebuilt.words[i] !== words[i]) throw new TypeError('vocabulary body: words are not sorted ascending')
  }
  const wordBytes = rebuilt.words.map((w) => `"${w}"`).join(',')
  return `{"kind":"${VOCABULARY_BODY_KIND}","v":${VOCABULARY_BODY_V1},` +
    `"pubkey":"${rebuilt.pubkey}","words":[${wordBytes}]}`
}

/**
 * REFUSE-OR-PARSE. The record is rebuilt canonically and the result must encode
 * back to the bytes that arrived, so a second spelling of one set cannot exist
 * — reordered words, a duplicate, added whitespace, an unknown field or a
 * `v: 2` all REFUSE rather than mis-read. Two encodings of one set would be two
 * body signatures for one vocabulary.
 */
export const parseVocabularyBody = (text: string): VocabularyBodyRecord | null => {
  if (typeof text !== 'string' || text.length > VOCABULARY_BODY_MAX_BYTES) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj['kind'] !== VOCABULARY_BODY_KIND || obj['v'] !== VOCABULARY_BODY_V1) return null
  if (!Array.isArray(obj['words'])) return null
  const words: string[] = []
  for (const word of obj['words'] as unknown[]) {
    if (!isHex64(word)) return null
    words.push(word)
  }
  const rebuilt = canonicalVocabularyBody(obj['pubkey'] as string, words)
  if (!rebuilt) return null
  if (rebuilt.words.length !== words.length) return null
  let encoded: string
  try {
    encoded = encodeVocabularyBody(rebuilt)
  } catch {
    return null
  }
  return encoded === text ? rebuilt : null
}

/** Does this body hold that molecule address? One Set-free scan, because the
 *  array is already sorted and a caller usually asks once. */
export const vocabularyBodyHolds = (record: VocabularyBodyRecord, address: string): boolean => {
  if (!record || !Array.isArray(record.words) || !isHex64(address)) return false
  return record.words.includes(address)
}

// ---------------------------------------------------------------------------
// ACCEPTANCE
// ---------------------------------------------------------------------------

/**
 * THE ONE DOOR. `address` is argument one and has no default: a caller cannot
 * ask "is this claim good?" without saying where it came from.
 *
 * Order is shape, then crypto ONCE — and nothing else. There is no policy
 * branch here at all, because every policy question about a vocabulary claim
 * (is it the newest? does it name the word?) is answered by a separate pure
 * function over a SET of authentic claims, and folding any of them in here
 * would make an authentic-but-stale claim indistinguishable from a forged one.
 *
 * Because the signature runs before anything else, a hostile host cannot make
 * a reader download a megabyte by serving an unsigned claim: junk costs one
 * verify and stops.
 */
export const acceptVocabularyClaim = async (
  address: VocabularyClaimAddress,
  offered: OfferedVocabularyClaim,
  verify: VocabularyClaimVerifier,
): Promise<VocabularyClaimVerdict> => {
  const malformed = (detail: string): VocabularyClaimVerdict =>
    ({ authentic: false, reason: 'malformed', detail })

  // ── SHAPE ───────────────────────────────────────────────────────────────
  // Compared, never rewritten. A host may serve an uppercase-hex name; if we
  // lowercased it here we would verify one address and believe another.
  if (!address || !isHex64(address.pubkey) || !isHex64(address.surface)) {
    return malformed('address is not two lowercase 64-hex names')
  }
  if (!offered || !isHex64(offered.body)) {
    return malformed('body is not a lowercase 64-hex signature')
  }
  if (offered.prev !== null && !isHex64(offered.prev)) {
    return malformed('prev is neither null nor a lowercase 64-hex signature')
  }
  if (!isSeq(offered.seq)) return malformed('seq is not a bounded non-negative integer')
  if ((offered.prev === null) !== (offered.seq === 0)) {
    return malformed('seq 0 and genesis must agree')
  }
  if (!isCount(offered.count)) return malformed('count is not a non-negative safe integer')
  if (offered.count > MAX_CLAIM_WORDS) return malformed('count exceeds MAX_CLAIM_WORDS')
  if (typeof offered.complete !== 'boolean') return malformed('complete is not a boolean')
  if (typeof offered.sig !== 'string' || !/^[0-9a-f]{2,512}$/.test(offered.sig)) {
    return malformed('sig is not lowercase hex')
  }

  // ── SIGNATURE (and, by construction, PLACEMENT) ─────────────────────────
  // Note every argument: the key is `address.pubkey`, and the preimage's
  // pubkey and surface are `address.*`. Nothing offered by the bytes chooses
  // either, so a claim minted for another key or another surface renders a
  // string this call never sees.
  const preimage = vocabularyClaimPreimage(
    address.pubkey,
    address.surface,
    offered.body,
    offered.prev,
    offered.seq,
    offered.count,
    offered.complete,
  )
  let signed = false
  try {
    signed = (await verify(address.pubkey, preimage, offered.sig)) === true
  } catch {
    signed = false
  }
  if (!signed) {
    return {
      authentic: false,
      reason: 'unsigned',
      detail: 'no valid signature by this key over this address',
    }
  }

  return {
    authentic: true,
    claim: {
      pubkey: address.pubkey,
      surface: address.surface,
      body: offered.body,
      prev: offered.prev,
      seq: offered.seq,
      count: offered.count,
      complete: offered.complete,
    },
  }
}

// ---------------------------------------------------------------------------
// RECENCY — separate, pure, and never folded into acceptance
// ---------------------------------------------------------------------------

/**
 * WHICH OF A PUBLISHER'S CLAIMS IS THE CURRENT ONE.
 *
 * Highest `seq` wins, ties broken by the lexicographically smallest body
 * signature. That order is total, deterministic and reader-derived, so every
 * reader on every host converges — and a reader that has once seen generation
 * 69 can never be talked back down to generation 0 by a host that serves only
 * the latter.
 *
 * THE LOSER IS NEVER DISCARDED by a caller: discarding stale-but-authentic
 * claims is exactly what let a host pin a reader to whichever generation it
 * chose to answer with.
 */
export const resolveVocabularyClaim = <T extends { readonly body: string; readonly seq: number }>(
  claims: readonly T[],
): T | null => {
  let best: T | null = null
  for (const c of claims ?? []) {
    if (!c || !isHex64(c.body) || !isCount(c.seq)) continue
    if (!best) { best = c; continue }
    if (c.seq > best.seq) { best = c; continue }
    if (c.seq === best.seq && c.body < best.body) best = c
  }
  return best
}

/**
 * WHERE A REPLAY IS CAUGHT — on the author's own signed counter, never on a
 * clock and never on a property the reader assumes.
 *
 * A reader that remembers the highest seq it has PROVEN for a publisher
 * detects a replayed older claim exactly: an offer whose seq went BACKWARDS
 * under the same key. Returns the publishers that regressed; empty means the
 * offer is consistent with everything already proven.
 */
export const vocabularyRegressions = (
  held: Iterable<{ readonly pubkey: string; readonly seq: number }>,
  offered: Iterable<{ readonly pubkey: string; readonly seq: number }>,
): readonly { readonly pubkey: string; readonly heldSeq: number; readonly offeredSeq: number }[] => {
  const best = new Map<string, number>()
  for (const row of held ?? []) {
    if (!isHex64(row?.pubkey) || !isCount(row?.seq)) continue
    const seen = best.get(row.pubkey)
    if (seen === undefined || row.seq > seen) best.set(row.pubkey, row.seq)
  }
  const out: { pubkey: string; heldSeq: number; offeredSeq: number }[] = []
  for (const row of offered ?? []) {
    if (!isHex64(row?.pubkey) || !isCount(row?.seq)) continue
    const heldSeq = best.get(row.pubkey)
    if (heldSeq !== undefined && row.seq < heldSeq) {
      out.push({ pubkey: row.pubkey, heldSeq, offeredSeq: row.seq })
    }
  }
  return out.sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0))
}

/**
 * WHAT MY NEXT CLAIM MUST CARRY — the anti-rollback rule for MY OWN key.
 *
 * `seq` is signed and cannot be raised without the secret, which is what makes
 * it a sound anti-replay counter for OTHER publishers. For my own it has the
 * opposite exposure, and no attacker is required to reach it: `held` is
 * rebuilt FROM A HOST, so a host that is merely BEHIND hands me a counter of 0
 * when I had signed up to 2. My next publish then signs seq 1 with genesis as
 * its parent, and every peer holding my real chain refuses it.
 *
 * `minted` is the defence: a LOCAL record of the last claim this instance
 * actually signed. The plan is the STRONGER of the two, with my own record
 * winning ties — a remote can move me forward but never back.
 *
 * AND A BASE PAST `MAX_CLAIM_SEQ` IS NOT A BASE. It is a value no reader would
 * have accepted in the first place, so succeeding it would sign a claim nobody
 * can parse and — because the result is written to the local ledger — would
 * make that state permanent. Refusing the base costs one genesis re-mint;
 * believing it costs the device its ability to publish at all.
 */
export const planVocabularyClaim = (
  held: { readonly body: string; readonly seq: number } | null | undefined,
  minted: { readonly body: string; readonly seq: number } | null | undefined,
): { prev: string | null; seq: number } => {
  const usable = (v: { readonly body: string; readonly seq: number }): boolean =>
    isHex64(v.body) && isSeq(v.seq) && v.seq < MAX_CLAIM_SEQ
  const h = held && usable(held) ? held : null
  const m = minted && usable(minted) ? minted : null
  const base = !h ? m : !m ? h : m.seq >= h.seq ? m : h
  return base ? { prev: base.body, seq: base.seq + 1 } : { prev: null, seq: 0 }
}

// ---------------------------------------------------------------------------
// MEMBERSHIP — the ONE place an absence is derived
// ---------------------------------------------------------------------------

/** One authentic claim's answer about one word. Built ONLY from a claim whose
 *  signature verified AND whose body arrived and hashed to the signed body
 *  sig; anything less has no opinion at all. */
export interface VocabularyObservation {
  readonly seq: number
  readonly complete: boolean
  /** Was the word in this claim's verified body? */
  readonly present: boolean
}

export type VocabularyMembership = 'declared' | 'absent' | 'unknown'

/**
 * DECLARED, ABSENT, OR UNKNOWN — as a pure fold over `{presentSeq,
 * completeSeq}`, so the branch lives in ONE place and no call site can invent
 * an absence.
 *
 *   declared  the word was present at the highest seq that named it, and no
 *             COMPLETE claim at a strictly higher seq omits it.
 *   absent    a claim whose signed `complete` is true omits the word, at a seq
 *             strictly higher than any claim that named it. This is the only
 *             way "no" is ever minted.
 *   unknown   everything else — including a publisher whose only claims admit
 *             they are partial. A partial list that DOES name the word is
 *             still a positive; a partial list that does not name it says
 *             nothing at all.
 *
 * NOTHING IS INFERRED FROM ABSENCE IN A MERGE. A narrower re-publish removes a
 * word only by being COMPLETE and omitting it — which is a statement the
 * publisher signed, not a deduction a reader made from a half-replicated
 * device.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `current` — ONLY THE CURRENT GENERATION SPEAKS.
 * ═════════════════════════════════════════════════════════════════════════
 * A reader that has SEEN an authentic claim at seq N must never mint an
 * answer out of generation N-1, and this is not hypothetical: bytes reach a
 * reader by replication, so "the current claim verified but its body has not
 * arrived yet" is the NORMAL state, and any second door still holding an
 * older COMPLETE claim would otherwise turn that lag into a signed-looking
 * NO. The mirror is just as bad — a withdrawal defeated by withholding one
 * atom, the retracted generation reported as the publisher's word.
 *
 * So the caller passes the highest AUTHENTIC seq it saw, and every
 * observation from a superseded generation is dropped rather than folded.
 * Nothing at that seq answered → UNKNOWN, which is the truth: the reader
 * failed to READ the current claim, and failing to read is never an absence.
 * Omit `current` only where there is no rank to be had.
 */
export const membershipOf = (
  observations: Iterable<VocabularyObservation>,
  current?: number,
): VocabularyMembership => {
  const only = isCount(current) ? current : null
  let presentSeq = -1
  let omitSeq = -1
  for (const o of observations ?? []) {
    if (!o || !isCount(o.seq)) continue
    if (only !== null && o.seq !== only) continue
    if (o.present) {
      if (o.seq > presentSeq) presentSeq = o.seq
    } else if (o.complete === true) {
      if (o.seq > omitSeq) omitSeq = o.seq
    }
  }
  if (presentSeq >= 0) return omitSeq > presentSeq ? 'absent' : 'declared'
  return omitSeq >= 0 ? 'absent' : 'unknown'
}

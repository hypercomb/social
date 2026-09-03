// core/head-map.ts
//
// THE DEPLOY SIGNATURE IS A SIGNED HEAD MAP, NOT A RECURSIVE SEAL.
//
// "History is the deploy" needs ONE signature that summarizes what a
// participant publishes. Until now that signature was minted by SEALING: walk
// the tree, fold each child's head into its parent, re-sign every internal
// node, and take the root. An adversarial review of the molecule prototype
// (`documentation/hypergraph-molecule-prototype-report.md`) broke that four
// ways, and every one of them is a property of the FOLD rather than a bug in
// it:
//
//   A   NO FIXPOINT. Depth is a route and names are global, so the name graph
//       is a general directed graph. One ordinary tile named after an ancestor
//       closes a cycle and the recursion never terminates.
//   A2  CYCLE-CUTTING DOES NOT RESCUE IT. Cutting on the recursion PATH makes
//       what a node folds depend on which ancestors are on the stack, so the
//       same molecule seals to two different signatures depending on the entry
//       point. Two publishes of one page, same bytes underneath, two pins.
//   B   THE CASCADE COMES BACK, TRIGGERED BY A STRANGER. The fold reads live
//       heads, and a molecule is a global name address, so another tenant
//       committing to `sign('people')` re-mints my deploy signature.
//   H   A SEALED ROOT CANNOT BE VERIFIED FROM IMMUTABLE ATOMS ALONE. Sealing
//       reads directory listings, so the merkle proof terminates in a mutable,
//       unsigned, host-chosen readdir — and a static host has no readdir at
//       all.
//
// THE ANSWER IS TO STOP FOLDING. A publisher already knows, flatly, which
// molecules it heads; that enumeration IS the deploy:
//
//   * IT TERMINATES BY CONSTRUCTION. Enumeration is set MEMBERSHIP, not a
//     value folded at each node. A cycle is a non-event: a molecule already in
//     the set is not visited again, and — unlike the seal — revisiting could
//     only ever have added what is already there. (This is exactly why the
//     global visited set that was tried and REVERTED for `sealSubtree` is
//     sound here: de-duplicating a union changes nothing; de-duplicating a
//     fold changes the answer.)
//   * IT IS ENTRY-POINT INDEPENDENT. The bytes are the canonical
//     representative of a SET — sorted rows, sorted refs, fixed field order,
//     no clock, no host, no route, no listing order, no cursor.
//   * A STRANGER CANNOT MOVE IT. Only this publisher's own buckets are
//     enumerated. A foreign commit lands in a different bucket directory the
//     enumeration never opens. The map still NAMES the molecule and asserts
//     exactly one thing about it — "this is MY head there" — and says nothing
//     about anyone else's bucket. It is a FLOOR, never a ceiling, the same
//     discipline `publish-heads.ts` already documents for `knownRoots` and
//     `publish-branch.ts` for `missingFromIndex`: report what is missing,
//     never re-assert it, because resurrecting a branch the participant
//     deliberately unpublished would be its own kind of lie.
//   * IT NEEDS NO DIRECTORY LISTING TO VERIFY. Every step is `GET /<64hex>`
//     plus a hash check plus a signature check: the map atom, then each row's
//     claim, then each head. Nothing is a readdir.
//
// WHY THE VALUE IS THE HEAD CLAIM AND NOT THE SUCCESSION ATOM. Only one of
// them is checkable by a third party. Step 3 deleted `name` and `author` from
// the succession atom, so the atom is bound to no location: a bare head
// signature in a row is authenticated ONLY by whatever signed the enclosing
// document, and a reader who lifts one row out cannot check it without
// swallowing the whole map. That makes the map a TRUST ANCHOR and the scheme
// stops being federated. A CLAIM signature dereferences to bytes whose signed
// preimage is `headClaimPreimage(molecule, pubkey, head, prev, seq)` — and the
// verifier REBUILDS lines 2 and 3 from the row's KEY and the pubkey it asked
// for, never from the bytes. A claim moved to another row, or minted under
// another key, renders a string that never verifies. `prev`/`seq` ride inside
// that signature, so a reader ranks generations with `resolveBucketHead`
// WITHOUT the map: a stale map degrades to "you may not have heard about a
// newer head", never to "you were talked back down a generation".
//
// WHAT THIS MODULE IS NOT. It carries no signature of its own, and that is
// deliberate. Every ROW is signed by its claim; the SET's publication is
// signed by whatever names the map atom (in the shipped app, the kind-30564
// hive index event, whose `created_at` monotonicity the relay enforces). A
// third signature over the map would prove authorship and never recency —
// `publish-heads.ts:17` says exactly this — so it would be one more thing to
// get wrong and would close nothing.
//
// THIS FILE IMPORTS NOTHING, exactly as `core/head-claim.ts` does. Core has no
// dependencies and carries no asymmetric primitive, so the verifier, the
// acceptor and the atom reader all arrive as PARAMETERS. The claim types below
// are re-declared structurally rather than imported so the module's import
// list stays empty; `head-map.spec.ts` pins the compatibility by passing the
// real `acceptHeadClaim` into `verifyHeadMap`, which would fail to compile if
// the two ever drifted.

/** A 64-hex lowercase address: a molecule, a public key, a claim, or an atom. */
const HEX64 = /^[0-9a-f]{64}$/

/** Line one of the record. Domain separation, and the version gate. */
export const HEAD_MAP_KIND = 'hypercomb.head-map'

/** The only version this module encodes or accepts. */
export const HEAD_MAP_V1 = 1

const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v)

const isSeq = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** One row before canonicalization: which molecule, and which claim of mine in it. */
export interface HeadMapPair {
  /** 64-hex lowercase: the molecule directory this publisher heads. */
  readonly molecule: string
  /** 64-hex lowercase: the content signature of the head CLAIM in MY bucket there. */
  readonly claim: string
}

/**
 * THE RECORD. Note what is ABSENT: no timestamp, no host, no route, no segment
 * list, no publisher-chosen order. Those are what made the seal a function of
 * WHEN and WHERE it ran; without them the bytes are a total function of
 * `(pubkey, {(molecule, claim)})` alone, which is what hands an idempotent
 * rebuild the identical signature and lets any third party RE-DERIVE the deploy
 * signature from the publisher's own buckets rather than merely take its word.
 */
export interface HeadMapRecord {
  readonly kind: typeof HEAD_MAP_KIND
  readonly v: typeof HEAD_MAP_V1
  /**
   * REFERENT: whose buckets these are. Self-declared, so it is COMPARED against
   * the key the reader asked for and never used as an address — the same
   * discipline `acceptHeadClaim`'s argument-one rule enforces, and the reason
   * `hive-pointer.ts` calls a pubkey mismatch `forged` rather than reading on.
   * Registered in `core/edge-registry.ts` so no closure walker ever fetches it.
   */
  readonly pubkey: string
  /**
   * The rows, sorted strictly ascending by molecule. AN ARRAY OF PAIRS, never a
   * JSON object: an object would make the bytes depend on a serializer's
   * key-ordering rule, which is the "second thing to get wrong" that
   * `headClaimPreimage` already refuses for its own preimage.
   *
   * DELIBERATELY NOT NAMED `heads`: `heads` is an EDGE FIELD
   * (`core/edge-registry.ts`), so a walker would descend these pairs and try to
   * fetch every MOLECULE address as if it were an atom — a molecule is a
   * directory with no bytes behind it, i.e. a permanent 404 cascade. The
   * closure a walker may follow is `refs` and nothing else.
   */
  readonly rows: readonly (readonly [molecule: string, claim: string])[]
  /**
   * The distinct claim signatures, sorted ascending. It duplicates the rows'
   * values ON PURPOSE: `refs` is the record kind's self-declared flat closure
   * (`core/edge-registry.ts`), so a staging or adopt walker carries every claim
   * atom with no walker change and no per-kind hop.
   */
  readonly refs: readonly string[]
}

/**
 * THE INJECTED VERIFIER, restated from `core/head-claim.ts` so this file
 * imports nothing. True ONLY if `pubkeyHex` signed EXACTLY `preimage`.
 */
export type HeadMapVerifier = (
  pubkeyHex: string,
  preimage: string,
  sigHex: string,
) => boolean | Promise<boolean>

/** What one head entry offers — structurally `OfferedHeadClaim`. */
export interface HeadMapOfferedClaim {
  readonly head: string
  readonly prev: string | null
  readonly seq: number
  readonly sig: string
}

/** The address a reader ASKED FOR — structurally `HeadClaimAddress`. */
export interface HeadMapAddress {
  readonly molecule: string
  readonly pubkey: string
}

/**
 * The two bits `verifyHeadMap` reads out of an acceptance verdict.
 *
 * IT READS `authentic`, NEVER `ok`. `ok` answers "may this become the head I
 * hold RIGHT NOW", which is a question about a TRANSITION and has no meaning
 * when re-reading a map of what is already published. A row whose claim is
 * genuinely the publisher's is verified; ranking generations is
 * `resolveBucketHead`'s job and nothing else's.
 */
export interface HeadMapAcceptVerdict {
  readonly ok: boolean
  readonly authentic: boolean
  readonly reason?: string
}

/** Structurally `acceptHeadClaim`. Injected so core carries no policy twice. */
export type HeadMapAcceptor = (
  address: HeadMapAddress,
  offered: HeadMapOfferedClaim,
  verify: HeadMapVerifier,
) => HeadMapAcceptVerdict | Promise<HeadMapAcceptVerdict>

/**
 * ONE ROW'S BYTES, FETCHED BY SIGNATURE — the only I/O verification needs, and
 * the reason skeptic-4 H closes. The reader is responsible for `GET /<claim>`
 * and for asserting `sha256(bytes) === claim`; it returns the parsed offer plus
 * a verifier BOUND TO THOSE EXACT BYTES (in the app, the kind-30565 event's
 * declared pubkey and content are compared before any curve maths runs).
 *
 * `sig`, when the reader reports it, is the signature it actually fetched; a
 * disagreement with the row is reported as `mismatched` rather than trusted.
 */
export type HeadMapClaimReader = (
  claimSig: string,
) => Promise<{
  readonly offered: HeadMapOfferedClaim
  readonly verify: HeadMapVerifier
  readonly sig?: string
} | null>

/** A row that did not verify. Per-row, so one cold atom never voids a deploy. */
export interface HeadMapHole {
  readonly molecule: string
  readonly claim: string
  /** `absent` = no bytes; `mismatched` = the reader answered with another sig;
   *  anything else is the acceptor's own refusal name. */
  readonly reason: string
}

/** One row that verified: the publisher's own signed head for that molecule. */
export interface HeadMapRow {
  readonly molecule: string
  readonly claim: string
  readonly head: string
  readonly prev: string | null
  readonly seq: number
}

export interface HeadMapVerdict {
  /** Every row verified against the key the caller asked for. */
  readonly ok: boolean
  readonly reason: 'forged' | 'malformed' | 'incomplete' | null
  readonly verified: readonly HeadMapRow[]
  readonly holes: readonly HeadMapHole[]
}

const isPair = (p: unknown): p is HeadMapPair =>
  !!p && typeof p === 'object' &&
  isHex64((p as HeadMapPair).molecule) && isHex64((p as HeadMapPair).claim)

/**
 * THE CANONICAL REPRESENTATIVE OF A SET.
 *
 * 1. fold the pairs to a map keyed by molecule. A repeat with an IDENTICAL
 *    claim collapses; a repeat with a DIFFERENT claim REFUSES the whole record
 *    rather than last-wins, so the result is a FUNCTION from molecule to claim
 *    and never a bag. (A publisher has one head per molecule by definition; two
 *    answers means the enumeration is wrong, and a map that quietly picked one
 *    would publish a head the publisher never chose.)
 * 2. sort rows ascending by molecule, and refs ascending. Both tokens are
 *    fixed-width lowercase hex — one alphabet — so codepoint order IS byte
 *    order, the order is TOTAL, and there is no locale, collation or tie-break
 *    left to specify.
 *
 * Returns null on any malformed input rather than repairing it.
 */
export const canonicalHeadMap = (
  pubkey: string,
  pairs: Iterable<HeadMapPair>,
): HeadMapRecord | null => {
  if (!isHex64(pubkey)) return null
  const byMolecule = new Map<string, string>()
  for (const pair of pairs ?? []) {
    if (!isPair(pair)) return null
    const held = byMolecule.get(pair.molecule)
    if (held !== undefined && held !== pair.claim) return null
    byMolecule.set(pair.molecule, pair.claim)
  }
  const rows = [...byMolecule.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([molecule, claim]) => [molecule, claim] as readonly [string, string])
  const refs = [...new Set(rows.map((r) => r[1]))].sort()
  return { kind: HEAD_MAP_KIND, v: HEAD_MAP_V1, pubkey, rows, refs }
}

/**
 * THE EXACT BYTES. Five fields in a FIXED LITERAL ORDER, composed from arrays
 * only, so nothing anywhere depends on a serializer's property-order rule:
 *
 *   {"kind":"hypercomb.head-map","v":1,"pubkey":"<64hex>",
 *    "rows":[["<molecule>","<claim>"],…],"refs":["<claim>",…]}
 *
 * Every value is fixed-width lowercase hex, a fixed literal, or the digit `1`,
 * so no value can contain a quote or a delimiter and no escaping rule can ever
 * be needed — the same argument `headClaimPreimage` makes one level down.
 *
 * THROWS on a non-canonical record. A writer that can emit bytes no reader will
 * parse is a strictly weaker gate than the reader, and under a publish that
 * advances a pointer before anyone reads it, that asymmetry publishes a deploy
 * nobody can verify. Mint through `canonicalHeadMap` and this never throws.
 */
export const encodeHeadMap = (record: HeadMapRecord): string => {
  const rebuilt = record && record.kind === HEAD_MAP_KIND && record.v === HEAD_MAP_V1
    ? canonicalHeadMap(record.pubkey, (record.rows ?? []).map(([molecule, claim]) => ({ molecule, claim })))
    : null
  if (!rebuilt) throw new TypeError('head map: not a canonical hypercomb.head-map v1 record')
  if (rebuilt.rows.length !== (record.rows ?? []).length) {
    throw new TypeError('head map: rows carry a duplicate molecule')
  }
  for (let i = 0; i < rebuilt.rows.length; i++) {
    const a = rebuilt.rows[i] as readonly [string, string]
    const b = record.rows[i] as readonly [string, string]
    if (a[0] !== b[0] || a[1] !== b[1]) throw new TypeError('head map: rows are not sorted by molecule')
  }
  const refs = record.refs ?? []
  if (refs.length !== rebuilt.refs.length || rebuilt.refs.some((r, i) => r !== refs[i])) {
    throw new TypeError('head map: refs are not the distinct claims, sorted')
  }
  const rowBytes = rebuilt.rows.map(([m, c]) => `["${m}","${c}"]`).join(',')
  const refBytes = rebuilt.refs.map((r) => `"${r}"`).join(',')
  return `{"kind":"${HEAD_MAP_KIND}","v":${HEAD_MAP_V1},"pubkey":"${rebuilt.pubkey}",` +
    `"rows":[${rowBytes}],"refs":[${refBytes}]}`
}

/**
 * REFUSE-OR-PARSE. The record is rebuilt canonically and the result must encode
 * back to the bytes that arrived, so a second spelling of one meaning cannot
 * exist — reordered rows, a missing `refs`, added whitespace, an unknown field
 * or a `v: 2` all REFUSE rather than mis-read. Two encodings of one set would
 * be two deploy signatures for one deploy.
 */
export const parseHeadMap = (text: string): HeadMapRecord | null => {
  if (typeof text !== 'string' || text.length > 1 << 22) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj['kind'] !== HEAD_MAP_KIND || obj['v'] !== HEAD_MAP_V1) return null
  if (!Array.isArray(obj['rows']) || !Array.isArray(obj['refs'])) return null
  const pairs: HeadMapPair[] = []
  for (const row of obj['rows'] as unknown[]) {
    if (!Array.isArray(row) || row.length !== 2) return null
    const [molecule, claim] = row as unknown[]
    if (!isHex64(molecule) || !isHex64(claim)) return null
    pairs.push({ molecule, claim })
  }
  const rebuilt = canonicalHeadMap(obj['pubkey'] as string, pairs)
  if (!rebuilt) return null
  let encoded: string
  try {
    encoded = encodeHeadMap(rebuilt)
  } catch {
    return null
  }
  return encoded === text ? rebuilt : null
}

/** This publisher's claim for one molecule, or null if the map does not name it. */
export const headMapClaimFor = (record: HeadMapRecord, molecule: string): string | null => {
  if (!record || !Array.isArray(record.rows) || !isHex64(molecule)) return null
  for (const row of record.rows) if (row[0] === molecule) return row[1]
  return null
}

/**
 * COMPOSE TWO ENUMERATIONS, EXPLICIT IN BOTH DIRECTIONS.
 *
 * NOTHING IS INFERRED FROM ABSENCE, because absence is also what a cold ledger,
 * a half-replicated device or a scoped re-mint looks like. A molecule leaves
 * the map only by being NAMED in `remove` — which is the same rule
 * `publish-branch.ts` follows when it REPORTS `missingFromIndex` instead of
 * re-asserting it.
 *
 * Refuses (null) when the two records are not the same publisher's.
 */
export const mergeHeadMap = (
  prior: HeadMapRecord | null | undefined,
  updates: Iterable<HeadMapPair>,
  options: { readonly pubkey?: string; readonly remove?: Iterable<string> } = {},
): HeadMapRecord | null => {
  const pubkey = options.pubkey ?? prior?.pubkey
  if (!isHex64(pubkey)) return null
  if (prior && prior.pubkey !== pubkey) return null
  const drop = new Set<string>()
  for (const molecule of options.remove ?? []) {
    if (!isHex64(molecule)) return null
    drop.add(molecule)
  }
  const merged = new Map<string, string>()
  for (const row of prior?.rows ?? []) merged.set(row[0], row[1])
  for (const pair of updates ?? []) {
    if (!isPair(pair)) return null
    merged.set(pair.molecule, pair.claim)
  }
  for (const molecule of drop) merged.delete(molecule)
  return canonicalHeadMap(
    pubkey,
    [...merged.entries()].map(([molecule, claim]) => ({ molecule, claim })),
  )
}

/** What changed between two enumerations, per molecule. Pure; no I/O. */
export interface HeadMapDelta {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly moved: readonly string[]
  readonly unchanged: readonly string[]
}

/**
 * The differential a publish panel actually wants. A single signature compare
 * answers "same or different"; this answers WHICH MOLECULE, which is the
 * question a participant asked when they opened the panel.
 */
export const headMapDiff = (
  a: HeadMapRecord | null | undefined,
  b: HeadMapRecord | null | undefined,
): HeadMapDelta => {
  const left = new Map<string, string>((a?.rows ?? []).map((r) => [r[0], r[1]]))
  const right = new Map<string, string>((b?.rows ?? []).map((r) => [r[0], r[1]]))
  const added: string[] = []
  const removed: string[] = []
  const moved: string[] = []
  const unchanged: string[] = []
  for (const [molecule, claim] of right) {
    const before = left.get(molecule)
    if (before === undefined) added.push(molecule)
    else if (before === claim) unchanged.push(molecule)
    else moved.push(molecule)
  }
  for (const molecule of left.keys()) if (!right.has(molecule)) removed.push(molecule)
  const sort = (xs: string[]): string[] => xs.sort()
  return { added: sort(added), removed: sort(removed), moved: sort(moved), unchanged: sort(unchanged) }
}

/**
 * WHERE A REPLAY IS CAUGHT — and it is caught per ROW, on the author's own
 * signed counter, never on a property of the map.
 *
 * A map carries no clock and no counter, deliberately: a signature proves
 * authorship and NEVER recency, so a map-level counter would be a number the
 * publisher asserts rather than a fact anyone can check. What IS checkable is
 * inside each claim, because `seq` is line six of a signed preimage and cannot
 * be raised without the secret. So a reader that remembers the rows it has
 * verified detects a replayed OLDER map exactly: a row whose seq went
 * BACKWARDS under the same key.
 *
 * Returns the rows that regressed. Empty means the offered enumeration is
 * consistent with everything the reader has already proven.
 */
export const headMapRegressions = (
  held: Iterable<{ readonly molecule: string; readonly seq: number }>,
  offered: Iterable<{ readonly molecule: string; readonly seq: number }>,
): readonly { readonly molecule: string; readonly heldSeq: number; readonly offeredSeq: number }[] => {
  const best = new Map<string, number>()
  for (const row of held ?? []) {
    if (!isHex64(row?.molecule) || !isSeq(row?.seq)) continue
    const seen = best.get(row.molecule)
    if (seen === undefined || row.seq > seen) best.set(row.molecule, row.seq)
  }
  const out: { molecule: string; heldSeq: number; offeredSeq: number }[] = []
  for (const row of offered ?? []) {
    if (!isHex64(row?.molecule) || !isSeq(row?.seq)) continue
    const heldSeq = best.get(row.molecule)
    if (heldSeq !== undefined && row.seq < heldSeq) {
      out.push({ molecule: row.molecule, heldSeq, offeredSeq: row.seq })
    }
  }
  return out.sort((a, b) => (a.molecule < b.molecule ? -1 : a.molecule > b.molecule ? 1 : 0))
}

/**
 * VERIFY A DEPLOY WITH NO DIRECTORY LISTING — the call that closes skeptic-4 H.
 *
 * `expected` is argument two and has NO DEFAULT: a caller cannot ask "is this
 * map good?" without saying whose it is supposed to be. That is
 * `acceptHeadClaim`'s argument-one rule restated one level up, and it is the
 * whole defence against a substituted map — `record.pubkey` is self-declared
 * and is COMPARED, never trusted.
 *
 * For each row the molecule comes from the row's KEY and the pubkey from
 * `expected`; the acceptor rebuilds the claim preimage from those two and the
 * offered head/prev/seq. Nothing is parsed out of the bytes, so a claim lifted
 * from another row — even one of this publisher's own — renders a string that
 * never verifies.
 *
 * FAILURE IS PER ROW. One cold atom yields one `hole` and the rest of the
 * deploy still verifies; collapsing that into a single boolean is how one
 * unreachable byte would make a whole publisher unverifiable.
 */
export const verifyHeadMap = async (
  record: HeadMapRecord,
  expected: string,
  readClaim: HeadMapClaimReader,
  accept: HeadMapAcceptor,
): Promise<HeadMapVerdict> => {
  const fail = (reason: 'forged' | 'malformed'): HeadMapVerdict =>
    ({ ok: false, reason, verified: [], holes: [] })

  if (!record || record.kind !== HEAD_MAP_KIND || record.v !== HEAD_MAP_V1) return fail('malformed')
  if (!Array.isArray(record.rows) || !isHex64(record.pubkey)) return fail('malformed')
  try {
    encodeHeadMap(record)
  } catch {
    return fail('malformed')
  }
  if (!isHex64(expected) || record.pubkey !== expected) return fail('forged')

  const verified: HeadMapRow[] = []
  const holes: HeadMapHole[] = []
  for (const [molecule, claim] of record.rows) {
    let read: Awaited<ReturnType<HeadMapClaimReader>> = null
    try {
      read = await readClaim(claim)
    } catch {
      read = null
    }
    if (!read || !read.offered) {
      holes.push({ molecule, claim, reason: 'absent' })
      continue
    }
    if (read.sig !== undefined && read.sig !== claim) {
      holes.push({ molecule, claim, reason: 'mismatched' })
      continue
    }
    let verdict: HeadMapAcceptVerdict
    try {
      verdict = await accept({ molecule, pubkey: expected }, read.offered, read.verify)
    } catch {
      holes.push({ molecule, claim, reason: 'unsigned' })
      continue
    }
    if (!verdict || verdict.authentic !== true) {
      holes.push({ molecule, claim, reason: verdict?.reason ?? 'unsigned' })
      continue
    }
    verified.push({
      molecule,
      claim,
      head: read.offered.head,
      prev: read.offered.prev ?? null,
      seq: read.offered.seq,
    })
  }
  return {
    ok: holes.length === 0,
    reason: holes.length === 0 ? null : 'incomplete',
    verified,
    holes,
  }
}

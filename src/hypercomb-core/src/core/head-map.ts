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
// ─────────────────────────────────────────────────────────────────────────
// WHAT THE THIRD-PARTY REVIEW CHANGED (2026-09-03)
// ─────────────────────────────────────────────────────────────────────────
//
// The first cut of this module carried NO signature of its own, and argued
// that a third signature "would prove authorship and never recency, so it
// would close nothing". That argument conflated two different properties, and
// three independent adversarial passes landed on the gap:
//
//   AUTHORSHIP OF THE SET is not recency, it is exactly what was missing, and
//   it is exactly what a signature closes.
//
// Because every ROW was independently signed and the COMPOSITION was signed by
// nobody, any party holding a publisher's public bytes could compose new,
// fully-verifying "deploys" out of that publisher's own rows:
//
//   TRUNCATION   drop a molecule -> ok:true, holes:[], reason:null — a verdict
//                byte-identical to the truth, with a whole subtree erased.
//   THE EMPTY    `canonicalHeadMap(pubkey, [])` -> ok:true. "This publisher
//     DEPLOY     published nothing", verified against their own key.
//   CHERRY-PICK  every current row but one, pinned to an older claim of the
//                SAME molecule under the SAME key — a hive state that never
//                existed on any device, rendering clean for a cold reader.
//
// So the set IS signed now, by `headMapAttestationPreimage`, checked by the
// SAME injected verifier and the SAME key. It adds no clock and claims no
// recency: a replayed OLDER attested map still verifies, and still degrades
// exactly as before to "you may not have heard about a newer head", caught per
// row by `headMapRegressions` on the author's own signed `seq`. What it does
// close is composition — a set nobody signed is now refused, loudly, as
// `unattested`.
//
// THE TWO DOORS, AND WHY THERE ARE TWO. `verifyHeadMapRows` answers "is every
// row present genuinely this key's?" and CANNOT answer "is this the set they
// published"; its verdict therefore has no `ok` field at all, only
// `rowsAuthentic`, so no caller can read the stronger meaning into the weaker
// answer. `verifyDeploy` is the whole procedure — it takes the deploy
// SIGNATURE the caller was told to expect, hashes the bytes it was served,
// refuse-or-parses them, checks the attestation, and only then reads the rows.
// The earlier API had no function anywhere that took a deploy signature, which
// is what made skipping step 1 of the documented recipe an easy mistake rather
// than an impossible one.
//
// THREE MORE DOORS THE SAME REVIEW SHUT:
//
//   * A CLAIM READER MUST STATE WHAT IT FETCHED. `sig` was optional, so a
//     reader written strictly to the type omitted it — and a host answering
//     `GET /<current>` with the bytes of the publisher's own OLDER claim
//     downgraded a row under an unchanged, correctly-signed deploy. `sig` is
//     now REQUIRED and is the signature the bytes ACTUALLY hash to, so a lying
//     host is `mismatched` (loud) instead of `absent` (indistinguishable from
//     a cold byte).
//   * A DEPLOY THAT NAMES NO CONTENT. `refs` carries CLAIMS, and a claim's
//     `head` is neither an edge nor a referent, so a replica built from the
//     deploy's own declared closure holds the map and the claims and not one
//     byte of the hive — and verified `ok:true` over it. `readHead` is an
//     optional reader that makes an unreachable succession a hole ON THAT ROW.
//   * THE WRITER COULD MINT WHAT THE READER REFUSES. `parseHeadMap` capped at
//     4 MiB and `encodeHeadMap` capped at nothing — the exact asymmetry this
//     file's own comment forbids, at ~20,660 molecules, where ONE more tile
//     name loses not one molecule but every molecule. The gates are now the
//     same constant in both directions, the refusal says WHICH gate failed,
//     and `splitHeadMap` is the documented way over the wall.
//
// THIS FILE IMPORTS NOTHING, exactly as `core/head-claim.ts` does. Core has no
// dependencies and carries no asymmetric primitive and no hash, so the
// verifier, the digest, the acceptor and the atom readers all arrive as
// PARAMETERS. The claim types below are re-declared structurally rather than
// imported so the module's import list stays empty; `head-map.spec.ts` pins the
// compatibility by passing the real `acceptHeadClaim` into the verifier, which
// would fail to compile if the two ever drifted.

/** A 64-hex lowercase address: a molecule, a public key, a claim, or an atom. */
const HEX64 = /^[0-9a-f]{64}$/

/** Line one of the record. Domain separation, and the version gate. */
export const HEAD_MAP_KIND = 'hypercomb.head-map'

/** The only version this module encodes or accepts. */
export const HEAD_MAP_V1 = 1

/**
 * THE ONE SIZE GATE, applied in BOTH directions.
 *
 * A writer that can emit bytes no reader will parse is a strictly weaker gate
 * than the reader, and under a publish that advances a pointer before anyone
 * reads it, that asymmetry publishes a deploy nobody can verify. So this
 * constant is the encoder's ceiling AND the parser's, and crossing it is a
 * throw at mint time rather than a null at read time on somebody else's
 * machine. A row costs 203 bytes (136 for the pair, 67 for the duplicated
 * ref), so this is roughly 20,660 molecules; past that a publisher shards with
 * `splitHeadMap` and names several map atoms, which is sound because the map
 * is a SET and a set splits.
 */
export const HEAD_MAP_MAX_BYTES = 1 << 22

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
 * rebuild the identical signature.
 *
 * NOTE WHAT IT STILL DOES NOT CLAIM. These bytes are not self-attesting: the
 * SET is signed separately (`headMapAttestationPreimage`) because the record is
 * content-addressed and a signature over bytes cannot live inside them. A
 * record on its own proves nothing about who assembled it — `verifyDeploy` is
 * the door that checks the pair.
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
   *
   * The comparison is a SHAPE gate and never an authenticity one: whoever
   * composes the bytes chooses this field. Authenticity of the composition is
   * the attestation's job and nothing else's.
   */
  readonly pubkey: string
  /**
   * The rows, sorted strictly ascending by molecule. AN ARRAY OF PAIRS, never a
   * JSON object: an object would make the bytes depend on a serializer's
   * key-ordering rule, which is the "second thing to get wrong" that
   * `headClaimPreimage` already refuses for its own preimage.
   *
   * DELIBERATELY NOT NAMED `heads`. Two reasons, and the second is the durable
   * one. (1) The prototype twin's miner (`documentation/molecule-lineage-
   * prototype/sig.mjs`) DOES treat `heads` as an edge field, and a walker that
   * descends these pairs tries to fetch every MOLECULE address as if it were an
   * atom — a directory with no bytes behind it, i.e. the permanent-404 cascade
   * this repo's `groupSig` lesson is named after. (2) Independently of any one
   * miner: both tokens of a pair are ARRAY ELEMENTS, so any field name that a
   * walker treats as an edge exposes the molecule key as a fetch target, while
   * `rows` is not an edge field anywhere. `refs` — which IS an edge field in
   * `core/edge-registry.ts` — carries the record's exact, self-declared closure
   * instead. (`heads` is NOT in core's frozen `EDGE_FIELDS`; a walker there
   * would ignore it, which is a different bug — a deploy that replicates
   * without the thing it deploys — and is why the deploy LAYER files the map
   * signature under `refs` and never under a field nothing walks.)
   */
  readonly rows: readonly (readonly [molecule: string, claim: string])[]
  /**
   * The distinct claim signatures, sorted ascending. It duplicates the rows'
   * values ON PURPOSE: `refs` is the record kind's self-declared flat closure
   * (`core/edge-registry.ts`), so a staging or adopt walker carries every claim
   * atom with no walker change and no per-kind hop.
   *
   * THE CLOSURE STOPS HERE, AND THAT IS DESIGN, NOT OVERSIGHT. A claim is
   * `{head, prev, seq, sig}`; `head` is not an edge and `prev` is a declared
   * REFERENT, so following this closure carries N claim atoms and ZERO page
   * bytes. A deploy names WHERE the pages are, and a reader pulls each verified
   * row's head on demand — which is what keeps a cold read O(page) rather than
   * O(every edit ever made). A verifier that wants to know the pages are
   * actually THERE passes `readHead`.
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

/** The injected hash. Core carries no crypto, so even sha256 arrives as an argument. */
export type HeadMapDigest = (text: string) => string | Promise<string>

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
 * The two bits the row verifier reads out of an acceptance verdict.
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
 * WHAT A CLAIM READER MUST RETURN, AND WHY `sig` IS REQUIRED.
 *
 * `sig` is the signature THE BYTES ACTUALLY HASH TO — not the signature that
 * was asked for. A reader states what it got and the verifier compares; a
 * reader that merely refuses on a mismatch collapses "this host answered with
 * something else" into "this byte was cold", and those are opposite facts about
 * a host. When it was optional, a reader written strictly to the type omitted
 * it, and a host answering `GET /<current claim>` with the bytes of the
 * publisher's own older claim downgraded a live row under a deploy signature
 * that never moved.
 */
export interface HeadMapClaimRead {
  /** 64-hex: what `sha256(the bytes that came back)` actually is. */
  readonly sig: string
  readonly offered: HeadMapOfferedClaim
  /** A verifier BOUND TO THOSE EXACT BYTES. */
  readonly verify: HeadMapVerifier
}

/**
 * ONE ROW'S BYTES, FETCHED BY SIGNATURE — the only I/O verification needs, and
 * the reason skeptic-4 H closes. The reader is responsible for `GET /<claim>`
 * and for hashing what came back; `null` means no bytes at all.
 */
export type HeadMapClaimReader = (claimSig: string) => Promise<HeadMapClaimRead | null>

/**
 * OPTIONAL: is the succession atom this row names actually retrievable?
 *
 * Without it, `ok:true` cannot tell a whole site from no site — the declared
 * closure of a deploy is its CLAIMS, so a host holding the map and the claims
 * and nothing else verifies perfectly and renders nothing. With it, an
 * unreachable head is a hole ON THAT ROW and the rest of the deploy still
 * verifies, which is the same per-row discipline as every other failure here.
 *
 * Returns true when the bytes are present AND hash to `headSig`.
 */
export type HeadMapHeadReader = (headSig: string) => Promise<boolean>

/** A row that did not verify. Per-row, so one cold atom never voids a deploy. */
export interface HeadMapHole {
  readonly molecule: string
  readonly claim: string
  /**
   * `absent` — no bytes came back for the claim.
   * `mismatched` — the host answered with bytes that are a DIFFERENT atom.
   * `unchecked` — the reader did not say what it fetched (a reader bug, and
   *   the only honest verdict is that nothing was checked).
   * `head-absent` — the claim verified and the succession it names is not
   *   retrievable, so this row points at nothing.
   * anything else — the acceptor's own refusal name (`unsigned`, `malformed`…).
   */
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

/** Why a whole record, rather than one row, was refused. */
export type HeadMapReason =
  | 'forged'
  | 'malformed'
  | 'oversize'
  | 'incomplete'
  | 'unattested'
  | null

/**
 * THE WEAKER VERDICT, and its field names say so.
 *
 * THERE IS NO `ok` FIELD, deliberately. `ok` reads as "this deploy is good" and
 * could only ever mean "no row I was shown failed" — the difference an
 * adversarial pass exploited three ways. `rowsAuthentic` cannot be misread, and
 * a caller who wants the strong statement has to go through `verifyDeploy`,
 * where `ok` exists and means the whole thing.
 */
export interface HeadMapRowsVerdict {
  /** Every row PRESENT verified against the key the caller asked for. */
  readonly rowsAuthentic: boolean
  readonly reason: HeadMapReason
  readonly verified: readonly HeadMapRow[]
  readonly holes: readonly HeadMapHole[]
}

/** The full verdict: rows AND the set, with the deploy signature pinned. */
export interface HeadMapDeployVerdict extends HeadMapRowsVerdict {
  /** Attested, complete and every row authentic. The only field that means it. */
  readonly ok: boolean
  /** A signature by `expected` over THESE EXACT BYTES was checked. */
  readonly attested: boolean
  /** The deploy signature these bytes were proven to be. */
  readonly sig: string
  /** The parsed record, or null when it never parsed. */
  readonly record: HeadMapRecord | null
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

/** The exact encoded length of a canonical record, without building the string. */
const encodedLength = (rowCount: number, refCount: number): number => {
  // {"kind":"hypercomb.head-map","v":1,"pubkey":"<64>","rows":[…],"refs":[…]}
  // 9 `{"kind":"` + kind + 6 `","v":` + 1 `1` + 11 `,"pubkey":"` + 64 + 10
  // `","rows":[` + rows + 10 `],"refs":[` + refs + 2 `]}` = 131 for the frame;
  // a row `["<64>","<64>"]` is 135 and a ref `"<64>"` is 66, plus the commas.
  const frame = 9 + HEAD_MAP_KIND.length + 6 + 1 + 11 + 64 + 10 + 10 + 2
  const rowBytes = rowCount === 0 ? 0 : rowCount * 135 + (rowCount - 1)
  const refBytes = refCount === 0 ? 0 : refCount * 66 + (refCount - 1)
  return frame + rowBytes + refBytes
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
 * THROWS on a non-canonical record, AND on a record past `HEAD_MAP_MAX_BYTES`.
 * The size throw is the one this module used to be missing: the reader has
 * always refused oversize text, so an encoder without the same ceiling is a
 * strictly weaker gate, and under a publish that advances a pointer before
 * anyone reads it, that asymmetry publishes a deploy nobody can verify. Mint
 * through `canonicalHeadMap` (and, past the wall, `splitHeadMap`) and this
 * never throws.
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
  if (encodedLength(rebuilt.rows.length, rebuilt.refs.length) > HEAD_MAP_MAX_BYTES) {
    throw new RangeError(
      `head map: ${rebuilt.rows.length} rows exceed HEAD_MAP_MAX_BYTES (${HEAD_MAP_MAX_BYTES}) — shard with splitHeadMap`,
    )
  }
  const rowBytes = rebuilt.rows.map(([m, c]) => `["${m}","${c}"]`).join(',')
  const refBytes = rebuilt.refs.map((r) => `"${r}"`).join(',')
  return `{"kind":"${HEAD_MAP_KIND}","v":${HEAD_MAP_V1},"pubkey":"${rebuilt.pubkey}",` +
    `"rows":[${rowBytes}],"refs":[${refBytes}]}`
}

/**
 * SHARD A SET THAT IS TOO BIG FOR ONE ATOM — the documented way over the wall.
 *
 * A cap on one atom is a cliff if the only answer is "throw": at 20,661
 * molecules a publisher would lose not one molecule but every molecule. A map
 * is a SET, and a set splits, so a large publisher names several map atoms and
 * a reader unions them (`mergeHeadMap`). Shards are cut in canonical row order,
 * so the split is deterministic and a rebuild that changed nothing produces the
 * identical shard signatures.
 *
 * Returns `[]` only for a malformed record. A record that already fits comes
 * back as a single shard.
 */
export const splitHeadMap = (
  record: HeadMapRecord | null | undefined,
  maxBytes: number = HEAD_MAP_MAX_BYTES,
): readonly HeadMapRecord[] => {
  if (!record || !isHex64(record.pubkey) || !Array.isArray(record.rows)) return []
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : HEAD_MAP_MAX_BYTES
  const out: HeadMapRecord[] = []
  let batch: HeadMapPair[] = []
  let refs = new Set<string>()
  const flush = (): void => {
    if (!batch.length) return
    const shard = canonicalHeadMap(record.pubkey, batch)
    if (shard) out.push(shard)
    batch = []
    refs = new Set<string>()
  }
  for (const row of record.rows) {
    if (!Array.isArray(row) || !isHex64(row[0]) || !isHex64(row[1])) return []
    const nextRefs = refs.has(row[1]) ? refs.size : refs.size + 1
    if (batch.length && encodedLength(batch.length + 1, nextRefs) > limit) flush()
    batch.push({ molecule: row[0], claim: row[1] })
    refs.add(row[1])
  }
  flush()
  return out
}

/** Why `parseHeadMap` said no. `null` means it said yes. */
export type HeadMapRefusal = 'oversize' | 'unparseable' | 'non-canonical' | null

const readHeadMap = (text: string): { record: HeadMapRecord | null; refusal: HeadMapRefusal } => {
  if (typeof text !== 'string') return { record: null, refusal: 'unparseable' }
  if (text.length > HEAD_MAP_MAX_BYTES) return { record: null, refusal: 'oversize' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { record: null, refusal: 'unparseable' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { record: null, refusal: 'unparseable' }
  const obj = raw as Record<string, unknown>
  if (obj['kind'] !== HEAD_MAP_KIND || obj['v'] !== HEAD_MAP_V1) return { record: null, refusal: 'non-canonical' }
  if (!Array.isArray(obj['rows']) || !Array.isArray(obj['refs'])) return { record: null, refusal: 'non-canonical' }
  const pairs: HeadMapPair[] = []
  for (const row of obj['rows'] as unknown[]) {
    if (!Array.isArray(row) || row.length !== 2) return { record: null, refusal: 'non-canonical' }
    const [molecule, claim] = row as unknown[]
    if (!isHex64(molecule) || !isHex64(claim)) return { record: null, refusal: 'non-canonical' }
    pairs.push({ molecule, claim })
  }
  const rebuilt = canonicalHeadMap(obj['pubkey'] as string, pairs)
  if (!rebuilt) return { record: null, refusal: 'non-canonical' }
  let encoded: string
  try {
    encoded = encodeHeadMap(rebuilt)
  } catch {
    return { record: null, refusal: 'non-canonical' }
  }
  return encoded === text ? { record: rebuilt, refusal: null } : { record: null, refusal: 'non-canonical' }
}

/**
 * REFUSE-OR-PARSE. The record is rebuilt canonically and the result must encode
 * back to the bytes that arrived, so a second spelling of one meaning cannot
 * exist — reordered rows, a missing `refs`, added whitespace, an unknown field
 * or a `v: 2` all REFUSE rather than mis-read. Two encodings of one set would
 * be two deploy signatures for one deploy.
 */
export const parseHeadMap = (text: string): HeadMapRecord | null => readHeadMap(text).record

/**
 * WHY the parse said no. A bare null cannot distinguish "too big for this
 * version" from "tampered with", and those call for opposite responses: the
 * first is a publisher who must shard, the second is a host that must not be
 * believed.
 */
export const headMapRefusal = (text: string): HeadMapRefusal => readHeadMap(text).refusal

// ── the attestation: who assembled this SET ────────────────────────────────

/** Line one of the attestation preimage. Domain separation from every other signature. */
export const HEAD_MAP_ATTEST_V1 = 'hc:head-map:v1'

/**
 * THE EXACT BYTES SIGNED OVER A DEPLOY. Three lines, `\n`-joined, no trailing
 * newline, exactly as `headClaimPreimage` is six:
 *
 *   hc:head-map:v1
 *   <pubkey>
 *   <mapSig>
 *
 * Both values are fixed-width lowercase hex, so no value can contain the
 * delimiter and no escaping rule can ever be needed.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. It proves this key assembled THIS SET —
 * which is what makes a truncation, an empty deploy or a cherry-picked mixture
 * refusable, because none of them is a set the publisher ever signed. It proves
 * NOTHING about recency, and nothing here pretends otherwise: a replayed older
 * attested map still verifies, and is still caught only per row, on the
 * author's own signed `seq`, by `headMapRegressions`. There is no clock in
 * these bytes for the same reason there is none in the record.
 *
 * `mapSig` is `digest(encodeHeadMap(record))` — the deploy signature itself, so
 * the attestation is bound to the exact bytes and cannot be lifted onto another
 * map, and `pubkey` is line two so it cannot be lifted onto another key either.
 */
export const headMapAttestationPreimage = (pubkey: string, mapSig: string): string =>
  [HEAD_MAP_ATTEST_V1, pubkey, mapSig].join('\n')

/** What a host serves for a deploy: the signature asked for, the bytes, the attestation. */
export interface HeadMapDeployOffer {
  /** 64-hex: the deploy signature the caller was TOLD to expect, from a signed source. */
  readonly sig: string
  /** The bytes the host answered with. Hashed here; never trusted as named. */
  readonly bytes: string
  /** The publisher's detached signature over `headMapAttestationPreimage`. */
  readonly attestation: string | null
}

/** Everything verification needs from outside core, which carries no crypto. */
export interface HeadMapVerifyDeps {
  readonly digest: HeadMapDigest
  readonly verify: HeadMapVerifier
  readonly readClaim: HeadMapClaimReader
  readonly accept: HeadMapAcceptor
  /** Optional: prove each verified row's succession is actually retrievable. */
  readonly readHead?: HeadMapHeadReader
}

/** This publisher's claim for one molecule, or null if the map does not name it. */
export const headMapClaimFor = (record: HeadMapRecord, molecule: string): string | null => {
  if (!record || !Array.isArray(record.rows) || !isHex64(molecule)) return null
  for (const row of record.rows) if (row[0] === molecule) return row[1]
  return null
}

/** One molecule whose claim a merge overwrote. */
export interface HeadMapReplacement {
  readonly molecule: string
  readonly from: string
  readonly to: string
}

/** The result of composing two enumerations. A caller cannot not-know. */
export interface HeadMapMerge {
  /** null when the inputs are not composable, or a refused regression. */
  readonly record: HeadMapRecord | null
  /** Molecules whose claim the update replaced. */
  readonly replaced: readonly HeadMapReplacement[]
  /** Updates that moved a molecule BACKWARDS by the author's own signed seq. */
  readonly regressed: readonly { readonly molecule: string; readonly heldSeq: number; readonly offeredSeq: number }[]
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
 * IT RETURNS WHAT IT DID, NOT ONLY WHAT IT MADE. The first cut was
 * last-write-wins returning a bare record, so merging a stranger's older row
 * over a held newer one silently downgraded a molecule — `HeadMapPair` carries
 * no `seq`, so the primitive could not rank and did not try, while one level
 * down `acceptHeadClaim` makes staleness its central rule. That discipline
 * travels up here: pass verified rows (which DO carry `seq`) as `held` and/or
 * `ranked`, and a backwards move REFUSES the merge and names the molecules.
 * With no ranking information the merge still proceeds — a caller composing two
 * of its own scoped mints has nothing to rank — but `replaced` always says
 * which molecules moved.
 */
export const mergeHeadMap = (
  prior: HeadMapRecord | null | undefined,
  updates: Iterable<HeadMapPair & { readonly seq?: number }>,
  options: {
    readonly pubkey?: string
    readonly remove?: Iterable<string>
    /** Generations the caller has already PROVEN, e.g. `verifyHeadMapRows().verified`. */
    readonly held?: Iterable<{ readonly molecule: string; readonly seq: number }>
    /** Accept a proven regression anyway. Never the default; a caller must say so. */
    readonly allowRegression?: boolean
  } = {},
): HeadMapMerge => {
  const empty = { record: null, replaced: [], regressed: [] } as HeadMapMerge
  const pubkey = options.pubkey ?? prior?.pubkey
  if (!isHex64(pubkey)) return empty
  if (prior && prior.pubkey !== pubkey) return empty
  const drop = new Set<string>()
  for (const molecule of options.remove ?? []) {
    if (!isHex64(molecule)) return empty
    drop.add(molecule)
  }
  const merged = new Map<string, string>()
  for (const row of prior?.rows ?? []) merged.set(row[0], row[1])

  const heldSeq = new Map<string, number>()
  for (const row of options.held ?? []) {
    if (!isHex64(row?.molecule) || !isSeq(row?.seq)) continue
    const seen = heldSeq.get(row.molecule)
    if (seen === undefined || row.seq > seen) heldSeq.set(row.molecule, row.seq)
  }

  const replaced: HeadMapReplacement[] = []
  const regressed: { molecule: string; heldSeq: number; offeredSeq: number }[] = []
  for (const pair of updates ?? []) {
    if (!isPair(pair)) return empty
    const before = merged.get(pair.molecule)
    if (isSeq(pair.seq)) {
      const known = heldSeq.get(pair.molecule)
      if (known !== undefined && pair.seq < known) {
        regressed.push({ molecule: pair.molecule, heldSeq: known, offeredSeq: pair.seq })
      }
    }
    if (before !== undefined && before !== pair.claim) {
      replaced.push({ molecule: pair.molecule, from: before, to: pair.claim })
    }
    merged.set(pair.molecule, pair.claim)
  }
  for (const molecule of drop) merged.delete(molecule)

  regressed.sort((a, b) => (a.molecule < b.molecule ? -1 : a.molecule > b.molecule ? 1 : 0))
  if (regressed.length && options.allowRegression !== true) {
    return { record: null, replaced, regressed }
  }
  const record = canonicalHeadMap(
    pubkey,
    [...merged.entries()].map(([molecule, claim]) => ({ molecule, claim })),
  )
  return { record, replaced, regressed }
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
 * THE HONEST LIMIT, STATED HERE BECAUSE IT IS PERMANENT: this needs rows the
 * reader has ALREADY PROVEN. A cold reader holds none, so a replayed older
 * ATTESTED deploy is invisible to a first-time visitor — and no signature can
 * close that, because recency is not a property a signature carries. The
 * mitigation is a pointer whose freshness is enforced elsewhere (in the shipped
 * app, the relay's `created_at` monotonicity on the kind-30564 index event),
 * which is exactly why the pointer, not the map, is the thing that must be
 * fetched from a source with a clock.
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
 * THE INNER HALF: IS EVERY ROW PRESENT GENUINELY THIS KEY'S?
 *
 * It cannot answer whether this is the SET the publisher deployed, and its
 * verdict is named so that nobody can read that into it — there is no `ok`
 * field here. Use `verifyDeploy` for a deploy.
 *
 * `expected` is argument two and has NO DEFAULT: a caller cannot ask "are these
 * rows good?" without saying whose they are supposed to be. That is
 * `acceptHeadClaim`'s argument-one rule restated one level up.
 *
 * For each row the molecule comes from the row's KEY and the pubkey from
 * `expected`; the acceptor rebuilds the claim preimage from those two and the
 * offered head/prev/seq. Nothing is parsed out of the bytes, so a claim lifted
 * from another row — even one of this publisher's own — renders a string that
 * never verifies.
 *
 * FAILURE IS PER ROW. One cold atom yields one `hole` and the rest of the rows
 * still verify; collapsing that into a single boolean is how one unreachable
 * byte would make a whole publisher unverifiable.
 */
export const verifyHeadMapRows = async (
  record: HeadMapRecord,
  expected: string,
  readClaim: HeadMapClaimReader,
  accept: HeadMapAcceptor,
  readHead?: HeadMapHeadReader,
): Promise<HeadMapRowsVerdict> => {
  const fail = (reason: HeadMapReason): HeadMapRowsVerdict =>
    ({ rowsAuthentic: false, reason, verified: [], holes: [] })

  if (!record || record.kind !== HEAD_MAP_KIND || record.v !== HEAD_MAP_V1) return fail('malformed')
  if (!Array.isArray(record.rows) || !isHex64(record.pubkey)) return fail('malformed')
  try {
    encodeHeadMap(record)
  } catch (error) {
    return fail(error instanceof RangeError ? 'oversize' : 'malformed')
  }
  if (!isHex64(expected) || record.pubkey !== expected) return fail('forged')

  const verified: HeadMapRow[] = []
  const holes: HeadMapHole[] = []
  for (const [molecule, claim] of record.rows) {
    let read: HeadMapClaimRead | null = null
    try {
      read = await readClaim(claim)
    } catch {
      read = null
    }
    if (!read || !read.offered) {
      holes.push({ molecule, claim, reason: 'absent' })
      continue
    }
    // THE READER MUST SAY WHAT IT FETCHED. Silence is not consent: a reader
    // that does not report a signature has checked nothing the verifier can
    // rely on, and calling that verified is how a lying host went unnoticed.
    if (!isHex64(read.sig)) {
      holes.push({ molecule, claim, reason: 'unchecked' })
      continue
    }
    if (read.sig !== claim) {
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
    if (readHead) {
      let present = false
      try {
        present = (await readHead(read.offered.head)) === true
      } catch {
        present = false
      }
      if (!present) {
        holes.push({ molecule, claim, reason: 'head-absent' })
        continue
      }
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
    rowsAuthentic: holes.length === 0,
    reason: holes.length === 0 ? null : 'incomplete',
    verified,
    holes,
  }
}

/**
 * VERIFY A DEPLOY WITH NO DIRECTORY LISTING — the whole procedure, in one door.
 *
 * The documented recipe has five steps and the module used to implement three
 * of them, with no function anywhere that took a deploy SIGNATURE. That made
 * skipping step 1 an easy mistake and made the verdict for a fabricated set
 * byte-identical to the verdict for the truth. All of it lives here now:
 *
 *   0. `offer.sig` is a 64-hex address                      -> `malformed`
 *   1. `digest(offer.bytes) === offer.sig`                  -> `forged`
 *   2. refuse-or-parse the bytes            -> `oversize` / `malformed`
 *   3. `record.pubkey === expected`                         -> `forged`
 *   4. the publisher signed THIS SET                        -> `unattested`
 *   5. every row, from atoms fetched by signature      -> `incomplete`
 *
 * STEPS 3 AND 4 REFUSE BEFORE ANY FETCH. A map that is not this key's, or that
 * this key never assembled, is not worth a byte of anyone's bandwidth — the
 * same discipline that already refused a wrong `expected` before touching the
 * host.
 *
 * `ok` here means all five: attested, complete, and every row authentic. It is
 * the only field in this module that means that, and it exists only on this
 * verdict, so the weaker answer can never be mistaken for the stronger one.
 */
export const verifyDeploy = async (
  offer: HeadMapDeployOffer,
  expected: string,
  deps: HeadMapVerifyDeps,
): Promise<HeadMapDeployVerdict> => {
  const sig = typeof offer?.sig === 'string' ? offer.sig : ''
  const fail = (
    reason: HeadMapReason,
    record: HeadMapRecord | null = null,
    attested = false,
  ): HeadMapDeployVerdict =>
    ({ ok: false, attested, reason, sig, record, rowsAuthentic: false, verified: [], holes: [] })

  if (!offer || !isHex64(sig) || typeof offer.bytes !== 'string') return fail('malformed')
  if (!isHex64(expected)) return fail('forged')

  let digested: string
  try {
    digested = await deps.digest(offer.bytes)
  } catch {
    return fail('malformed')
  }
  // The bytes are not the ones named. A host answering a deploy address with
  // other bytes is lying, not cold, and this is where that is caught.
  if (digested !== sig) return fail('forged')

  const { record, refusal } = readHeadMap(offer.bytes)
  if (!record) return fail(refusal === 'oversize' ? 'oversize' : 'malformed')
  if (record.pubkey !== expected) return fail('forged', record)

  let attested = false
  if (typeof offer.attestation === 'string' && offer.attestation.length > 0) {
    try {
      attested = (await deps.verify(expected, headMapAttestationPreimage(expected, sig), offer.attestation)) === true
    } catch {
      attested = false
    }
  }
  // NOBODY SIGNED THIS SET. It may be every row of a real publisher and still
  // be a composition they never made — a truncation, an empty deploy, or a
  // cherry-picked mixture of generations. Refuse it as what it is, and refuse
  // it before spending a fetch on it.
  if (!attested) return fail('unattested', record)

  const rows = await verifyHeadMapRows(record, expected, deps.readClaim, deps.accept, deps.readHead)
  return {
    ok: rows.rowsAuthentic,
    attested: true,
    sig,
    record,
    rowsAuthentic: rows.rowsAuthentic,
    reason: rows.reason,
    verified: rows.verified,
    holes: rows.holes,
  }
}

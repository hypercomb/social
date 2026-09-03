// core/head-claim.ts
//
// THE BUCKET IS THE KEY; THE ADDRESS IS THE PREIMAGE.
//
// A molecule is a directory of per-author head buckets
// (`documentation/hypergraph-molecule-lineage.md`). Before this file, a bucket
// was placed by a field the succession atom DECLARED — `sign(succ.name)` for
// the molecule, `succ.author` for the bucket — so bytes served by a host chose
// which directory they landed in. An adversarial review of the prototype found
// that independently from four of five lenses: a served atom could plant a
// bucket inside a reserved system pool, forge a head under someone else's
// address, and blank a page for every cold visitor. It is a REMOTE WRITE
// PRIMITIVE.
//
// THE FIX, AND WHY IT IS ONE OPERATION RATHER THAN A CHECK.
//
// A reader ALWAYS knows two things before it sees a byte: the molecule it
// walked to, and the bucket directory name it listed. Those two values are the
// address it ASKED FOR. This module makes them the first two fields of the
// signed preimage, and the reader REBUILDS that preimage from them rather than
// parsing a location out of the bytes. A claim minted for another molecule, or
// for another key, therefore renders to a different string and fails to
// verify — even though it is perfectly well-formed and genuinely signed.
//
// There is no `declared === askedFor` comparison for a later refactor to
// delete, because nothing is declared. Placement authentication and signature
// authentication are the same call.
//
// ─── SECOND PASS (the authority review) ────────────────────────────────────
//
// Four independent lenses then attacked what that fix RESTS ON, and three of
// their findings are answered by ONE change of shape, so it is stated here
// once rather than buried in a branch:
//
//   AUTHENTICITY AND HEADSHIP ARE DIFFERENT QUESTIONS, AND THE ANSWER TO THE
//   FIRST IS WHAT A READER MAY KEEP.
//
// The first draft conflated them: an entry that failed the recency or the
// descent test was refused, and the caller threw the bytes away. That is what
// made a temporal replay permanent. A host that serves only generation 0 of a
// 70-generation chain forges nothing — every byte is genuinely signed by the
// author for this exact address — so on FIRST SIGHT there is nothing to be
// stale against and the reader adopts it. The real head then arrives, cannot
// prove descent across 69 hops, and is refused as a FORK: the victim ends up
// accusing the honest author of branching, forever.
//
// So the verdict now carries TWO bits, and every caller must read both:
//
//   `authentic` — the signature covers THIS address's preimage under THIS
//                 bucket's key. Bytes with this bit are the author's own and
//                 may be KEPT. Nothing else may be kept.
//   `ok`        — and it may become the head I hold RIGHT NOW.
//
// A reader that keeps every authentic entry and picks its head with
// `resolveBucketHead` is immune to the replay: the poisoned generation loses to
// the genuine one on the author's own signed counter the moment both are in
// hand, and having once seen the newer one it cannot be talked back down.
// Recency is settled by a total order over what the reader HOLDS, never by the
// order a host chose to answer in.
//
// The other two shape changes for the same review:
//
//   * `'unproven'` is now its OWN refusal. "I walked your chain and you
//     branched" is permanent and is an accusation; "I gave up walking" is
//     recoverable and says nothing about the author. Collapsing them into
//     `fork` is what turned a 65-edit absence into a permanent partition
//     between two honest peers. `chainContains` is a TRI-STATE for the same
//     reason — the caller is the only one who knows which of the two it saw.
//   * the idempotent re-offer runs AFTER the signature, not before it, so
//     `ok: true` can never be returned for bytes nobody verified.
//
// WHAT THIS MODULE DOES NOT DO. It hashes nothing (the head arrives as a sig
// already computed) and it verifies nothing itself: core has NO dependencies,
// and WebCrypto carries no secp256k1/schnorr, so the asymmetric primitive is
// INJECTED as `HeadClaimVerifier`. The essentials adapter satisfies it with
// nostr-tools; the runnable prototype satisfies it with node's ed25519. That
// the same acceptance rules serve both is the point of the seam.
//
// WHY THE INJECTED VERIFIER TAKES A STRING, NOT BYTES. A NIP-07 extension
// signs only a nostr event `{kind, created_at, tags, content}` with `content` a
// STRING, and the schnorr signature covers the NIP-01 event id — never an
// application-chosen byte string. So the preimage rides VERBATIM as the event
// `content`, and the adapter's verifier asserts the event's declared pubkey is
// the bucket, its content is the rebuilt preimage, and only then runs the
// curve maths. `hypercomb-essentials/src/sharing/hive-pointer.ts` already does
// exactly this for the hive index: it is the pubkey/content comparison, not
// the signature check, that closes the hole — `verifyEvent` alone proves only
// that an event is consistent under the key the EVENT declares.

/** A 64-hex lowercase address: a molecule, a public key, or an atom. */
const HEX64 = /^[0-9a-f]{64}$/

/** Domain + version tag. Line one of every preimage. */
export const HEAD_CLAIM_V1 = 'hc:molecule-head:v1'

/** The genesis marker in the `prev` line. A hex address can never equal it. */
export const HEAD_CLAIM_GENESIS = '-'

/**
 * The address a reader ASKED FOR. Both fields come from the directory walk —
 * the molecule it routed to, and the bucket name it listed. NEVER from bytes.
 */
export interface HeadClaimAddress {
  /** 64-hex lowercase: the molecule directory. */
  readonly molecule: string
  /** 64-hex lowercase: the bucket directory name, AND the verifying key. */
  readonly pubkey: string
}

/**
 * What one head entry offers.
 *
 * NOTE WHAT IS ABSENT: no `name`, no `author`, no `molecule`. A head claim does
 * not declare its own location, because location is not a property of bytes.
 */
export interface OfferedHeadClaim {
  /** 64-hex: the succession atom's content signature. */
  readonly head: string
  /** 64-hex predecessor, or `null` for genesis. */
  readonly prev: string | null
  /** Monotone per-bucket counter. 0 iff `prev` is null. Never a clock. */
  readonly seq: number
  /** The detached signature over the preimage (hex; length is the verifier's business). */
  readonly sig: string
}

/** A claim that has been accepted into a bucket — what `resolveBucketHead` ranks. */
export interface HeldHeadClaim {
  readonly head: string
  readonly prev: string | null
  readonly seq: number
}

/**
 * THE INJECTED VERIFIER. Returns true ONLY if `pubkeyHex` signed EXACTLY
 * `preimage` producing `sigHex`. It must not parse the preimage, must not
 * accept a prefix, and must not trust any identity carried inside `sigHex`'s
 * envelope without comparing it to `pubkeyHex`.
 */
export type HeadClaimVerifier = (
  pubkeyHex: string,
  preimage: string,
  sigHex: string,
) => boolean | Promise<boolean>

/**
 * THE ANSWER TO "does the offered chain contain the head I hold?", as a
 * TRI-STATE. The two false-ish answers mean opposite things and only the
 * caller can tell them apart:
 *
 *   `true`        — I walked it and your chain descends from mine. Accept.
 *   `false`       — I walked it to its genesis and it does not. A real branch.
 *   `'unproven'`  — I ran out of budget, or an atom did not arrive. This says
 *                   NOTHING about the author, and must never be reported as a
 *                   fork: a bounded walk is a property of MY patience, and a
 *                   peer 65 ordinary edits behind is not an attacker.
 */
export type ChainDescent = true | false | 'unproven'

export type HeadClaimRefusal =
  /** Shape: a field is not the alphabet it must be. */
  | 'malformed'
  /** The signature does not cover THIS address's preimage under THIS bucket's key. */
  | 'unsigned'
  /** `seq` is behind the claim already held, and the head differs. */
  | 'stale'
  /** A DIFFERENT head at the SAME seq under the same key: a same-generation sibling. */
  | 'rival'
  /** The author branched: the incoming chain provably does not contain the head I hold. */
  | 'fork'
  /** I could not PROVE descent either way. Recoverable; never an accusation. */
  | 'unproven'

/**
 * THREE BITS, AND A CALLER ACTS ON `keep`.
 *
 * `ok`         — this claim may be what I hold RIGHT NOW.
 * `authentic`  — FACT: these exact bytes carry a valid signature by the key
 *                that names this bucket, over this molecule. False only for
 *                `malformed` and `unsigned`.
 * `keep`       — POLICY, and the only bit a storage caller needs: are these
 *                bytes a legitimate candidate to sit in this bucket?
 *
 * `keep` and `authentic` differ on exactly one verdict, and the difference is
 * the whole argument:
 *
 *   `stale` / `unproven` / `rival`  authentic AND kept. These are the author's
 *       own history, and DISCARDING them is what let a host pin a reader to
 *       whichever generation it chose to answer with: a replayed generation 0
 *       was adopted on first sight, and the real head — arriving later, unable
 *       to prove descent — was thrown away. Kept, they are ranked by
 *       `resolveBucketHead` and the newest signed counter wins from then on.
 *
 *   `fork`  authentic and NOT kept. Descent was DISPROVEN, not merely
 *       unproven: the walk reached genesis and what I hold is not on that
 *       chain. History never branches, so this is refused rather than ranked —
 *       and refusing it must cost the reader nothing, which is why nothing is
 *       stored and no closure is fetched for it.
 */
export type HeadClaimVerdict =
  | { readonly ok: true; readonly authentic: true; readonly keep: true; readonly claim: HeldHeadClaim; readonly unchanged: boolean }
  | { readonly ok: false; readonly authentic: boolean; readonly keep: boolean; readonly reason: HeadClaimRefusal; readonly detail?: string }

export interface HeadClaimContext {
  /** The claim currently resolved for THIS bucket, or null when it is empty. */
  readonly held?: HeldHeadClaim | null
  /**
   * Walk `prev` from `from` looking for `target`. `prev` is a REFERENT
   * (`core/edge-registry.ts`) — never a closure edge — so this walk is
   * DELIBERATE and bounded by the caller, which is why its "no" is a TRI-STATE
   * (`ChainDescent`): only the caller knows whether it disproved descent or
   * merely ran out of road.
   */
  readonly chainContains?: (from: string, target: string) => ChainDescent | Promise<ChainDescent>
}

const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v)

const isSeq = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/**
 * THE EXACT BYTES THAT GET SIGNED. Six lines, joined by `\n`, no trailing
 * newline:
 *
 *     hc:molecule-head:v1
 *     <molecule>          64 lowercase hex — the directory the reader walked to
 *     <pubkey>            64 lowercase hex — the bucket name AND the key
 *     <head>              64 lowercase hex — the succession atom
 *     <prev | "-">        64 lowercase hex, or "-" for genesis
 *     <seq>               decimal, no leading zeros, no sign
 *
 * Every field is hex, `-`, or digits, so no field can contain the delimiter and
 * no escaping rule can ever be needed. There is exactly one encoding — nothing
 * to canonicalize, nothing for a signer and a verifier to disagree about. This
 * is deliberately NOT canonical JSON: the string must survive verbatim inside a
 * nostr event's `content`, and a serializer both sides must agree on
 * byte-for-byte is a second thing to get wrong.
 *
 * Line 1 is domain separation: the same key already signs hive indexes (kind
 * 30564) and NIP-98 headers (kind 27235), and a harvested signature from either
 * can never be reinterpreted as a head claim. The version digit lets a `:v2`
 * exist while a `:v1` verifier REFUSES rather than mis-parses.
 *
 * Line 4 is a content address, so the signature commits transitively to the
 * succession's members, hidden set and prev. Line 5 puts the chain link inside
 * the signature so a genuine head cannot be re-parented. Line 6 is the only
 * recency axis available: a signature proves authorship and NEVER recency.
 */
export const headClaimPreimage = (
  molecule: string,
  pubkey: string,
  head: string,
  prev: string | null,
  seq: number,
): string =>
  [
    HEAD_CLAIM_V1,
    molecule,
    pubkey,
    head,
    prev ?? HEAD_CLAIM_GENESIS,
    String(seq),
  ].join('\n')

/**
 * Split a preimage back into its parts. Returns null unless the string is
 * EXACTLY the canonical v1 form — a trailing newline, a wrong field alphabet,
 * a leading zero in `seq`, or a `:v2` tag all refuse rather than mis-parse.
 *
 * This exists for the TRANSPORT (recovering `head`/`prev`/`seq` out of a signed
 * envelope so they can be offered), for DIAGNOSTICS (reporting which address a
 * refused claim was signed for), and as the SHAPE GATE THE MINT PATH OWES: a
 * writer that can sign bytes no reader can parse is a strictly weaker gate than
 * the reader, and under new-before-old publishing it would prune a live head in
 * favour of a dead one.
 */
export const parseHeadClaimPreimage = (
  content: string,
): { molecule: string; pubkey: string; head: string; prev: string | null; seq: number } | null => {
  if (typeof content !== 'string') return null
  const lines = content.split('\n')
  if (lines.length !== 6) return null
  const [tag, molecule, pubkey, head, prev, seq] = lines as [
    string, string, string, string, string, string,
  ]
  if (tag !== HEAD_CLAIM_V1) return null
  if (!isHex64(molecule) || !isHex64(pubkey) || !isHex64(head)) return null
  if (prev !== HEAD_CLAIM_GENESIS && !isHex64(prev)) return null
  if (!/^(0|[1-9][0-9]*)$/.test(seq)) return null
  const n = Number(seq)
  if (!isSeq(n)) return null
  // Genesis is exactly seq 0, and seq 0 is exactly genesis. Anything else is a
  // claim whose counter and chain link disagree — refuse rather than choose.
  if ((prev === HEAD_CLAIM_GENESIS) !== (n === 0)) return null
  return { molecule, pubkey, head, prev: prev === HEAD_CLAIM_GENESIS ? null : prev, seq: n }
}

/**
 * THE ONE DOOR. `address` is argument one and has no default: a caller cannot
 * ask "is this claim good?" without saying where it came from.
 *
 * Order is shape, then crypto ONCE, then policy:
 *
 *   0. shape          — pure, local, no I/O
 *   1. signature      — the single expensive call; also the placement check.
 *                       IT RUNS BEFORE EVERY POLICY BRANCH so that the
 *                       `authentic` bit is never a guess and `ok: true` is
 *                       never returned for bytes nobody checked. The first
 *                       draft short-circuited an already-held head ahead of
 *                       this and answered `ok: true` for a claim signed by
 *                       nobody, at an address nobody signed for.
 *   2. re-offer       — the head I already hold; a no-op
 *   3. staleness      — the ONE thing a signature provably cannot supply
 *   4. descent        — state-dependent, meaningful only once authorship is
 *                       proven, and only reached when the offered counter is
 *                       strictly ahead
 *
 * Because the signature runs first, a hostile host cannot induce prev-walking
 * by serving junk: junk costs one verify and stops.
 */
export const acceptHeadClaim = async (
  address: HeadClaimAddress,
  offered: OfferedHeadClaim,
  verify: HeadClaimVerifier,
  context: HeadClaimContext = {},
): Promise<HeadClaimVerdict> => {
  // ── 0. SHAPE ────────────────────────────────────────────────────────────
  // Compared, never rewritten. `SIGNATURE_NAME` in core/directory-safety.ts is
  // case-INSENSITIVE, so a host may serve an uppercase-hex bucket name; if we
  // lowercased it here we would verify one address and write to another.
  // Refuse instead — never rewrite an address you asked for.
  const malformed = (detail: string): HeadClaimVerdict =>
    ({ ok: false, authentic: false, keep: false, reason: 'malformed', detail })

  if (!address || !isHex64(address.molecule) || !isHex64(address.pubkey)) {
    return malformed('address is not two lowercase 64-hex names')
  }
  if (!offered || !isHex64(offered.head)) {
    return malformed('head is not a lowercase 64-hex signature')
  }
  if (offered.prev !== null && !isHex64(offered.prev)) {
    return malformed('prev is neither null nor a lowercase 64-hex signature')
  }
  if (!isSeq(offered.seq)) {
    return malformed('seq is not a non-negative safe integer')
  }
  if ((offered.prev === null) !== (offered.seq === 0)) {
    return malformed('seq 0 and genesis must agree')
  }
  if (typeof offered.sig !== 'string' || !/^[0-9a-f]{2,512}$/.test(offered.sig)) {
    return malformed('sig is not lowercase hex')
  }

  // ── 1. SIGNATURE (and, by construction, PLACEMENT) ──────────────────────
  // Note every argument: the key is `address.pubkey`, and the preimage's
  // molecule and pubkey are `address.*`. Nothing offered by the bytes chooses
  // either, so a claim minted for another molecule or another key renders to a
  // string this call never sees.
  const preimage = headClaimPreimage(
    address.molecule,
    address.pubkey,
    offered.head,
    offered.prev,
    offered.seq,
  )
  let signed = false
  try {
    signed = (await verify(address.pubkey, preimage, offered.sig)) === true
  } catch {
    signed = false
  }
  if (!signed) {
    return {
      ok: false,
      authentic: false,
      keep: false,
      reason: 'unsigned',
      detail: 'no valid signature by the bucket key over this address',
    }
  }

  // Everything below this line is policy over bytes we have PROVEN are the
  // bucket owner's, so every refusal from here carries `authentic: true`.
  const held = context.held ?? null

  // ── 2. IDEMPOTENT RE-OFFER ──────────────────────────────────────────────
  if (held && held.head === offered.head) {
    return {
      ok: true,
      authentic: true,
      keep: true,
      claim: { head: held.head, prev: held.prev, seq: held.seq },
      unchanged: true,
    }
  }

  if (!held) {
    // FIRST SIGHT. There is no fork to refuse and nothing to be stale against,
    // so this is accepted on its own merits — and, crucially, a caller that
    // KEEPS every authentic entry is not stuck with it: the moment a
    // higher-seq entry from the same key arrives, `resolveBucketHead` ranks
    // over both. An unknown key is filed in its own bucket and touches nobody
    // else's, so a bucket is never an allowlist.
    return {
      ok: true,
      authentic: true,
      keep: true,
      claim: { head: offered.head, prev: offered.prev, seq: offered.seq },
      unchanged: false,
    }
  }

  // ── 3. STALENESS ────────────────────────────────────────────────────────
  // A signature proves authorship and NEVER recency, so a host replaying a
  // genuinely-signed older head of mine is stopped HERE and nowhere else. `seq`
  // rather than a wall clock: it needs no clock to be right, cannot be raised
  // without the secret, and a mis-clocked device can never set a permanent
  // freshness floor against its own bucket.
  if (offered.seq < held.seq) {
    return {
      ok: false,
      authentic: true,
      keep: true,
      reason: 'stale',
      detail: `seq ${offered.seq} is behind held seq ${held.seq}`,
    }
  }

  // ── 4. DESCENT ──────────────────────────────────────────────────────────
  // History never branches. Two of the three cases need NO walk at all:
  //
  //   equal seq, different head — two chains of the same LENGTH, so neither
  //       can contain the other. This is a `rival`, not a `fork`, and the
  //       distinction is the difference between a page that converges and one
  //       that does not. Only the bucket's own key can produce it (a crash
  //       between the write and the sibling sweep, or two devices sharing one
  //       identity), neither sibling is "later" by any evidence that exists,
  //       and the ONLY convergent answer is the total order in
  //       `resolveBucketHead`. So it is KEPT and ranked. Refusing it outright
  //       is what left two readers of one author on two different heads
  //       forever, decided by which entry each happened to meet first.
  //
  //   prev === held.head        — the direct child. PROVABLE descent, no fetch.
  //
  // Only a gap of two or more generations needs the walk, and there the
  // caller's tri-state decides between an accusation and a shrug.
  if (offered.seq === held.seq) {
    return {
      ok: false,
      authentic: true,
      keep: true,
      reason: 'rival',
      detail: `incoming ${offered.head} is a same-generation sibling at seq ${offered.seq}`,
    }
  }
  if (offered.prev !== held.head) {
    const walk = context.chainContains
    const descent: ChainDescent = walk ? await walk(offered.head, held.head) : 'unproven'
    if (descent !== true) {
      return {
        ok: false,
        authentic: true,
        // A DISPROVEN branch is refused AND dropped; an UNPROVEN one is kept
        // and ranked, because "I ran out of road" is not evidence about the
        // author and must never strand a reader on an older generation.
        keep: descent !== false,
        reason: descent === false ? 'fork' : 'unproven',
        detail: `incoming ${offered.head} ${descent === false ? 'does not chain onto' : 'could not be proven to chain onto'} held ${held.head}`,
      }
    }
  }

  return {
    ok: true,
    authentic: true,
    keep: true,
    claim: { head: offered.head, prev: offered.prev, seq: offered.seq },
    unchanged: false,
  }
}

/**
 * WHICH OF A BUCKET'S ENTRIES IS THE HEAD — and, since the authority review,
 * THE ONLY THING THAT ANSWERS THAT QUESTION on a read path.
 *
 * The prototype's first rule was "a bucket with anything but exactly one file
 * is skipped entirely", which turned any second entry into a total page
 * blackout. The second was "accept one entry and delete its siblings", which
 * made this function's own documented convergence false — two readers who met
 * the same author's two entries in a different order ended up on different
 * heads forever, and a reader hard-deleted bytes it did not write.
 *
 * The rule now is: KEEP EVERY AUTHENTIC ENTRY, RANK THEM HERE. Highest `seq`
 * wins, ties broken by the lexicographically smallest head signature. That
 * order is total, deterministic and reader-derived, so every reader on every
 * host converges on the same head and a cold rebuild stays independent of
 * listing order — and a reader that has once seen generation 69 can never be
 * talked back down to generation 0 by a host that serves only the latter.
 *
 * The loser is NEVER deleted, here or by any caller: it is signed history.
 */
export const resolveBucketHead = <T extends HeldHeadClaim>(claims: readonly T[]): T | null => {
  let best: T | null = null
  for (const c of claims) {
    if (!c || !isHex64(c.head) || !isSeq(c.seq)) continue
    if (!best) { best = c; continue }
    if (c.seq > best.seq) { best = c; continue }
    if (c.seq === best.seq && c.head < best.head) best = c
  }
  return best
}

/**
 * WHAT MY NEXT CLAIM MUST CARRY — the anti-rollback rule for MY OWN bucket.
 *
 * `seq` is signed and cannot be raised without the secret, which is what makes
 * it a sound anti-replay counter for OTHER people's buckets. For my own it has
 * the opposite exposure, and no attacker is required to reach it: `held` is
 * rebuilt FROM A HOST, so a host that is merely BEHIND — it has my atoms and my
 * genesis entry but missed my last two pushes — hands me a counter of 0 when I
 * had signed up to 2. My next commit then signs seq 1 with genesis as its
 * parent, and every peer holding my real chain refuses it: first as `stale`,
 * then, once I have committed past them, as `fork`. Nothing reports it and my
 * own page renders perfectly.
 *
 * `minted` is the defence: a LOCAL, NEVER-REPLICATED record of the last claim
 * this instance actually signed for this molecule. It belongs beside the KEY
 * (the same store the secret lives in), not in the replicated content tree,
 * precisely so it survives the accidents the key survives — an OPFS eviction,
 * a partial "clear site data", a restore from a folder backup.
 *
 * The plan is the STRONGER of the two, with my own record winning ties: a
 * remote can move me forward (a second device of mine that really did commit)
 * but can never move me back.
 */
export const planHeadClaim = (
  held: HeldHeadClaim | null | undefined,
  minted: HeldHeadClaim | null | undefined,
): { prev: string | null; seq: number } => {
  const h = held && isHex64(held.head) && isSeq(held.seq) ? held : null
  const m = minted && isHex64(minted.head) && isSeq(minted.seq) ? minted : null
  const base = !h ? m : !m ? h : m.seq >= h.seq ? m : h
  return base ? { prev: base.head, seq: base.seq + 1 } : { prev: null, seq: 0 }
}

/**
 * DOES THE ATOM THIS CLAIM NAMES BELONG TO THE BUCKET THAT CLAIMS IT?
 *
 * Deleting `name` and `author` from the succession atom closed placement — and
 * left the atom bound to NOTHING. A head claim binds (molecule, pubkey, head),
 * so TWO different keys can each mint a perfectly valid claim naming the SAME
 * succession: every field in both preimages is true. A stranger who grinds
 * keypairs until theirs sorts first then takes the byline for every row on the
 * page, on every reader, deterministically — and content-addressed dedup makes
 * the theft invisible, because the rows are byte-identical and only the author
 * changed. That matters directly to attributing work to a participant.
 *
 * So the atom names its SIGNER, and this compares that field with the bucket
 * the reader walked to. Note the difference from what was deleted: `signer` is
 * never a path segment and never chooses anything — it is checked against an
 * address that is already authenticated, which is exactly why the check is safe
 * now and was not before. A mismatch is not an error in the claim; it means the
 * claim adopts someone else's work, and the atom is refused for THIS bucket.
 */
export const headClaimAuthors = (address: HeadClaimAddress, signer: unknown): boolean =>
  !!address && isHex64(address.pubkey) && isHex64(signer) && signer === address.pubkey

/** The longest byte string this treats as a possible name / meaning. */
export const ADDRESS_PREIMAGE_MAX_BYTES = 256

/**
 * COULD THESE BYTES BE THE PREIMAGE OF A DIRECTORY ADDRESS?
 *
 * The content root is one flat namespace with one alphabet: `<root>/<sig>` is a
 * content atom when it is a FILE and a molecule, pool or bag when it is a
 * DIRECTORY — the ENTRY decides (`classifyDirectoryEntry`). A content address
 * is sha256(bytes); a molecule address is sha256(canonical name) and a pool
 * address is sha256(meaning). Nobody can find a hash collision — but nobody
 * needs one, because those two preimages are SHORT, PUBLIC STRINGS. A remote
 * that wants a file planted at `sign('bees')` simply serves the four bytes
 * `bees` and lets the content-addressed fetcher do the writing: sha256(bytes)
 * really does equal the name, which is the whole trick. In OPFS a file and a
 * directory cannot share a name, so one served page can permanently prevent the
 * drone-bundle pool from ever being created.
 *
 * A blocklist cannot answer this — a molecule address is any word any
 * participant ever typed. The BYTES can: every directory preimage this system
 * mints is a canonical name or a pool meaning, and both are drawn from letters,
 * digits, `-` and `:` (canonicalization replaces every other run with a
 * hyphen). So a fetcher refuses to store any replicated body that could be one.
 * The refusal is conservative in the safe direction and costs nothing: such a
 * body is a handful of bytes and is trivially reconstructible.
 *
 * THIS IS A GATE, NOT THE CURE. The cure is domain separation on the ADDRESS
 * (sign a tagged preimage for content, exactly as line 1 of `headClaimPreimage`
 * does for signatures) or moving content one level below the root — and both
 * change or relocate every signature in every existing hive, so both belong to
 * a forward migration, not here. What this closes is every address the system
 * actually mints, which is every address an attacker can name.
 */
export const looksLikeAddressPreimage = (bytes: { readonly length: number; readonly [i: number]: number } | null | undefined): boolean => {
  if (!bytes || typeof bytes.length !== 'number') return false
  if (bytes.length > ADDRESS_PREIMAGE_MAX_BYTES) return false
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    // >= 0x80 is a UTF-8 lead or continuation byte: canonicalization preserves
    // letters and digits of EVERY script, so a name may be entirely non-ASCII.
    if (b >= 0x80) continue
    if (b >= 0x30 && b <= 0x39) continue // 0-9
    if (b >= 0x41 && b <= 0x5a) continue // A-Z
    if (b >= 0x61 && b <= 0x7a) continue // a-z
    if (b === 0x2d || b === 0x3a) continue // '-' and the ':' of a scoped meaning
    return false
  }
  return true
}

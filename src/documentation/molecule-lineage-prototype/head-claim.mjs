// head-claim.mjs — a faithful mirror of
// `hypercomb-core/src/core/head-claim.ts`, the way canon.mjs mirrors
// hypercomb-essentials/src/history/lineage-key.ts.
//
// Same preimage string, same acceptance ORDER, same refusal names, same
// two-bit verdict. The ONE difference is that this is synchronous: node's
// ed25519 verify is sync, while WebCrypto and a NIP-07 extension are not.
// Nothing about placement depends on that.
//
// THE RULE, IN ONE SENTENCE: the reader RENDERS the preimage from the address
// it asked for — the molecule it walked to, the bucket directory it listed —
// and requires the offered signature to cover exactly that string. A claim
// minted for another molecule or another key renders to a different string and
// fails. Placement authentication and signature authentication are one call, so
// there is no `declared === askedFor` comparison for anyone to forget.
//
// AND, SINCE THE AUTHORITY REVIEW: authenticity and headship are different
// questions. `authentic` is the KEEP bit (these bytes are the bucket owner's);
// `ok` is the HEAD bit (they may be what I hold right now). A reader that keeps
// every authentic entry and ranks with `resolveBucketHead` cannot be pinned to
// an old generation by a host that serves only that one.

const HEX64 = /^[0-9a-f]{64}$/

export const HEAD_CLAIM_V1 = 'hc:molecule-head:v1'
export const HEAD_CLAIM_GENESIS = '-'

const isHex64 = (v) => typeof v === 'string' && HEX64.test(v)
const isSeq = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** The EXACT bytes. Six lines, `\n`-joined, no trailing newline. */
export const headClaimPreimage = (molecule, pubkey, head, prev, seq) =>
  [HEAD_CLAIM_V1, molecule, pubkey, head, prev ?? HEAD_CLAIM_GENESIS, String(seq)].join('\n')

/** Recover the parts of a canonical v1 preimage, or null. Never used for placement. */
export const parseHeadClaimPreimage = (content) => {
  if (typeof content !== 'string') return null
  const lines = content.split('\n')
  if (lines.length !== 6) return null
  const [tag, molecule, pubkey, head, prev, seq] = lines
  if (tag !== HEAD_CLAIM_V1) return null
  if (!isHex64(molecule) || !isHex64(pubkey) || !isHex64(head)) return null
  if (prev !== HEAD_CLAIM_GENESIS && !isHex64(prev)) return null
  if (!/^(0|[1-9][0-9]*)$/.test(seq)) return null
  const n = Number(seq)
  if (!isSeq(n)) return null
  if ((prev === HEAD_CLAIM_GENESIS) !== (n === 0)) return null
  return { molecule, pubkey, head, prev: prev === HEAD_CLAIM_GENESIS ? null : prev, seq: n }
}

/**
 * THE ONE DOOR. `address` is argument one and has no default.
 * Order: shape -> SIGNATURE -> re-offer -> staleness -> descent.
 *
 * The signature runs before every policy branch so that `authentic` is never a
 * guess and `ok:true` is never returned for bytes nobody checked.
 */
export const acceptHeadClaim = (address, offered, verify, context = {}) => {
  const malformed = (detail) => ({ ok: false, authentic: false, keep: false, reason: 'malformed', detail })
  // `keep` is the POLICY bit a storage caller acts on; `authentic` is the FACT.
  // They differ on exactly one verdict — a DISPROVEN fork, which is refused and
  // dropped, while `stale` / `unproven` / `rival` are the author's own history
  // and are kept so `resolveBucketHead` can rank them.
  const refuse = (reason, detail) => ({ ok: false, authentic: true, keep: reason !== 'fork', reason, detail })

  // 0. SHAPE. Compared, never rewritten — a host may serve an uppercase-hex
  // bucket name, and lowercasing it here would verify one address and write to
  // another.
  if (!address || !isHex64(address.molecule) || !isHex64(address.pubkey)) {
    return malformed('address is not two lowercase 64-hex names')
  }
  if (!offered || !isHex64(offered.head)) return malformed('head is not 64-hex')
  if (offered.prev !== null && !isHex64(offered.prev)) return malformed('prev is not 64-hex or null')
  if (!isSeq(offered.seq)) return malformed('seq is not a non-negative safe integer')
  if ((offered.prev === null) !== (offered.seq === 0)) return malformed('seq 0 and genesis must agree')
  if (typeof offered.sig !== 'string' || !/^[0-9a-f]{2,512}$/.test(offered.sig)) {
    return malformed('sig is not lowercase hex')
  }

  // 1. SIGNATURE — and, by construction, PLACEMENT. Every argument comes from
  // `address`, which the reader built from its own walk.
  const preimage = headClaimPreimage(
    address.molecule, address.pubkey, offered.head, offered.prev, offered.seq,
  )
  let signed = false
  try {
    signed = verify(address.pubkey, preimage, offered.sig) === true
  } catch {
    signed = false
  }
  if (!signed) {
    return { ok: false, authentic: false, keep: false, reason: 'unsigned', detail: 'no valid signature by the bucket key over this address' }
  }

  const held = context.held ?? null
  const accept = (claim, unchanged) => ({ ok: true, authentic: true, keep: true, claim, unchanged })

  // 2. IDEMPOTENT RE-OFFER — a re-served copy of what I hold is a no-op.
  if (held && held.head === offered.head) {
    return accept({ head: held.head, prev: held.prev, seq: held.seq }, true)
  }

  // FIRST SIGHT — nothing to be stale against and no fork to refuse. Safe only
  // because an authentic entry is KEPT: a higher-seq entry from the same key
  // outranks this one the moment it arrives.
  if (!held) return accept({ head: offered.head, prev: offered.prev, seq: offered.seq }, false)

  // 3. STALENESS — the one thing a signature provably cannot supply.
  if (offered.seq < held.seq) return refuse('stale', `seq ${offered.seq} is behind held seq ${held.seq}`)

  // 4. DESCENT. Equal seq with a different head is a same-generation SIBLING —
  // two chains of the same length, neither "later" by any evidence that
  // exists — so it is a `rival`: kept and RANKED, never refused outright.
  // Refusing it is what left two readers of one author on two different heads
  // forever, decided by which entry each happened to meet first.
  // `prev === held.head` is PROVABLE descent. Only a gap of two or more
  // generations needs the walk, and there the caller's TRI-STATE decides
  // between an accusation and a shrug.
  if (offered.seq === held.seq) {
    return refuse('rival', `incoming ${offered.head} is a same-generation sibling at seq ${offered.seq}`)
  }
  if (offered.prev !== held.head) {
    const walk = context.chainContains
    const descent = walk ? walk(offered.head, held.head) : 'unproven'
    if (descent !== true) {
      return refuse(
        descent === false ? 'fork' : 'unproven',
        `incoming ${offered.head} ${descent === false ? 'does not chain onto' : 'could not be proven to chain onto'} held ${held.head}`,
      )
    }
  }

  return accept({ head: offered.head, prev: offered.prev, seq: offered.seq }, false)
}

/**
 * Which of a bucket's entries is the head: highest seq, ties broken by the
 * lexicographically smallest head sig. Total, deterministic, reader-derived —
 * so a cold rebuild converges on every host regardless of listing order.
 *
 * This is now the ONLY thing that answers "which head?" on a read path. The
 * first rule was `if (files.length !== 1) continue`, which turned any second
 * entry into a page blackout. The second was "accept one and delete its
 * siblings", which made the convergence claim false and hard-deleted bytes the
 * reader did not write. Keep every authentic entry; rank them here.
 */
export const resolveBucketHead = (claims) => {
  let best = null
  for (const c of claims) {
    if (!c || !isHex64(c.head) || !isSeq(c.seq)) continue
    if (!best) { best = c; continue }
    if (c.seq > best.seq) { best = c; continue }
    if (c.seq === best.seq && c.head < best.head) best = c
  }
  return best
}

/**
 * What my NEXT claim must carry. The stronger of what the bucket holds and what
 * I last minted LOCALLY, my own record winning ties — so a host that is merely
 * behind can move me forward but can never move me back.
 */
export const planHeadClaim = (held, minted) => {
  const h = held && isHex64(held.head) && isSeq(held.seq) ? held : null
  const m = minted && isHex64(minted.head) && isSeq(minted.seq) ? minted : null
  const base = !h ? m : !m ? h : m.seq >= h.seq ? m : h
  return base ? { prev: base.head, seq: base.seq + 1 } : { prev: null, seq: 0 }
}

/** Does the atom this claim names name THIS bucket as its signer? */
export const headClaimAuthors = (address, signer) =>
  !!address && isHex64(address.pubkey) && isHex64(signer) && signer === address.pubkey

export const ADDRESS_PREIMAGE_MAX_BYTES = 256

/**
 * Could these bytes be the PREIMAGE OF A DIRECTORY ADDRESS — a canonical tile
 * name, or a pool meaning? Both alphabets are letters, digits, '-' and ':'.
 * A replicated body that could be one is never stored, because storing it
 * would plant a FILE at a name that must be able to become a DIRECTORY.
 */
export const looksLikeAddressPreimage = (bytes) => {
  if (!bytes || typeof bytes.length !== 'number') return false
  if (bytes.length > ADDRESS_PREIMAGE_MAX_BYTES) return false
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b >= 0x80) continue                 // any script's letters
    if (b >= 0x30 && b <= 0x39) continue    // 0-9
    if (b >= 0x41 && b <= 0x5a) continue    // A-Z
    if (b >= 0x61 && b <= 0x7a) continue    // a-z
    if (b === 0x2d || b === 0x3a) continue  // '-' ':'
    return false
  }
  return true
}

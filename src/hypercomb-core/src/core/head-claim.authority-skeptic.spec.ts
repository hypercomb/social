// head-claim.authority-skeptic.spec.ts — ADVERSARIAL, lens: REPLAY + SUBSTITUTION.
//
// Companion to `documentation/molecule-lineage-prototype/authority-skeptic-0.test.mjs`,
// run against the SHIPPING module rather than its prototype mirror, so the two
// findings that live in core are pinned to the real bytes.
//
// Convention, as in the skeptic-* prototype files: unless a case says (HOLDS),
// a PASS means the defect is reproduced.
//
// STATUS AFTER THE FIX PASS: both defects this file found are CLOSED, and each
// has been INVERTED IN PLACE rather than deleted — the attack is identical, the
// assertion is the opposite, so a regression in either fix fails here first.

import { describe, expect, it, vi } from 'vitest'
import {
  acceptHeadClaim,
  headClaimPreimage,
  resolveBucketHead,
  type HeadClaimVerifier,
} from './head-claim.js'

const MOL = 'a'.repeat(64)
const PUBKEY = 'b'.repeat(64)
const HEAD = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)

/** A verifier that accepts exactly one (key, preimage, sig) triple. */
const only = (key: string, preimage: string, sig: string): HeadClaimVerifier =>
  (k, p, s) => k === key && p === preimage && s === sig

describe('replay + substitution against acceptHeadClaim', () => {
  it('(HOLDS) a genuine claim is inert at every other molecule and every other key', async () => {
    const preimage = headClaimPreimage(MOL, PUBKEY, HEAD, null, 0)
    const verify = only(PUBKEY, preimage, 'ab'.repeat(32))
    const offered = { head: HEAD, prev: null, seq: 0, sig: 'ab'.repeat(32) }

    expect((await acceptHeadClaim({ molecule: MOL, pubkey: PUBKEY }, offered, verify)).ok).toBe(true)

    for (const address of [
      { molecule: OTHER, pubkey: PUBKEY },   // another molecule (a system pool included)
      { molecule: MOL, pubkey: OTHER },      // another key's bucket
    ]) {
      const v = await acceptHeadClaim(address, offered, verify)
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.reason).toBe('unsigned')
    }
  })

  it('(HOLDS) a genuinely-signed OLDER head is refused once something newer is held', async () => {
    const preimage = headClaimPreimage(MOL, PUBKEY, HEAD, null, 0)
    const verify = only(PUBKEY, preimage, 'ab'.repeat(32))
    const v = await acceptHeadClaim(
      { molecule: MOL, pubkey: PUBKEY },
      { head: HEAD, prev: null, seq: 0, sig: 'ab'.repeat(32) },
      verify,
      { held: { head: OTHER, prev: null, seq: 7 } },
    )
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toBe('stale')
  })

  it('(FIXED, was a blocker) a replayed old head is still adopted on first sight — but is now REVISABLE', async () => {
    // THE ATTACK IS UNCHANGED. A bucket the reader has never seen: `held` is
    // null, so staleness — the only defence against a temporal replay — cannot
    // run, and the host picks which of the author's genuinely-signed
    // generations the reader adopts. That FIRST step is irreducible: nothing in
    // one bucket read can say "this is the latest thing that key signed".
    //
    // WHAT CHANGED IS THE SECOND STEP, which is what made it a blocker. The
    // real head used to arrive, fail to prove descent across 900 hops, be
    // refused as a FORK — an accusation against the honest author — and be
    // THROWN AWAY. The downgrade was then permanent, defended forever by the
    // very rule step 3 had added.
    const genesisPre = headClaimPreimage(MOL, PUBKEY, HEAD, null, 0)
    const truePre = headClaimPreimage(MOL, PUBKEY, OTHER, 'e'.repeat(64), 900)
    const verify: HeadClaimVerifier = (k, p, s) =>
      k === PUBKEY && ((p === genesisPre && s === 'a'.repeat(64)) || (p === truePre && s === 'b'.repeat(64)))

    const adopted = await acceptHeadClaim(
      { molecule: MOL, pubkey: PUBKEY },
      { head: HEAD, prev: null, seq: 0, sig: 'a'.repeat(64) },
      verify,
      { held: null },
    )
    expect(adopted.ok).toBe(true) // still indistinguishable from the truth...

    // ...and now recoverable. A walker that GIVES UP says 'unproven', which is
    // KEPT and ranked rather than discarded, and `resolveBucketHead` then puts
    // the author's own signed counter in charge: 900 beats 0 on every reader,
    // and once seen it can never be talked back down.
    const gaveUp = await acceptHeadClaim(
      { molecule: MOL, pubkey: PUBKEY },
      { head: OTHER, prev: 'e'.repeat(64), seq: 900, sig: 'b'.repeat(64) },
      verify,
      { held: { head: HEAD, prev: null, seq: 0 }, chainContains: () => 'unproven' },
    )
    expect(gaveUp.ok).toBe(false)
    expect(gaveUp.ok === false && gaveUp.reason).toBe('unproven')
    expect(gaveUp.ok === false && gaveUp.keep).toBe(true)
    expect(resolveBucketHead([
      { head: HEAD, prev: null, seq: 0 },
      { head: OTHER, prev: 'e'.repeat(64), seq: 900 },
    ])?.head).toBe(OTHER)

    // And a walker that actually PROVES descent accepts outright — the ordinary
    // case now that the budget is the signed seq gap rather than a constant 64.
    const proven = await acceptHeadClaim(
      { molecule: MOL, pubkey: PUBKEY },
      { head: OTHER, prev: 'e'.repeat(64), seq: 900, sig: 'b'.repeat(64) },
      verify,
      { held: { head: HEAD, prev: null, seq: 0 }, chainContains: () => true },
    )
    expect(proven.ok).toBe(true)
  })

  it('(FIXED) the same unsigned re-offer is now REFUSED, and the verifier IS consulted', async () => {
    // THE ATTACK IS UNCHANGED, byte for byte. The idempotent re-offer used to
    // be step 1, ahead of the signature, so any shape-valid object whose `head`
    // matched the held head came back ok:true with the verifier never called.
    // `ok: true` reads as "authentic for this address"; these bytes are not,
    // and a caller that persisted them on ok:true — the obvious reading, and
    // the shape of the app-side walker — would store unauthenticated bytes in
    // someone's bucket, while one that also pruned siblings would delete the
    // authentic entry. The signature now runs BEFORE every policy branch, so
    // that verdict is unreachable rather than merely unlikely.
    const verify = vi.fn<HeadClaimVerifier>(() => false)

    const verdict = await acceptHeadClaim(
      { molecule: MOL, pubkey: PUBKEY },
      { head: HEAD, prev: OTHER, seq: 999_999, sig: 'deadbeef' },
      verify,
      { held: { head: HEAD, prev: null, seq: 0 } },
    )

    expect(verify).toHaveBeenCalledTimes(1)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('unsigned')
    expect(verdict.ok === false && verdict.keep).toBe(false)
  })

  it('(HOLDS) a walker that DISPROVES descent is still a hard fork, and its bytes are dropped', async () => {
    // The other half of the tri-state. "I walked your chain to its genesis and
    // what I hold is not on it" is permanent and IS an accusation, and must
    // stay one — history never branches. Refusing it costs the reader nothing:
    // keep is false, so no entry is stored and no closure is ever fetched.
    const truePre = headClaimPreimage(MOL, PUBKEY, OTHER, 'e'.repeat(64), 9)
    const verify: HeadClaimVerifier = (k, p, s) => k === PUBKEY && p === truePre && s === 'b'.repeat(64)
    const v = await acceptHeadClaim(
      { molecule: MOL, pubkey: PUBKEY },
      { head: OTHER, prev: 'e'.repeat(64), seq: 9, sig: 'b'.repeat(64) },
      verify,
      { held: { head: HEAD, prev: null, seq: 0 }, chainContains: () => false },
    )
    expect(v.ok === false && v.reason).toBe('fork')
    expect(v.ok === false && v.authentic).toBe(true)
    expect(v.ok === false && v.keep).toBe(false)
  })

  it('(HOLDS) resolveBucketHead is a total, listing-order-independent order', () => {
    const claims = [
      { head: 'f'.repeat(64), prev: null, seq: 2 },
      { head: '0'.repeat(64), prev: null, seq: 2 },
      { head: '9'.repeat(64), prev: null, seq: 1 },
    ]
    expect(resolveBucketHead(claims)?.head).toBe('0'.repeat(64))
    expect(resolveBucketHead([...claims].reverse())?.head).toBe('0'.repeat(64))
  })
})

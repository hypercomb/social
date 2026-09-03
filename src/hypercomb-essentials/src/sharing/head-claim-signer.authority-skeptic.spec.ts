// sharing/head-claim-signer.authority-skeptic.spec.ts
//
// ADVERSARIAL LENS: THE SIGNER SEAM.
//
// `head-claim.ts` is careful: the acceptor is one door, argument one is the
// address, the verifier is a required parameter with no default, and every
// failure path is fail-closed. This file does not attack that — it holds.
//
// It attacks the ESSENTIALS side, where the abstract seam meets a real key
// store, and specifically the two questions the core module never asks:
//
//   1. WHAT DOES THE MINT PATH CHECK? `acceptHeadClaim` has a shape gate.
//      `signHeadClaim` does not, and its "sign then self-verify" step is
//      `verifierFor`, which never parses the preimage. So the writer is a
//      strictly weaker gate than the reader.
//   2. WHAT HAPPENS WHEN A NIP-07 EXTENSION SAYS NO? `NostrSigner` answers a
//      denied `getPublicKey()` by MINTING AND PERSISTING a local secret, and
//      `signEvent` always prefers the extension. The two never reconcile.
//
// A test that PASSES here is a defect reproduced.
//
// STATUS AFTER THE FIX PASS. AS-E1, AS-E2 and AS-E3 are CLOSED and have been
// INVERTED IN PLACE — same setup, opposite assertion — so a regression fails
// here first. AS-E4 is left OPEN on purpose and says why.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools'

import { acceptHeadClaim, headClaimPreimage, parseHeadClaimPreimage } from '@hypercomb/core'

const SECRET_A = '11'.repeat(32)
const SECRET_EXT = '33'.repeat(32)

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
const pubkeyOf = (secret: string): string => getPublicKey(hexToBytes(secret) as never).toLowerCase()

const ROOT = 'a'.repeat(64)
const HEAD = 'c'.repeat(64)
const PREV = 'd'.repeat(64)

const SECRET_STORAGE = 'hc:nostr:secret-key'

const freshEnv = (): void => {
  ;(globalThis as Record<string, unknown>)['window'] = globalThis
  const registry = new Map<string, unknown>()
  ;(globalThis as Record<string, unknown>)['ioc'] = {
    register: (k: string, v: unknown) => { registry.set(k, v) },
    get: (k: string) => registry.get(k),
  }
  delete (globalThis as Record<string, unknown>)['nostr']
  delete (globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY']
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  vi.resetModules()
}

const loadBinding = async (): Promise<typeof import('./head-claim-signer.js')> =>
  await import('./head-claim-signer.js')

// ── AS-E1 ───────────────────────────────────────────────────────────────────
describe('THE MINT PATH NOW RUNS THE READER\'S SHAPE GATE (was: the writer was weaker)', () => {
  beforeEach(async () => {
    freshEnv()
    ;(globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY'] = SECRET_A
    await import('./nostr-signer.js')
  })

  it('(FIXED) the same claim NO reader can parse is now refused at the mint (seq 0 with a prev)', async () => {
    const mod = await loadBinding()

    // `acceptHeadClaim` refuses this shape outright — "seq 0 and genesis must
    // agree" — and so does `parseHeadClaimPreimage`. The mint path used to run
    // NEITHER, and its "sign then self-verify" step was `verifierFor`, which
    // never parses. It now runs the reader's own gate, so the two cannot drift.
    const refusedByCore = await acceptHeadClaim(
      { molecule: ROOT, pubkey: pubkeyOf(SECRET_A) },
      { head: HEAD, prev: PREV, seq: 0, sig: 'ab' },
      () => true,
    )
    expect(refusedByCore.ok === false && refusedByCore.reason).toBe('malformed')

    const result = await mod.signHeadClaim(ROOT, HEAD, PREV, 0)
    expect(result).toEqual({ ok: false, reason: 'malformed' })
    // And the preimage it would have signed really is unparseable, which is the
    // point: the writer refuses exactly what the reader refuses.
    expect(parseHeadClaimPreimage(headClaimPreimage(ROOT, pubkeyOf(SECRET_A), HEAD, PREV, 0))).toBeNull()
  })

  it('(FIXED) a non-hex head, a fractional seq, and a garbage prev are all refused', async () => {
    const mod = await loadBinding()
    const cases: Array<[string, string, string | null, number]> = [
      ['non-hex head', 'not-a-signature', null, 0],
      ['fractional seq', HEAD, PREV, 1.5],
      ['huge seq', HEAD, PREV, 1e21],
      ['garbage prev', HEAD, 'nope', 1],
      ['negative seq', HEAD, PREV, -1],
    ]
    for (const [label, head, prev, seq] of cases) {
      const r = await mod.signHeadClaim(ROOT, head, prev, seq)
      expect(r, `${label} must be refused`).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('(FIXED) the consequence is closed: new-before-old pruning can never publish a dead head', async () => {
    // `#setHead` writes the new entry and then removes every sibling in the
    // bucket. The prototype survived the old defect only because it
    // self-verifies with `acceptHeadClaim` and THROWS; `signHeadClaim` returned
    // ok:true, so a caller written against it would prune the live entry in
    // favour of an unreadable one and destroy the author's published head for
    // every peer. There is now no ok:true to write against.
    const mod = await loadBinding()
    const good = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    const bad = await mod.signHeadClaim(ROOT, HEAD, PREV, 0)
    expect(good.ok).toBe(true)
    expect(bad.ok).toBe(false)
    expect(mod.readHeadEntry(good.ok ? good.json : '')).not.toBeNull()
  })
})

// ── AS-E2 ───────────────────────────────────────────────────────────────────
describe('A NIP-07 DENIAL NO LONGER MINTS AN IDENTITY (was: unconsented, and wedged)', () => {
  beforeEach(() => { freshEnv() })

  it('(FIXED) denying the pubkey prompt mints NOTHING and is a clean "no signer"', async () => {
    // THE SETUP IS UNCHANGED: a user with an extension who clicks "reject" on
    // the pubkey prompt. `getPublicKeyHex` used to CATCH that rejection and
    // fall through to `resolveSecretKeyHex()`, whose miss branch MINTS AND
    // PERSISTS a 32-byte secret — while `signEvent` always prefers
    // `window.nostr` and never falls through. So the user walked away with (a)
    // a persistent signing identity they had explicitly declined, in plaintext
    // localStorage, and (b) a permanent mismatch that failed every commit for
    // the rest of the session, pinned by two caches. Head claims are what make
    // that key load-bearing for WRITE AUTHORITY rather than just for host PUTs.
    ;(globalThis as Record<string, unknown>)['nostr'] = {
      getPublicKey: async () => { throw new Error('user rejected the request') },
      signEvent: async (evt: Record<string, unknown>) =>
        finalizeEvent(evt as never, hexToBytes(SECRET_EXT) as never),
    }
    await import('./nostr-signer.js')
    const mod = await loadBinding()

    expect(localStorage.getItem(SECRET_STORAGE)).toBeNull()

    expect(await mod.readerPubkey()).toBeNull()
    // NOTHING WAS MINTED. "An extension is present and did not give us a key"
    // is now distinct from "there is no extension".
    expect(localStorage.getItem(SECRET_STORAGE)).toBeNull()
    expect(mod.cachedPubkey()).toBeNull()

    await expect(mod.signHeadClaim(ROOT, HEAD, null, 0))
      .resolves.toEqual({ ok: false, reason: 'no signer' })

    // And it is RECOVERABLE: granting the extension afterwards resolves, where
    // before both caches pinned the wrong key for the life of the session.
    ;(globalThis as Record<string, unknown>)['nostr'] = {
      getPublicKey: async () => pubkeyOf(SECRET_EXT),
      signEvent: async (evt: Record<string, unknown>) =>
        finalizeEvent(evt as never, hexToBytes(SECRET_EXT) as never),
    }
    expect(await mod.readerPubkey()).toBe(pubkeyOf(SECRET_EXT))
    const signed = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(signed.ok).toBe(true)
  })

  it('a mid-flow extension REFUSAL is a clean value, but is indistinguishable from having no signer', async () => {
    ;(globalThis as Record<string, unknown>)['nostr'] = {
      getPublicKey: async () => pubkeyOf(SECRET_EXT),
      signEvent: async () => { throw new Error('user rejected the request') },
    }
    await import('./nostr-signer.js')
    const mod = await loadBinding()

    expect(await mod.readerPubkey()).toBe(pubkeyOf(SECRET_EXT))
    // 'signing refused' IS distinct here, which is right. But note what a caller
    // cannot tell apart: 'no signer' is returned BOTH when nothing is registered
    // AND when `readerPubkey()` comes back null — and in the shipped app the
    // former never happens (see AS-E4), so a caller branching on it is dead code.
    await expect(mod.signHeadClaim(ROOT, HEAD, null, 0))
      .resolves.toEqual({ ok: false, reason: 'signing refused' })
  })
})

// ── AS-E3 ───────────────────────────────────────────────────────────────────
describe("verifyEvent's memo is real, and the self-verify no longer relies on it", () => {
  beforeEach(async () => {
    freshEnv()
    ;(globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY'] = SECRET_A
    await import('./nostr-signer.js')
  })

  it('nostr-tools stamps a symbol on every finalized event, so verifyEvent answers from cache', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const content = headClaimPreimage(ROOT, pubkey, HEAD, null, 0)
    const evt = finalizeEvent(
      { kind: mod.HEAD_CLAIM_KIND, created_at: 0, tags: [], content } as never,
      hexToBytes(SECRET_A) as never,
    ) as unknown as Record<string, unknown>

    // Destroy the signature. The elliptic-curve check would reject this.
    evt['sig'] = 'ff'.repeat(64)
    expect(verifyEvent(evt as never)).toBe(true) // ← answered from `verifiedSymbol`

    // So the ONE gate `signHeadClaim` calls its "same door as a stranger's"
    // waves it through: the three field comparisons pass and the curve never runs.
    expect(mod.verifierFor(evt)(pubkey, content, 'ff'.repeat(64))).toBe(true)

    // A round trip through JSON drops the symbol, which is why REPLICATED bytes
    // are safe — the exposure is object-identity-scoped, to our own process.
    const rehydrated = JSON.parse(JSON.stringify(evt)) as Record<string, unknown>
    expect(mod.verifierFor(rehydrated)(pubkey, content, 'ff'.repeat(64))).toBe(false)
  })

  it('(FIXED) signHeadClaim self-verifies the PUBLISHED BYTES, so the curve really runs', async () => {
    const mod = await loadBinding()

    // The stamp is still there — that is a fact about nostr-tools, asserted
    // above and unchanged. What changed is that the self-verify no longer
    // checks the object `finalizeEvent` handed back (three string comparisons
    // wearing a signature check's clothes) but the JSON ROUND TRIP, which drops
    // the symbol and is also exactly what a peer receives.
    //
    // Proof: a signer that returns a correctly-stamped event with a DESTROYED
    // signature. The old code published it happily; the new one refuses.
    const registry = new Map<string, unknown>()
    ;(globalThis as Record<string, unknown>)['ioc'] = {
      register: (k: string, v: unknown) => { registry.set(k, v) },
      get: (k: string) => registry.get(k),
    }
    registry.set('@diamondcoreprocessor.com/NostrSigner', {
      getPublicKeyHex: async () => pubkeyOf(SECRET_A),
      signEvent: async (evt: Record<string, unknown>) => {
        const good = finalizeEvent(evt as never, hexToBytes(SECRET_A) as never) as unknown as Record<string, unknown>
        good['sig'] = 'ff'.repeat(64) // the memo says "verified"; the curve says no
        return good
      },
    })
    vi.resetModules()
    const wired = await import('./head-claim-signer.js')
    wired.resetReaderPubkey()

    // The stamped object still fools verifyEvent...
    const stamped = finalizeEvent(
      { kind: mod.HEAD_CLAIM_KIND, created_at: 0, tags: [], content: 'x' } as never,
      hexToBytes(SECRET_A) as never,
    ) as unknown as Record<string, unknown>
    stamped['sig'] = 'ff'.repeat(64)
    expect(verifyEvent(stamped as never)).toBe(true)

    // ...and signHeadClaim is no longer fooled by it.
    await expect(wired.signHeadClaim(ROOT, HEAD, null, 0))
      .resolves.toEqual({ ok: false, reason: 'self-verify failed' })
  })
})

// ── AS-E4 ───────────────────────────────────────────────────────────────────
describe("OPEN — the 'no signer' branch is still unreachable in the shipped shell", () => {
  beforeEach(() => { freshEnv() })

  it('OPEN (minor): importing nostr-signer registers unconditionally, so readerPubkey still mints', async () => {
    // DELIBERATELY LEFT REPRODUCING. `nostr-signer.ts` ends in a bare
    // `window.ioc.register(...)` at module scope, so `signer()` never returns
    // undefined and one call to `readerPubkey()` from anywhere hands a
    // read-only visitor a persistent identity. The NIP-07 half of this is
    // FIXED above (an extension that refuses now mints nothing); what remains
    // is the no-extension default, and closing it means either splitting
    // `readerPubkey()` into a `resolveOrMint()` only the commit path may name,
    // or a doctrine ratchet forbidding a read path from referencing it.
    //
    // Neither is written here because there is no app-side molecule walker yet:
    // a ratchet would have an empty subject set today and would freeze nothing,
    // and renaming the function would only move the footgun. It is recorded as
    // owed, and `cachedPubkey()` — the read-safe accessor — is asserted honest
    // below so the SAFE door keeps working.
    void 0;
    // This is exactly what the app does: `nostr-signer.ts` ends in a bare
    // `window.ioc.register(...)` at module scope. There is no shell in which the
    // key is absent, so the documented read-path safety — "reads must treat a
    // null cache as I own no bucket" — rests entirely on nobody ever calling
    // `readerPubkey()`, with no ratchet to keep it that way.
    await import('./nostr-signer.js')
    const mod = await loadBinding()

    expect(mod.cachedPubkey()).toBeNull() // the read-safe accessor is honest
    expect(localStorage.getItem(SECRET_STORAGE)).toBeNull()

    const pk = await mod.readerPubkey() // ONE call, on any path, from anywhere
    expect(pk).toMatch(/^[0-9a-f]{64}$/)
    // A read-only visitor now owns a persistent signing identity they never
    // asked for, written to plaintext localStorage.
    expect(localStorage.getItem(SECRET_STORAGE)).toMatch(/^[0-9a-f]{64}$/)
    expect(mod.cachedPubkey()).toBe(pk)
  })
})

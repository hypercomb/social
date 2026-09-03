// sharing/head-claim-signer.spec.ts
//
// Round-trip: the participant's real NostrSigner mints a head claim, and core's
// acceptor takes it back through the injected verifier. `window.NOSTR_SECRET_KEY`
// is the sanctioned test override (nostr-signer.ts) — using it means no key is
// minted into localStorage by running this suite.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicKey } from 'nostr-tools'

import { acceptHeadClaim, headClaimPreimage } from '@hypercomb/core'

const SECRET_A = '11'.repeat(32)
const SECRET_B = '22'.repeat(32)

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const pubkeyOf = (secret: string): string => getPublicKey(hexToBytes(secret) as never).toLowerCase()

const ROOT = 'a'.repeat(64)
const BEES = 'b'.repeat(64)
const HEAD = 'c'.repeat(64)
const PREV = 'd'.repeat(64)

// A minimal `window.ioc` + `window.nostr`-free environment: the signer falls
// through to the local-secret branch, which is the default path in the app.
const installSigner = async (secret: string): Promise<void> => {
  const registry = new Map<string, unknown>()
  ;(globalThis as Record<string, unknown>)['window'] = globalThis
  ;(globalThis as Record<string, unknown>)['ioc'] = {
    register: (k: string, v: unknown) => { registry.set(k, v) },
    get: (k: string) => registry.get(k),
  }
  ;(globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY'] = secret
  vi.resetModules()
  await import('./nostr-signer.js')
}

const loadBinding = async (): Promise<typeof import('./head-claim-signer.js')> =>
  await import('./head-claim-signer.js')

describe('head-claim-signer — sign then accept', () => {
  beforeEach(async () => {
    delete (globalThis as Record<string, unknown>)['nostr']
    await installSigner(SECRET_A)
  })

  it('mints a claim that core accepts at the address it was signed for', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const result = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pubkey).toBe(pubkey)
    expect(Number(result.event['kind'])).toBe(mod.HEAD_CLAIM_KIND)
    expect(result.event['content']).toBe(headClaimPreimage(ROOT, pubkey, HEAD, null, 0))

    const read = mod.readHeadEntry(result.json)
    expect(read).not.toBeNull()
    if (!read) return
    const verdict = await acceptHeadClaim({ molecule: ROOT, pubkey }, read.offered, mod.verifierFor(read.event))
    expect(verdict).toEqual({
      ok: true, authentic: true, keep: true, claim: { head: HEAD, prev: null, seq: 0 }, unchanged: false,
    })
  })

  it('the SAME entry is inert at a different molecule — a reserved system pool included', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const result = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const read = mod.readHeadEntry(result.json)!
    // The reader rebuilds the preimage from BEES, which is not what was signed.
    const verdict = await acceptHeadClaim({ molecule: BEES, pubkey }, read.offered, mod.verifierFor(read.event))
    expect(verdict.ok === false && verdict.reason).toBe('unsigned')
    // Its declared address is available for a diagnostic and for nothing else.
    expect(read.signedFor).toEqual({ molecule: ROOT, pubkey })
  })

  it('the SAME entry is inert in a different key\'s bucket', async () => {
    const mod = await loadBinding()
    const result = await mod.signHeadClaim(ROOT, HEAD, PREV, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const read = mod.readHeadEntry(result.json)!
    const verdict = await acceptHeadClaim(
      { molecule: ROOT, pubkey: pubkeyOf(SECRET_B) }, read.offered, mod.verifierFor(read.event),
    )
    expect(verdict.ok === false && verdict.reason).toBe('unsigned')
  })

  it('an EDITED content is refused: the event id no longer matches', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const result = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Rewrite the signed content to name a different molecule, which is what an
    // attacker would have to do to move the claim. verifyEvent catches it.
    const tampered = { ...result.event, content: headClaimPreimage(BEES, pubkey, HEAD, null, 0) }
    const read = mod.readHeadEntry(JSON.stringify(tampered))!
    const verdict = await acceptHeadClaim({ molecule: BEES, pubkey }, read.offered, mod.verifierFor(read.event))
    expect(verdict.ok === false && verdict.reason).toBe('unsigned')
  })

  it('a SWAPPED signature is refused', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const a = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    const b = await mod.signHeadClaim(ROOT, PREV, null, 0)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const spliced = { ...a.event, sig: b.event['sig'] }
    const read = mod.readHeadEntry(JSON.stringify(spliced))!
    const verdict = await acceptHeadClaim({ molecule: ROOT, pubkey }, read.offered, mod.verifierFor(read.event))
    expect(verdict.ok === false && verdict.reason).toBe('unsigned')
  })

  it('a HARVESTED event of another kind is refused even with a valid signature', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const result = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Kind is checked FIRST, before the pubkey and before the curve maths: a
    // NIP-98 header (27235) or a hive index (30564) can never be replayed here.
    const wrongKind = { ...result.event, kind: 30564 }
    const read = mod.readHeadEntry(JSON.stringify(wrongKind))!
    const verdict = await acceptHeadClaim({ molecule: ROOT, pubkey }, read.offered, mod.verifierFor(read.event))
    expect(verdict.ok === false && verdict.reason).toBe('unsigned')
  })

  it('a replayed OLDER head of my own is refused as stale, not as unsigned', async () => {
    const mod = await loadBinding()
    const pubkey = pubkeyOf(SECRET_A)
    const gen0 = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(gen0.ok).toBe(true)
    if (!gen0.ok) return
    const read = mod.readHeadEntry(gen0.json)!
    const verdict = await acceptHeadClaim({ molecule: ROOT, pubkey }, read.offered, mod.verifierFor(read.event), {
      held: { head: PREV, prev: HEAD, seq: 1 },
    })
    expect(verdict.ok === false && verdict.reason).toBe('stale')
  })


  it('the molecule rides in the `d` tag, because the kind is PARAMETERIZED-REPLACEABLE', async () => {
    // 30000-39999 is NIP-01's parameterized-replaceable range: a relay keeps
    // exactly ONE event per (kind, pubkey, d-tag), and a MISSING `d` tag is the
    // empty string. With the molecule in an `m` tag instead, every head claim a
    // participant published REPLACED all of their previous ones ACROSS EVERY
    // MOLECULE — a legitimate head for molecule B silently deleting the head
    // for molecule A. This repo's own convention says so out loud
    // (content-broker.drone.ts: "Parameterized-replaceable: ['d', sig] makes
    // the relay store").
    const mod = await loadBinding()
    const a = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    const b = await mod.signHeadClaim(BEES, PREV, null, 0)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const tagsOf = (e: Record<string, unknown>): string[][] => e['tags'] as string[][]
    expect(tagsOf(a.event).find(t => t[0] === 'd')?.[1]).toBe(ROOT)
    expect(tagsOf(b.event).find(t => t[0] === 'd')?.[1]).toBe(BEES)
    expect(tagsOf(a.event).some(t => t[0] === 'm')).toBe(false)
    // Two molecules, two d-tags: neither replaces the other at a relay.
    expect(tagsOf(a.event).find(t => t[0] === 'd')?.[1])
      .not.toBe(tagsOf(b.event).find(t => t[0] === 'd')?.[1])
  })

  it('THE MINT PATH RUNS THE READER\'S SHAPE GATE: it cannot sign what no reader can parse', async () => {
    // The writer used to be a strictly weaker gate than the reader — it
    // interpolated its four arguments straight into the preimage and its
    // "self-verify" never parsed anything. Under new-before-old publishing
    // (write the entry, then sweep the bucket's siblings) a caller written
    // against ok:true would prune the LIVE head in favour of an unreadable one
    // and destroy the author's published head for every peer.
    const mod = await loadBinding()
    const cases: Array<[string, string, string | null, number]> = [
      ['seq 0 with a prev', HEAD, PREV, 0],
      ['genesis with a seq', HEAD, null, 1],
      ['non-hex head', 'not-a-signature', null, 0],
      ['fractional seq', HEAD, PREV, 1.5],
      ['huge seq', HEAD, PREV, 1e21],
      ['garbage prev', HEAD, 'nope', 1],
      ['negative seq', HEAD, PREV, -1],
    ]
    for (const [label, head, prev, seq] of cases) {
      const r = await mod.signHeadClaim(ROOT, head, prev, seq)
      expect(r, label).toEqual({ ok: false, reason: 'malformed' })
    }
    // ...and the shape it CAN sign is one the reader parses.
    const good = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(good.ok).toBe(true)
    if (good.ok) expect(mod.readHeadEntry(good.json)).not.toBeNull()
  })

  it('readHeadEntry hands back the EVENT, never a verifier built from the bytes', async () => {
    // Core makes the verifier a required parameter with no default so it cannot
    // be armed wrong. Returning `verify:` on a value parsed out of untrusted
    // bytes invited exactly one refactor to undo that — `read?.verify ?? (() =>
    // true)` — with no test failing. The caller names `verifierFor` itself.
    const mod = await loadBinding()
    const result = await mod.signHeadClaim(ROOT, HEAD, null, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const read = mod.readHeadEntry(result.json)!
    expect('verify' in read).toBe(false)
    expect(Number(read.event['kind'])).toBe(mod.HEAD_CLAIM_KIND)
  })

  it('readHeadEntry refuses anything that is not a v1 head claim', async () => {
    const mod = await loadBinding()
    expect(mod.readHeadEntry('not json')).toBeNull()
    expect(mod.readHeadEntry(JSON.stringify({ kind: 27235, content: '' }))).toBeNull()
    expect(mod.readHeadEntry(JSON.stringify({ content: JSON.stringify({ v: 1, roots: {} }) }))).toBeNull()
  })
})

describe('head-claim-signer — no signer', () => {
  it('refuses to sign, and does so as a value rather than a throw', async () => {
    const registry = new Map<string, unknown>()
    ;(globalThis as Record<string, unknown>)['window'] = globalThis
    ;(globalThis as Record<string, unknown>)['ioc'] = {
      register: (k: string, v: unknown) => { registry.set(k, v) },
      get: () => undefined, // nothing registered: a shell with no signer at all
    }
    vi.resetModules()
    const mod = await import('./head-claim-signer.js')
    mod.resetReaderPubkey()
    await expect(mod.signHeadClaim(ROOT, HEAD, null, 0)).resolves.toEqual({ ok: false, reason: 'no signer' })
    // And a read path never resolves — much less MINTS — an identity.
    expect(mod.cachedPubkey()).toBeNull()
    await expect(mod.readerPubkey()).resolves.toBeNull()
  })
})

// activation-authority.spec.ts — may a package become the live one HERE.
//
// Integrity proves the bytes; this gate proves the publisher. Pure rules,
// attester injected; no network, no IoC, no storage.

import { describe, expect, it, vi } from 'vitest'
import type { AttestationVerdict, PackageAttestation } from '@hypercomb/core'
import { activationAuthority, refusalText } from './activation-authority'
import { DEFAULT_HOST_ZONES } from './host-zones'

const SIG = 'a'.repeat(64)
const PUB = 'b'.repeat(64)
const SEED = DEFAULT_HOST_ZONES[0]!

const attesterSaying = (verdict: AttestationVerdict): PackageAttestation & { attest: ReturnType<typeof vi.fn> } =>
  ({ attest: vi.fn(async () => verdict) })

describe('activationAuthority', () => {

  it('lets an origin take its own package — that code already runs here', async () => {
    // The `content.` face and the case fold are the same origin.
    expect(await activationAuthority({ packageSig: SIG, zone: 'Example.com', self: 'content.example.com', installed: SIG }))
      .toEqual({ ok: true, by: 'self' })
    // A node naming itself by loopback + port.
    expect(await activationAuthority({ packageSig: SIG, zone: 'localhost:4270', self: 'localhost:4270', installed: null }))
      .toEqual({ ok: true, by: 'self' })
  })

  it('spends the seed once: genesis, no attester, the ONE named host', async () => {
    expect(await activationAuthority({ packageSig: SIG, zone: SEED, self: 'hypercomb.io', installed: null, attester: null }))
      .toEqual({ ok: true, by: 'genesis' })
    // A stranger at genesis is not the seed.
    const stranger = await activationAuthority({ packageSig: SIG, zone: 'evil.example', self: 'hypercomb.io', installed: null, attester: null })
    expect(stranger.ok).toBe(false)
    // Once anything has activated, even the seed needs a publisher.
    const later = await activationAuthority({ packageSig: SIG, zone: SEED, self: 'hypercomb.io', installed: 'c'.repeat(64), attester: null })
    expect(later.ok).toBe(false)
  })

  it('fails closed when no attester is loaded', async () => {
    const verdict = await activationAuthority({ packageSig: SIG, zone: 'friend.example', self: 'hypercomb.io', installed: 'c'.repeat(64) })
    expect(verdict).toMatchObject({ ok: false })
    expect((verdict as { error: string }).error).toMatch(/no publisher attester/)
  })

  it("takes the attester's word, asking it with every offering domain", async () => {
    const yes = attesterSaying({ ok: true, pubkey: PUB, witnessed: 'current' })
    expect(await activationAuthority({
      packageSig: SIG, zone: 'friend.example', self: 'hypercomb.io', installed: null,
      zones: ['content.other.example', 'friend.example', ''], attester: yes,
    })).toEqual({ ok: true, by: 'attested' })
    expect(yes.attest).toHaveBeenCalledWith(SIG, ['friend.example', 'other.example'])

    const no = attesterSaying({ ok: false, reason: 'not-named' })
    const refused = await activationAuthority({ packageSig: SIG, zone: 'friend.example', self: 'hypercomb.io', installed: null, attester: no })
    expect(refused).toEqual({ ok: false, error: refusalText('not-named', 'friend.example') })
    expect((refused as { error: string }).error).toMatch(/visit friend\.example/)
  })

  it('treats a throwing attester as a refusal, never a pass', async () => {
    const broken: PackageAttestation = { attest: async () => { throw new Error('boom') } }
    const verdict = await activationAuthority({ packageSig: SIG, zone: 'friend.example', self: 'hypercomb.io', installed: null, attester: broken })
    expect(verdict.ok).toBe(false)
  })

  it('names the way forward in every refusal', () => {
    expect(refusalText('no-follow', 'x.example')).toMatch(/visit x\.example/)
    expect(refusalText('forged', 'x.example')).toMatch(/refused/)
    expect(refusalText('unreachable', 'x.example', 'timed out')).toMatch(/\(timed out\)$/)
    expect(refusalText('not-named', '')).toMatch(/visit that host/)
  })
})

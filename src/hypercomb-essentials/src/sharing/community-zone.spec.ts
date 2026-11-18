// community-zone.spec.ts — THE DOMAIN TRAVELS WITH THE RECORD (jwize 2026-11-17).
//
// "You don't need to have the domain on both devices. Just the last devices data wins and that domain is included."
// A device that never named a host finds its community in the signed index another device saved: `showcase:<zone>`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const SIG = 'a'.repeat(64)
const KEY = 'b'.repeat(64)
let roots: Record<string, string> = {}
let ok = true
const asked: string[] = []

vi.mock('./hive-pointer.js', async original => ({
  ...(await original<typeof import('./hive-pointer.js')>()),
  fetchHiveIndex: async (host: string) => {
    asked.push(host)
    return ok ? { ok: true, manifest: { roots, createdAt: 1, pubkey: KEY } } : { ok: false, reason: 'unreachable' }
  },
}))

const { communityZoneIn } = await import('./showcase-record.js')

describe('the community a device finds in the last save', () => {
  beforeEach(() => { roots = {}; ok = true; asked.length = 0 })

  it('is the zone the signed index names a showcase for, read where asked', async () => {
    roots = { 'showcase:jwize.com': SIG, 'staged:jwize.com': SIG, 'install:essentials': SIG }
    expect(await communityZoneIn('hypercomb.com', KEY)).toBe('jwize.com')
    expect(asked).toEqual(['hypercomb.com'])
  })

  it('among several, the preferred one, else the first by name', async () => {
    roots = { 'showcase:zeta.com': SIG, 'showcase:alpha.org': SIG }
    expect(await communityZoneIn('hypercomb.com', KEY, 'zeta.com')).toBe('zeta.com')
    expect(await communityZoneIn('hypercomb.com', KEY, 'other.net')).toBe('alpha.org')
    expect(await communityZoneIn('hypercomb.com', KEY)).toBe('alpha.org')
  })

  it('none when nothing is saved, the pointer is not a signature, or the index cannot be read', async () => {
    expect(await communityZoneIn('hypercomb.com', KEY)).toBe('')
    roots = { 'showcase:jwize.com': 'not-a-sig', 'showcase:localhost': SIG }
    expect(await communityZoneIn('hypercomb.com', KEY)).toBe('')
    roots = { 'showcase:jwize.com': SIG }
    ok = false
    expect(await communityZoneIn('hypercomb.com', KEY)).toBe('')
  })
})

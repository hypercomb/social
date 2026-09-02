// host-pool.spec.ts — finding the head of an append-only pool over a wire
// that cannot list a directory.
//
// The probe is the whole mechanism, so these count requests as well as check
// answers: a walk that is correct but linear would put a hundred and seventy
// six round trips on a cold boot.

import { describe, expect, it } from 'vitest'
import { headIndex, headPackageSig, poolEntryName } from './host-pool'

/** A pool holding `size` gapless entries, counting what the probe asks for. */
const pool = (size: number): { has: (i: number) => Promise<boolean>; probes: number[] } => {
  const probes: number[] = []
  return {
    probes,
    has: async (index: number) => { probes.push(index); return index < size },
  }
}

describe('headIndex', () => {

  it('answers -1 for a host that publishes nothing, after exactly one probe', async () => {
    const p = pool(0)
    expect(await headIndex(p.has)).toBe(-1)
    expect(p.probes).toEqual([0])
  })

  it('finds the head for every size a host could plausibly reach', async () => {
    for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 31, 100, 176, 1000]) {
      const p = pool(size)
      expect(await headIndex(p.has)).toBe(size - 1)
    }
  })

  it('costs two probes for a host that has shipped once', async () => {
    const p = pool(1)
    expect(await headIndex(p.has)).toBe(0)
    expect(p.probes).toEqual([0, 1])
  })

  it('stays logarithmic — a 176-entry pool is found in ~2·log2(n) requests', async () => {
    const p = pool(176)
    expect(await headIndex(p.has)).toBe(175)
    expect(p.probes.length).toBeLessThanOrEqual(20)
  })

  it('never probes the same index twice', async () => {
    const p = pool(176)
    await headIndex(p.has)
    expect(new Set(p.probes).size).toBe(p.probes.length)
  })

  it('gives up rather than spinning when a host answers 200 to everything', async () => {
    let probes = 0
    const head = await headIndex(async () => { probes++; return true })
    expect(head).toBeGreaterThan(0)
    expect(probes).toBeLessThan(40)
  })
})

describe('headPackageSig', () => {
  const SIG = 'a'.repeat(64)

  it('reads the signature at the head index', async () => {
    const entries = [`${'b'.repeat(64)}`, `${'c'.repeat(64)}`, SIG]
    expect(await headPackageSig(async i => entries[i] ?? null)).toBe(SIG)
  })

  it('tolerates the trailing newline a file write leaves', async () => {
    expect(await headPackageSig(async i => (i === 0 ? `${SIG}\n` : null))).toBe(SIG)
  })

  it('answers null for a pool with nothing in it', async () => {
    expect(await headPackageSig(async () => null)).toBeNull()
  })

  it('refuses a head entry that is not a signature', async () => {
    // A host cannot point a client at something that is not content-addressed.
    expect(await headPackageSig(async i => (i === 0 ? 'https://example.com/install.sh' : null))).toBeNull()
  })
})

describe('poolEntryName', () => {
  it('is fixed width, so entries sort lexically as they sort numerically', () => {
    expect(poolEntryName(0)).toBe('00000000')
    expect(poolEntryName(175)).toBe('00000175')
    expect([poolEntryName(2), poolEntryName(10)].sort()).toEqual(['00000002', '00000010'])
  })
})

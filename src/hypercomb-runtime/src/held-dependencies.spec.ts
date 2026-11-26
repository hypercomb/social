// The flat scans ask the brood (held-dependencies.ts): a dependency the brood
// holds is in the set, anything never held is not, and a ruling that cannot be
// read holds.

import { describe, expect, it } from 'vitest'
import { flagInBrood, type BroodRecord } from '@hypercomb/core'
import { heldDependencies, isHeldDependency } from './held-dependencies'

const sig = (c: string): string => c.repeat(64)
const record = (s: string, extra: Partial<BroodRecord> = {}): BroodRecord =>
  ({ sig: s, kind: 'bee', arrived: 1, source: { kind: 'own' }, audits: [], vouches: [], ...extra })

describe('held dependencies', () => {
  it('a sig with no record runs, so the trunk loads as before', async () => {
    const held = await heldDependencies({ roster: async () => [], mayRun: async () => true })
    expect(held.size).toBe(0)
    expect(isHeldDependency(held, sig('a'))).toBe(false)
  })

  it('holds flagged and refused records, and runs accepted ones', async () => {
    const flagged = record(sig('b'), { flags: [{ at: 1, by: 'scan', reason: 'newly reaches fetch' }] })
    const accepted = record(sig('c'), { flags: flagged.flags, ruling: { at: 2, verdict: 'accepted', warnings: ['x', 'y'] } })
    const refused = record(sig('d'), { ruling: { at: 2, verdict: 'refused', warnings: [] } })
    const verdicts: Record<string, boolean> = { [sig('b')]: false, [sig('c')]: true, [sig('d')]: false }
    const held = await heldDependencies({
      roster: async () => [flagged, accepted, refused],
      mayRun: async s => verdicts[s],
    })
    expect([...held].sort()).toEqual([sig('b'), sig('d')])
  })

  it('fails closed when a ruling cannot be read', async () => {
    const held = await heldDependencies({
      roster: async () => [record(sig('e'))],
      mayRun: async () => { throw new Error('unreadable') },
    })
    expect(held.has(sig('e'))).toBe(true)
  })

  it('a roster that cannot be read holds nothing and never throws', async () => {
    const held = await heldDependencies({ roster: async () => { throw new Error('no storage') }, mayRun: async () => false })
    expect(held.size).toBe(0)
  })

  it('reads the live brood: a flagged draft of your own is held', async () => {
    const draft = sig('9')
    await flagInBrood(draft, { by: 'scan', reason: 'a draft of a dependency' }, { kind: 'own' })
    const held = await heldDependencies()
    expect(held.has(draft)).toBe(true)
    expect(held.has(sig('8'))).toBe(false)
  })

  it('matches a pool file named with or without .js', async () => {
    const held = await heldDependencies({ roster: async () => [record(sig('f'))], mayRun: async () => false })
    expect(isHeldDependency(held, `${sig('f')}.js`)).toBe(true)
    expect(isHeldDependency(held, sig('f'))).toBe(true)
  })
})

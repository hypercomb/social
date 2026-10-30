import { describe, expect, it } from 'vitest'
import {
  OPTIMIZATION_COUNT_MAX,
  OPTIMIZATION_DECAY_MS,
  OPTIMIZATION_DELETE_BATCH,
  OPTIMIZATION_KEEP_AT,
  OPTIMIZATION_MINT_WEIGHT,
  emptyOptimizationHeat,
  inRecyclingPriority,
  parseOptimizationHeat,
  runOptimizationHeat,
} from './optimization-heat.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const POOL = 'system:manifests'
const id = (n: number): string => `${POOL}/${sig(n)}`
const NOW = 1_700_000_000_000

describe('optimization heat', () => {
  it('keeps a record it has never counted', () => {
    const pass = runOptimizationHeat({
      heat: emptyOptimizationHeat(NOW),
      now: NOW,
      uses: [],
      pool: POOL,
      members: [sig(1)],
    })
    expect(pass.victims).toEqual([])
    expect(pass.heat.counts[id(1)]).toBe(OPTIMIZATION_KEEP_AT)
    expect(inRecyclingPriority(pass.heat.counts[id(1)] ?? 0)).toBe(false)
  })

  it('moves an unused record into recycling and names it for deletion', () => {
    const pass = runOptimizationHeat({
      heat: { v: 1, at: NOW, counts: { [id(1)]: OPTIMIZATION_KEEP_AT } },
      now: NOW + OPTIMIZATION_DECAY_MS,
      uses: [],
      pool: POOL,
      members: [sig(1)],
    })
    expect(pass.victims).toEqual([sig(1)])
    expect(pass.heat.counts[id(1)]).toBeUndefined()
  })

  it('moves a used record back out of recycling in the same pass', () => {
    const pass = runOptimizationHeat({
      heat: { v: 1, at: NOW, counts: { [id(1)]: OPTIMIZATION_KEEP_AT } },
      now: NOW + OPTIMIZATION_DECAY_MS,
      uses: [{ meaning: POOL, member: sig(1), weight: 1 }],
      pool: POOL,
      members: [sig(1)],
    })
    expect(pass.victims).toEqual([])
    expect(pass.heat.counts[id(1)]).toBeGreaterThanOrEqual(OPTIMIZATION_KEEP_AT)
  })

  it('does not recycle the most-used record', () => {
    const pass = runOptimizationHeat({
      heat: {
        v: 1,
        at: NOW,
        counts: { [id(1)]: OPTIMIZATION_COUNT_MAX, [id(2)]: 1 },
      },
      now: NOW + OPTIMIZATION_DECAY_MS,
      uses: [],
      pool: POOL,
      members: [sig(1), sig(2)],
    })
    expect(pass.victims).toEqual([sig(2)])
    expect(pass.heat.counts[id(1)]).toBe(OPTIMIZATION_COUNT_MAX - 1)
    expect(inRecyclingPriority(pass.heat.counts[id(1)] ?? 0)).toBe(false)
  })

  it('lifts a cold record onto the keep line when it is used', () => {
    const pass = runOptimizationHeat({
      heat: { v: 1, at: NOW, counts: { [id(1)]: 1 } },
      now: NOW,
      uses: [{ meaning: POOL, member: sig(1).toUpperCase(), weight: 1 }],
      pool: POOL,
      members: [sig(1)],
    })
    expect(pass.victims).toEqual([])
    expect(pass.heat.counts[id(1)]).toBe(OPTIMIZATION_KEEP_AT)
  })

  it('a mint is not eligible on the pass that writes it', () => {
    const pass = runOptimizationHeat({
      heat: emptyOptimizationHeat(NOW),
      now: NOW,
      uses: [{ meaning: POOL, member: sig(4), weight: OPTIMIZATION_MINT_WEIGHT }],
      pool: POOL,
      members: [sig(4)],
    })
    expect(pass.victims).toEqual([])
    expect(pass.heat.counts[id(4)]).toBeGreaterThanOrEqual(OPTIMIZATION_KEEP_AT)
  })

  it('drops the lowest counts first and only a batch', () => {
    const counts: Record<string, number> = {}
    const members: string[] = []
    for (let n = 1; n <= OPTIMIZATION_DELETE_BATCH + 12; n++) {
      counts[id(n)] = 1
      members.push(sig(n))
    }
    const pass = runOptimizationHeat({
      heat: { v: 1, at: NOW, counts },
      now: NOW + OPTIMIZATION_DECAY_MS,
      uses: [],
      pool: POOL,
      members,
    })
    expect(pass.victims).toHaveLength(OPTIMIZATION_DELETE_BATCH)
    expect(pass.victims[0]).toBe(sig(1))
  })

  it('forgets a count whose file is already gone', () => {
    const pass = runOptimizationHeat({
      heat: { v: 1, at: NOW, counts: { [id(9)]: 1 } },
      now: NOW,
      uses: [],
      pool: POOL,
      members: [],
    })
    expect(pass.victims).toEqual([])
    expect(pass.heat.counts[id(9)]).toBeUndefined()
  })

  it('refuses a pool that is not a derived index', () => {
    const pass = runOptimizationHeat({
      heat: { v: 1, at: NOW, counts: { 'system:optimization/aa': 0 } },
      now: NOW + OPTIMIZATION_DECAY_MS,
      uses: [{ meaning: 'system:optimization', member: sig(1), weight: 5 }],
      pool: 'system:optimization',
      members: [sig(1)],
    })
    expect(pass.victims).toEqual([])
    expect(pass.heat.counts['system:optimization/aa']).toBe(0)
  })

  it('does not parse a ledger it cannot trust', () => {
    expect(parseOptimizationHeat('nope')).toBeNull()
    expect(parseOptimizationHeat('{"v":2,"at":1,"counts":{}}')).toBeNull()
    expect(parseOptimizationHeat('{"v":1,"at":1,"counts":[]}')).toBeNull()
  })
})

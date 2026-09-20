import { describe, expect, it } from 'vitest'
import { buildDosCollisionCells, buildDosCollisionMasks } from './dos-mechanics.js'
import {
  createDosOrdinaryFruit, dosFruitFootprint, stepDosOrdinaryFruit,
  type DosFruitClocks, type DosFruitEnvironment,
} from './dos-fruit-mechanics.js'

const emptyLevel = (): number[][] => Array.from({ length: 25 }, () => Array<number>(40).fill(0))
function scene(): DosFruitEnvironment {
  const level = emptyLevel()
  return { cells: buildDosCollisionCells(level), masks: buildDosCollisionMasks(level),
    player: null, pickupEnabled: true }
}
const clocks = (generalTick: number, workTick: number): DosFruitClocks => ({ generalTick, workTick })

describe('ordinary DOS collectible states with explicit clock domains', () => {
  it('shares the actor-mask builder\'s compacted DS:3690 surface and guard rows', () => {
    const level = emptyLevel()
    level[0][2] = 1
    level[24][2] = 1
    const cells = buildDosCollisionCells(level)
    expect(cells).toHaveLength(31 * 32)
    expect(cells[2 * 32 + 2] & 1).toBe(1)
    expect(cells[26 * 32 + 2] & 1).toBe(1)
    expect(buildDosCollisionMasks(level)).toHaveLength(0x3c0)
  })

  it('reads the compacted two/three-column raw occupancy footprint and y+16 range', () => {
    const env = scene()
    const row = Math.floor((0x20 + 15) / 8)
    env.cells[row * 32 + 4] = 1
    expect(dosFruitFootprint(env.cells, 0x38, 0x20, 15)).toBe(false)
    expect(dosFruitFootprint(env.cells, 0x39, 0x20, 15)).toBe(true)
    env.cells[row * 32 + 4] = 0
    env.cells[row * 32 + 3] = 1
    expect(dosFruitFootprint(env.cells, 0x38, 0x20, 15)).toBe(true)
    const nextRow = Math.floor((0x20 + 16) / 8)
    env.cells[nextRow * 32 + 2] = 1
    expect(dosFruitFootprint(env.cells, 0x38, 0x20, 16)).toBe(true)
    expect(dosFruitFootprint(env.cells, 0x38, 0x0f, 16)).toBe(false)
    expect(dosFruitFootprint(env.cells, 0x38, 0xd8, 16)).toBe(false)
  })

  it('uses 1E63 before 1D24, then BCAA selector-one 600-work-tick deadline', () => {
    const env = scene()
    const state = createDosOrdinaryFruit(0x3f, 0x20, 0x12)
    expect(state.x).toBe(0x38)
    stepDosOrdinaryFruit(state, clocks(100, 700), env) // BC41's current pass.
    env.cells[5 * 32 + 2] = 1 // y+15 blocks the 1D24 transition.
    stepDosOrdinaryFruit(state, clocks(101, 701), env)
    expect(state).toMatchObject({ phase: 'falling', y: 0x21 })
    // Re-enter at an aligned y so y+15 and y+16 probe adjacent rows.
    state.y = 0x20
    env.cells[5 * 32 + 2] = 0
    env.cells[6 * 32 + 2] = 1 // y+16 now reaches a support predicate.
    stepDosOrdinaryFruit(state, clocks(102, 702), env)
    expect(state).toMatchObject({ phase: 'timed', y: 0x20, deadline: 1302, display: 0xc1 })
    // General clock movement alone cannot expire a work-clock item.
    stepDosOrdinaryFruit(state, clocks(5000, 1301), env)
    expect(state.phase).toBe('timed')
    stepDosOrdinaryFruit(state, clocks(5001, 1302), env)
    expect(state.phase).toBe('expiring')
  })

  it('moves by code +10h and snaps only the 1CFC contact branch', () => {
    const env = scene()
    const state = createDosOrdinaryFruit(0x38, 0x24 + 0.5, 0x10)
    state.fresh = false
    const maskIndex = (((0x25 << 2) & 0xffe0) + 2)
    // An unaligned y sets the high-byte 80h flag; this branch tests low 60h.
    env.masks[maskIndex + 0x40] = 0x60
    stepDosOrdinaryFruit(state, clocks(1, 1), env)
    expect(state).toMatchObject({ phase: 'falling', y: 0x20 })
    // A y+15 occupancy carry also moves down but does not take that snap.
    state.y = 0x24 + 0.5
    env.cells[Math.floor((0x24 + 15) / 8) * 32 + 2] = 1
    stepDosOrdinaryFruit(state, clocks(2, 2), env)
    expect(state.y).toBe(0x25 + 0.5)
  })

  it('prioritizes pickup, credits once, and retains a rising score until the general deadline', () => {
    const env = scene()
    const state = createDosOrdinaryFruit(0x38, 0x20, 0x47)
    state.fresh = false
    state.phase = 'timed'
    state.deadline = 200
    env.player = { x: 0x38, y: 0x10, w: 16, h: 16 }
    stepDosOrdinaryFruit(state, clocks(100, 200), env)
    expect(state.phase).toBe('pickup') // Pickup precedes equal-time expiry.
    env.pickupEnabled = false
    expect(stepDosOrdinaryFruit(state, clocks(101, 201), env).collected).toBe(0)
    env.pickupEnabled = true
    expect(stepDosOrdinaryFruit(state, clocks(102, 202), env).collected).toBe(16_000)
    expect(state).toMatchObject({ phase: 'score', deadline: 192 })
    const y = state.y
    expect(stepDosOrdinaryFruit(state, clocks(191, 50_000), env)).toEqual({ collected: 0, removed: false })
    expect(state.y).toBe(y - 0.5)
    expect(stepDosOrdinaryFruit(state, clocks(192, 50_001), env).removed).toBe(false)
    expect(stepDosOrdinaryFruit(state, clocks(193, 50_002), env).removed).toBe(true)
  })

  it('takes four six-work-tick expiry display steps, independent of general time', () => {
    const env = scene()
    const state = createDosOrdinaryFruit(0x38, 0x20, 0x50)
    state.fresh = false
    state.phase = 'expiring'
    state.deadline = 300
    expect(stepDosOrdinaryFruit(state, clocks(999, 299), env).removed).toBe(false)
    expect(state.display).toBe(0x51)
    for (let index = 0; index < 4; index++) {
      const now = 300 + index * 6
      expect(stepDosOrdinaryFruit(state, clocks(999 + index, now), env).removed).toBe(index === 3)
      expect(state.display).toBe(0x10f + index)
      if (index < 3) expect(stepDosOrdinaryFruit(state, clocks(999 + index, now + 5), env).removed).toBe(false)
    }
  })

  it('retains native raw unsigned work comparisons when the 600-tick deadline wraps', () => {
    const env = scene()
    const state = createDosOrdinaryFruit(0x38, 0x20, 0x12)
    state.fresh = false
    state.phase = 'timed'
    state.deadline = (0xfff0 + 0x258) & 0xffff
    expect(state.deadline).toBe(0x248)
    // BD0F does not use signed elapsed arithmetic: the low wrapped deadline
    // is already <= an unsigned near-FFFF current work value.
    stepDosOrdinaryFruit(state, clocks(123, 0xfff1), env)
    expect(state.phase).toBe('expiring')
    expect(stepDosOrdinaryFruit(state, clocks(124, 0xfff2), env).removed).toBe(false)
    expect(state.display).toBe(0x10f)
  })

  it('retains native strict unsigned general comparison for wrapped score deadline', () => {
    const env = scene()
    const state = createDosOrdinaryFruit(0x38, 0x20, 0x12)
    state.fresh = false
    state.phase = 'pickup'
    expect(stepDosOrdinaryFruit(state, clocks(0xfff0, 1), env).collected).toBe(500)
    expect(state.deadline).toBe(0x4a)
    // BEC2 uses deadline < generalTick, not a wrap-safe elapsed test.
    expect(stepDosOrdinaryFruit(state, clocks(0xfff1, 2), env).removed).toBe(true)
  })

  it.each([
    [0x12, 500], [0x10, 1_000], [0x11, 2_000], [0x14, 4_000],
    [0x46, 8_000], [0x47, 16_000], [0x50, 6_000],
  ])('credits only verified ordinary ID %# for %i points', (kind, points) => {
    const state = createDosOrdinaryFruit(0x38, 0x20, kind)
    state.fresh = false
    state.phase = 'pickup'
    expect(state.points).toBe(points)
    expect(stepDosOrdinaryFruit(state, clocks(1, 9000), scene()).collected).toBe(points)
    expect(stepDosOrdinaryFruit(state, clocks(2, 9001), scene()).collected).toBe(0)
  })

  it('rejects non-ordinary BC41 item IDs', () => {
    expect(() => createDosOrdinaryFruit(0x38, 0x20, 0x99)).toThrow('Unverified ordinary item ID')
  })
})

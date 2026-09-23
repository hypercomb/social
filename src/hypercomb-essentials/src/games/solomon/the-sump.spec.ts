import { describe, expect, it } from 'vitest'
import { ChamberModel, type ChamberCell } from './chamber.js'
import { CHAMBERS, THE_SUMP } from './chamber-places.js'
import { seatAt } from './place.js'
import { STORY } from './story.js'

// Below the Undercroft's stair: one causeway across a pool under bats, a
// goblin warren of one-wide corridors, the Sump key at its dead end, and
// the heart behind the door — a pearl, guarded.

function reach(model: ChamberModel, from: ChamberCell, pass: (feature: string) => boolean): Set<string> {
  const { cols, rows } = model.built
  const seen = new Set<string>(), stack = [from]
  while (stack.length) {
    const cell = stack.pop()!
    const key = `${cell.col},${cell.row}`
    if (seen.has(key)) continue
    const feature = model.built.featureAt(cell.col, cell.row)
    if (!(cell.col === from.col && cell.row === from.row) && !model.open(cell.col, cell.row) && !(feature && pass(feature))) continue
    seen.add(key)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = cell.col + dc, r = cell.row + dr
      if (c >= 0 && r >= 0 && c < cols && r < rows) stack.push({ col: c, row: r })
    }
  }
  return seen
}
const beside = (reached: Set<string>, cell: ChamberCell): boolean =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => reached.has(`${cell.col + dc!},${cell.row + dr!}`))

describe('the Sump', () => {
  it('sits behind the Undercroft’s stair', () => {
    expect(CHAMBERS.some(chamber => chamber.id === 'the-sump')).toBe(true)
    expect(seatAt(STORY, 'undercroft/stair-down')?.place).toBe('the-sump')
  })

  it('is reached in order: the causeway and the warren first, the heart only with the key', () => {
    const model = new ChamberModel(THE_SUMP)
    const landing = THE_SUMP.exits[0]!.landing
    const door = THE_SUMP.doors[0]!
    const warrenChest = THE_SUMP.chests.find(chest => chest.id === 'warren-chest')!
    const pearlChest = THE_SUMP.chests.find(chest => chest.id === 'pearl-chest')!
    const stairDown = THE_SUMP.entrances[0]!
    const shut = reach(model, landing, () => false)
    expect(beside(shut, THE_SUMP.residents[0]!)).toBe(true)
    expect(beside(shut, warrenChest)).toBe(true)
    expect(beside(shut, pearlChest)).toBe(false)
    expect(shut.has(`${stairDown.landing.col},${stairDown.landing.row}`)).toBe(false)
    const unlocked = reach(model, landing, feature => feature === door.id)
    expect(beside(unlocked, pearlChest)).toBe(true)
    expect(beside(unlocked, THE_SUMP.alcoves[0]!)).toBe(true)
    expect(unlocked.has(`${stairDown.landing.col},${stairDown.landing.row}`)).toBe(true)
    expect(warrenChest.items.some(item => item.kind === 'key')).toBe(true)
    expect(door.lock).toBe('small')
  })

  it('crosses the pool on one causeway, one square wide', () => {
    const model = new ChamberModel(THE_SUMP)
    for (const col of [10, 20, 30]) {
      expect(model.terrainAt(col, 6)).toBe('floor')
      expect(model.terrainAt(col, 5)).toBe('water')
      expect(model.terrainAt(col, 7)).toBe('water')
    }
  })

  it('keeps its bats over the water and its goblins on the floor, along their whole routes', () => {
    const model = new ChamberModel(THE_SUMP)
    expect(THE_SUMP.foes!.length).toBe(5)
    for (const foe of THE_SUMP.foes!) {
      for (const cell of foe.route) expect(model.foeOpen(foe.kind, cell.col, cell.row), `${foe.id} at ${cell.col},${cell.row}`).toBe(true)
      const wet = foe.route.filter(cell => model.terrainAt(cell.col, cell.row) === 'water').length
      if (foe.kind === 'flitter') expect(wet).toBe(foe.route.length)
      else expect(wet).toBe(0)
    }
    // The warren's corridors are one wide: the goblins' legs run along them.
    const west = THE_SUMP.foes!.find(foe => foe.id === 'goblin-warren-west')!
    for (const col of [15, 18]) {
      expect(model.open(col, 11)).toBe(true)
      expect(model.open(col, 10)).toBe(false)
      expect(model.open(col, 12)).toBe(false)
    }
    expect(west.route.some(cell => cell.row === 11)).toBe(true)
  })
})

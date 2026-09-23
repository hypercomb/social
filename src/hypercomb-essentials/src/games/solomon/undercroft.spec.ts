import { describe, expect, it } from 'vitest'
import { ChamberModel, type ChamberCell } from './chamber.js'
import { CHAMBERS } from './chamber-places.js'

// The Undercroft is the first chamber bigger than its window — halls and
// corridors walked under a camera, with a minimap. Its way through is:
// the lever in the great hall lifts the gallery shutter; the gallery's
// coffer holds the vault key; the vault door opens the deep hall, where the
// stair goes on down.

const UNDERCROFT = CHAMBERS.find(chamber => chamber.id === 'undercroft')!

/** Cells reachable on foot from `from`, with the shutter and the door
 *  treated as `open` says. */
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

describe('the Undercroft', () => {
  it('is bigger than the window, and every hall is reached in the order its locks allow', () => {
    expect(UNDERCROFT.map[0]!.length).toBeGreaterThan(20)
    expect(UNDERCROFT.map.length).toBeGreaterThan(13)
    const model = new ChamberModel(UNDERCROFT)
    const landing = UNDERCROFT.exits[0]!.landing
    const shut = reach(model, landing, () => false)
    const lever = UNDERCROFT.levers[0]!, shutter = UNDERCROFT.shutters[0]!, door = UNDERCROFT.doors[0]!
    const galleryChest = UNDERCROFT.chests.find(chest => chest.id === 'gallery-chest')!
    const surveyorChest = UNDERCROFT.chests.find(chest => chest.id === 'surveyor-chest')!
    const stairDown = UNDERCROFT.entrances[0]!
    // From the stair: the surveyor, the lamps and the lever are all in reach;
    // the gallery waits behind the shutter, the deep hall behind the door.
    expect(beside(shut, lever)).toBe(true)
    expect(beside(shut, surveyorChest)).toBe(true)
    for (const lamp of UNDERCROFT.lamps) expect(beside(shut, lamp)).toBe(true)
    expect(beside(shut, UNDERCROFT.residents[0]!)).toBe(true)
    expect(beside(shut, galleryChest)).toBe(false)
    expect(shut.has(`${stairDown.landing.col},${stairDown.landing.row}`)).toBe(false)
    // The lever lifts the shutter: the gallery, and its key.
    const shutterUp = reach(model, landing, feature => feature === shutter.id)
    expect(beside(shutterUp, galleryChest)).toBe(true)
    expect(shutterUp.has(`${stairDown.landing.col},${stairDown.landing.row}`)).toBe(false)
    // The key opens the vault door: the deep hall, and the stair on down.
    const unlocked = reach(model, landing, feature => feature === shutter.id || feature === door.id)
    expect(unlocked.has(`${stairDown.landing.col},${stairDown.landing.row}`)).toBe(true)
    expect(galleryChest.items.some(item => item.kind === 'key')).toBe(true)
    expect(door.lock).toBe('small')
  })

  it('charts itself: the surveyor’s chest grants the map that shows the whole chamber', () => {
    const chest = UNDERCROFT.chests.find(candidate => candidate.id === 'surveyor-chest')!
    expect(chest.grants?.map(grant => grant.id)).toEqual(['map:undercroft'])
  })
})

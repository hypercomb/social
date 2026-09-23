// What lives in an overhead chamber, and the wand's answer to it.
import { describe, expect, it } from 'vitest'
import {
  ChamberModel, CRUSHED_WORDS, CATCH_GRACE, type ChamberDefinition, type ChamberEvent, type ChamberExit, type ChamberFoe, type MoveInput,
} from './chamber.js'
import { CHAMBERS } from './chamber-places.js'
import { WAND_REFUSALS, WAND_WORDS } from './wand-rules.js'

const W = 16, H = 9
type Overrides = Record<string, string>
const key = (col: number, row: number): string => `${col},${row}`
function makeMap(overrides: Overrides): string[] {
  const rows: string[] = []
  for (let row = 0; row < H; row++) {
    let line = ''
    for (let col = 0; col < W; col++) {
      line += (row === 0 || row === H - 1 || col === 0 || col === W - 1) ? '#' : overrides[key(col, row)] ?? '.'
    }
    rows.push(line)
  }
  return rows
}
const idle: MoveInput = { up: false, down: false, left: false, right: false }

/** A room whose stair lands her at `landing`, holding `foes`. */
function room(landing: { col: number; row: number }, foes: ChamberFoe[], overrides: Overrides = {}): ChamberModel {
  const exit: ChamberExit = { id: 'stair', col: landing.col, row: landing.row - 1, style: 'stairs-up', label: 'Up', landing, facing: 'down' }
  const definition: ChamberDefinition = {
    id: 'den', name: 'The Den', subtitle: 'Something lives here', look: 'cavern', torch: 4, sconces: false,
    map: makeMap({ [key(exit.col, exit.row)]: '<', [key(landing.col, landing.row)]: '@', ...overrides }),
    exits: [exit], entrances: [], tablets: [], gates: [], chests: [], doors: [], shutters: [],
    plates: [], blocks: [], levers: [], lamps: [], lampSets: [], sigils: [], alcoves: [], residents: [],
    furniture: [], effects: [], foes,
  }
  const model = new ChamberModel(definition)
  model.arrive('stair')
  return model
}
function run(model: ChamberModel, seconds: number): ChamberEvent[] {
  const events: ChamberEvent[] = []
  for (let t = 0; t < seconds; t += 0.05) events.push(...model.update(0.05, idle))
  return events
}
/** A wall down column `col`, top to bottom. */
function wall(col: number): Overrides {
  const overrides: Overrides = {}
  for (let row = 1; row < H - 1; row++) overrides[key(col, row)] = '#'
  return overrides
}
function water(col: number): Overrides {
  const overrides: Overrides = {}
  for (let row = 1; row < H - 1; row++) overrides[key(col, row)] = '~'
  return overrides
}

describe('a prowler on its route', () => {
  it('walks its legs in order while she is out of sight, and never hunts through a wall', () => {
    const model = room({ col: 2, row: 2 }, [{ id: 'g', kind: 'prowler', route: [{ col: 10, row: 2 }, { col: 13, row: 2 }, { col: 13, row: 6 }, { col: 10, row: 6 }] }], wall(7))
    run(model, 1)
    let foe = model.foes[0]!
    expect(foe.hunting).toBe(false)
    expect(foe.x).toBeGreaterThan(11)
    expect(foe.facing).toBe('right')
    run(model, 2.5)
    foe = model.foes[0]!
    expect(foe.x).toBeCloseTo(13.5, 0)
    expect(foe.y).toBeGreaterThan(3)
    expect(foe.facing).toBe('down')
  })

  it('hunts her the moment it sees her, and catches her — she comes to at the stair with the den reset', () => {
    const model = room({ col: 5, row: 2 }, [{ id: 'g', kind: 'prowler', route: [{ col: 8, row: 2 }, { col: 8, row: 6 }] }])
    model.update(0.05, idle)
    expect(model.foes[0]!.hunting).toBe(true)
    expect(model.foes[0]!.x).toBeLessThan(8.5)
    expect(model.foes[0]!.facing).toBe('left')
    let caught = false
    for (let t = 0; t < 2 && !caught; t += 0.05) caught = model.update(0.05, idle).some(event => event.kind === 'caught' && event.foe === 'g')
    expect(caught).toBe(true)
    expect([model.x, model.y]).toEqual([5.5, 2.5])
    let foe = model.foes[0]!
    expect([foe.x, foe.y, foe.hunting]).toEqual([8.5, 2.5, false])
    // A moment's grace: it stays at its post and does not have her again at once.
    run(model, CATCH_GRACE - 0.1)
    foe = model.foes[0]!
    expect([foe.x, foe.hunting]).toEqual([8.5, false])
    run(model, 0.3)
    expect(model.foes[0]!.hunting).toBe(true)
  })

  it('cannot cross water, where a flitter flies straight over it', () => {
    const route = [{ col: 6, row: 7 }, { col: 12, row: 7 }]
    const walker = room({ col: 2, row: 2 }, [{ id: 'g', kind: 'prowler', route }], water(9))
    run(walker, 6)
    expect(walker.foes[0]!.x).toBeLessThan(9)
    const flier = room({ col: 2, row: 2 }, [{ id: 'b', kind: 'flitter', route }], water(9))
    run(flier, 6)
    expect(flier.foes[0]!.x).toBeGreaterThan(9.5)
  })
})

describe('the wand on bare floor', () => {
  it('lays a stone block nothing walks through, and lifts it again', () => {
    const model = room({ col: 5, row: 2 }, [])
    model.turn('right')
    expect(model.cast()).toMatchObject({ kind: 'message', text: WAND_WORDS['block'] })
    expect(model.terrainAt(6, 2)).toBe('block')
    expect(model.open(6, 2)).toBe(false)
    expect(model.foeOpen('flitter', 6, 2)).toBe(false)
    expect(model.cast()).toMatchObject({ kind: 'message', text: WAND_WORDS['floor'] })
    expect(model.terrainAt(6, 2)).toBe('floor')
    model.turn('up')
    expect(model.cast()).toMatchObject({ kind: 'message', text: WAND_REFUSALS.taken }) // the stair, not bare floor
  })

  it('comes down on a prowler standing there, and only shoos a bat', () => {
    const den = room({ col: 5, row: 2 }, [{ id: 'g', kind: 'prowler', route: [{ col: 6, row: 2 }] }])
    den.turn('right')
    const result = den.cast()
    expect(result).toMatchObject({ kind: 'message', text: CRUSHED_WORDS })
    expect(result.events.some(event => event.kind === 'crushed' && event.foe === 'g')).toBe(true)
    expect(den.foes[0]!.alive).toBe(false)
    run(den, 2)
    expect(den.foes[0]!.alive).toBe(false)

    const roost = room({ col: 5, row: 2 }, [{ id: 'b', kind: 'flitter', route: [{ col: 6, row: 2 }] }])
    roost.turn('right')
    expect(roost.cast()).toMatchObject({ kind: 'message', text: WAND_WORDS['block'] })
    const bat = roost.foes[0]!
    expect(bat.alive).toBe(true)
    expect(Math.floor(bat.x) === 6 && Math.floor(bat.y) === 2).toBe(false)
  })
})

describe('the Undercroft', () => {
  it('keeps every creature on ground its kind can stand on, along its whole route', () => {
    const definition = CHAMBERS.find(chamber => chamber.id === 'undercroft')!
    const model = new ChamberModel(definition)
    expect(definition.foes!.length).toBeGreaterThanOrEqual(6)
    for (const foe of definition.foes!) for (const cell of foe.route) {
      expect(model.foeOpen(foe.kind, cell.col, cell.row), `${foe.id} at ${cell.col},${cell.row}`).toBe(true)
    }
  })
})

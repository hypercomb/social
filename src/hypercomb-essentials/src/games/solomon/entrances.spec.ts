import { describe, expect, it } from 'vitest'
import { ChamberModel, type ChamberEvent, type MoveInput } from './chamber.js'
import { CHAMBERS } from './chamber-places.js'
import { SIM_DT, TILE, WALL } from './engine.js'
import { LabyrinthJourney, roomId, squareEntrance } from './labyrinth.js'
import { validateStory } from './place.js'
import { PLACES } from './places.js'
import { ROOT_PLACE, STORY } from './story.js'

// Being an entrance is a mark, never a kind (jwize, 2026-09-22): whatever the
// story seats a place behind becomes a way in — in a world, in a cavern
// chamber, in a labyrinth room alike.

const STILL: MoveInput = { up: false, down: false, left: false, right: false }

describe('anything in a cavern can lead in', () => {
  const grove = CHAMBERS.find(chamber => chamber.id === 'hollow-grove')!

  it('lets the story seat a place behind any thing in a chamber or any square of a room', () => {
    const seats = [
      ...STORY,
      { entrance: 'hollow-grove/bark-marks', place: 'wet-steps' },
      { entrance: 'hollow-grove/pool-chest', place: 'cistern' },
      { entrance: `labyrinth/${squareEntrance(roomId('sunseed', 'porch'), { col: 5, row: 1 })}`, place: 'greenwood' },
    ]
    expect(validateStory(seats, PLACES, ROOT_PLACE)).toEqual([])
    expect(PLACES.get('hollow-grove')?.entrances).toEqual(expect.arrayContaining(['bark-marks', 'boulder-chest', 'pool-chest']))
  })

  it('takes you in through a seated tablet when you walk into it, and leaves an unseated one a tablet', () => {
    const seated = new Set(['bark-marks'])
    const model = new ChamberModel(grove, { seat: id => seated.has(id) })
    expect(model.leadsIn('bark-marks')).toBe(true)
    expect(model.leadsIn('boulder-chest')).toBe(false)
    // Stand under the bark marks and walk up into them.
    model.restoreState({ version: 1, place: 'hollow-grove', player: { x: 8.5, y: 8.5, facing: 'up' } })
    const events: ChamberEvent[] = []
    for (let i = 0; i < 60 && !events.some(event => event.kind === 'navigate'); i++) events.push(...model.update(SIM_DT, { ...STILL, up: true }))
    expect(events).toContainEqual({ kind: 'navigate', to: 'down', entrance: 'bark-marks' })
    // Back from below: standing where you went in, and it does not take you
    // again until you step away.
    model.land('bark-marks')
    expect(model.x).toBeCloseTo(8.5, 1)
    const again: ChamberEvent[] = []
    for (let i = 0; i < 60; i++) again.push(...model.update(SIM_DT, { ...STILL, up: true }))
    expect(again.some(event => event.kind === 'navigate')).toBe(false)
  })

  it('keeps a seated person a person: E still talks, and walking into them takes you in', () => {
    const model = new ChamberModel(grove, { seat: id => id === 'nettle' })
    expect(model.leadsIn('nettle')).toBe(true)
    // Beside Nettle, facing her.
    model.restoreState({ version: 1, place: 'hollow-grove', player: { x: 19.5, y: 7.5, facing: 'right' } })
    expect(model.interact('nettle').kind).toBe('speech')
    const events: ChamberEvent[] = []
    for (let i = 0; i < 60 && !events.some(event => event.kind === 'navigate'); i++) events.push(...model.update(SIM_DT, { ...STILL, right: true }))
    expect(events).toContainEqual({ kind: 'navigate', to: 'down', entrance: 'nettle' })
    // Unseated, the same walk is just a walk into someone.
    const plain = new ChamberModel(grove)
    plain.restoreState({ version: 1, place: 'hollow-grove', player: { x: 19.5, y: 7.5, facing: 'right' } })
    const none: ChamberEvent[] = []
    for (let i = 0; i < 60; i++) none.push(...plain.update(SIM_DT, { ...STILL, right: true }))
    expect(none.some(event => event.kind === 'navigate')).toBe(false)
  })
})

describe('any square of a labyrinth room can lead in', () => {
  function porch(): LabyrinthJourney {
    const journey = new LabyrinthJourney()
    journey.grantRelic({ id: 'mira-dawn-triangle', kind: 'triangle', point: 0 })
    expect(journey.enterLabyrinth('sunseed')).toBe(true)
    return journey
  }

  it('passes you into an open square the moment you step into it, once, until you step away', () => {
    const journey = porch(), engine = journey.engine!
    const square = { col: 5, row: 10 }
    const seated = new Map([[squareEntrance(journey.room!.id, square), square]])
    expect(journey.enteringSquare(seated, SIM_DT)).toBeNull()
    engine.arrive(square)
    journey.update(SIM_DT)
    expect(journey.enteringSquare(seated, SIM_DT)).toBe(squareEntrance(journey.room!.id, square))
    expect(journey.enteringSquare(seated, SIM_DT)).toBeNull()
    engine.arrive({ col: 8, row: 10 })
    journey.update(SIM_DT)
    expect(journey.enteringSquare(seated, SIM_DT)).toBeNull()
    engine.arrive(square)
    journey.update(SIM_DT)
    expect(journey.enteringSquare(seated, SIM_DT)).toBe(squareEntrance(journey.room!.id, square))
  })

  it('takes you through a stone in the wall when you walk against it a moment', () => {
    const journey = porch(), engine = journey.engine!
    // The loop door's own wall: the room's west stone beside the spawn.
    const stone = { col: 0, row: 10 }
    expect(engine.tileAt(stone.col, stone.row)).toBe(WALL)
    const entrance = squareEntrance(journey.room!.id, stone)
    const seated = new Map([[entrance, stone]])
    engine.arrive({ col: 1, row: 10 }, -1)
    let into: string | null = null
    for (let i = 0; i < 60 && !into; i++) {
      Object.assign(engine.input, { left: true, right: false, jump: false, down: false })
      journey.update(SIM_DT)
      into = journey.enteringSquare(seated, SIM_DT)
    }
    expect(into).toBe(entrance)
    expect(engine.player.x / TILE).toBeLessThan(2)
  })
})

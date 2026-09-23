import { describe, expect, it } from 'vitest'
import { BRICK, EMPTY, Engine, TILE, WALL, type LevelDef } from './engine.js'
import { LABYRINTHS, LabyrinthJourney, ROOM_COLS, ROOM_ROWS, ROOMS, roomId, type RoomDef, type RoomRelic } from './labyrinth.js'

function start(): LabyrinthJourney {
  const journey = new LabyrinthJourney()
  journey.grantRelic({ id: 'elder-first-point', kind: 'triangle', point: 0 })
  expect(journey.enterLabyrinth('sunseed')).toBe(true)
  return journey
}

function collect(journey: LabyrinthJourney, relic: RoomRelic): void {
  journey.engine!.arrive(relic)
  journey.update(0)
  expect(journey.collected(relic.id)).toBe(true)
}

/** An open square in every room, well away from its doors. */
const AWAY = { col: 7, row: 1 }

/** Walk the door graph. A keyed door's key is the room's own business, and
 *  the physical playthrough fights for every one; here the key is simply in
 *  hand. */
function travel(journey: LabyrinthJourney, id: string): void {
  journey.engine!.arrive(AWAY)
  journey.update(0) // leave the arrival door before deliberately returning
  const door = journey.room!.doors.find(candidate => candidate.id === id)!
  if (door.keyed) journey.engine!.doorOpen = true
  journey.engine!.arrive(door)
  expect(journey.useDoor(id).kind).toBe('travelled')
}

describe('the interconnected Solomon labyrinth', () => {
  it('authors original-size square grids with valid, reciprocal door graphs', () => {
    expect([ROOM_COLS, ROOM_ROWS]).toEqual([16, 12])
    const relicIds = new Set<string>()
    for (const room of ROOMS) {
      expect([room.level.cols, room.level.rows]).toEqual([16, 12])
      expect(room.level.tiles).toHaveLength(192)
      for (const door of room.doors) {
        expect(room.level.tiles[door.row * ROOM_COLS + door.col]).toBe(EMPTY)
        const target = ROOMS.find(candidate => candidate.id === door.targetRoomId)!
        const reverse = target.doors.find(candidate => candidate.id === door.targetDoorId)!
        expect(reverse.targetRoomId).toBe(room.id)
        expect(reverse.targetDoorId).toBe(door.id)
      }
      for (const relic of room.relics) {
        expect(relicIds.has(relic.id)).toBe(false)
        relicIds.add(relic.id)
        expect(room.level.tiles[relic.row * ROOM_COLS + relic.col]).toBe(EMPTY)
        expect(room.level.tiles[(relic.row + 1) * ROOM_COLS + relic.col]).not.toBe(EMPTY)
      }
    }
    for (const labyrinth of LABYRINTHS) {
      const reachable = new Set<string>(), pending = [labyrinth.entryRoomId]
      while (pending.length) {
        const id = pending.pop()!
        if (reachable.has(id)) continue
        reachable.add(id)
        pending.push(...ROOMS.find(room => room.id === id)!.doors.map(door => door.targetRoomId))
      }
      expect(reachable.size).toBe(4)
      expect([...reachable].every(id => ROOMS.find(room => room.id === id)!.labyrinthId === labyrinth.id)).toBe(true)
      expect(new Set([...reachable].map(id => ROOMS.find(room => room.id === id)!.depth)).size).toBe(3)
    }
  })

  it('draws every room its own way: a key the way on waits for, foes to fight, and finds buried both in stone and in the air', () => {
    expect(ROOMS).toHaveLength(12)
    expect(new Set(ROOMS.map(room => room.level.tiles.join(''))).size).toBe(ROOMS.length)
    for (const room of ROOMS) {
      const { level } = room, at = (col: number, row: number): number => level.tiles[row * level.cols + col]
      expect(level.items.filter(item => item.kind === 'key'), room.id).toHaveLength(1)
      const onward = room.doors.filter(door => door.id === 'deeper' || door.id === 'home')
      expect(onward.length, room.id).toBeGreaterThan(0)
      for (const door of onward) expect(door.keyed, `${room.id} ${door.id}`).toBe(true)
      for (const door of room.doors.filter(door => door.id !== 'deeper' && door.id !== 'home')) expect(door.keyed, `${room.id} ${door.id}`).toBeUndefined()
      expect(level.enemies.length + level.mirrors.length, room.id).toBeGreaterThan(0)
      const buried = level.items.filter(item => item.hidden)
      expect(buried.length, room.id).toBeGreaterThanOrEqual(3)
      // In a brick: break it. In the air: the wand finds it (or walls it in first).
      expect(buried.some(item => !item.secret && at(item.col, item.row) === BRICK), room.id).toBe(true)
      expect(buried.some(item => item.secret && at(item.col, item.row) === EMPTY), room.id).toBe(true)
    }
  })

  it('counts the door she is set down beside as her arrival door, so a spawn, a retry or a respawn never passes straight through it', () => {
    const journey = start()
    journey.grantRelic({ id: 'test-hexagon', kind: 'hexagon' })
    // Every room starts beside its way back: the loop door is one step west.
    expect(journey.room!.doors.find(door => door.id === journey.arrivalDoor)).toMatchObject({ id: 'loop', col: 1, row: 10 })
    expect(journey.useDoor('loop').kind).toBe('out-of-range')
    journey.update(0)
    expect(journey.arrivalDoor).toBe('loop')
    travel(journey, 'loop')
    expect(journey.room!.id).toBe(roomId('sunseed', 'heart'))
    expect(journey.arrivalDoor).toBe('home')
    journey.engine!.arrive(AWAY)
    journey.update(0)
    expect(journey.arrivalDoor).toBeNull()
    // A retry sets her down at the start, beside the door to the loft.
    expect(journey.retryCurrent()).toBe(true)
    expect(journey.arrivalDoor).toBe('return')
    // So does a death.
    travel(journey, 'home')
    expect(journey.room!.id).toBe(roomId('sunseed', 'porch'))
    collect(journey, journey.room!.relics[0]!)
    travel(journey, 'deeper')
    expect(journey.room!.id).toBe(roomId('sunseed', 'steps'))
    journey.engine!.arrive(AWAY)
    journey.update(0)
    expect(journey.arrivalDoor).toBeNull()
    const foe = journey.room!.level.enemies[0]!
    const lives = journey.engine!.lives
    journey.engine!.arrive(foe)
    journey.update(1 / 60)
    expect(journey.engine!.lives).toBe(lives - 1)
    expect(journey.engine!.state).toBe('playing')
    expect(journey.arrivalDoor).toBe('return')
  })

  it('progresses from an NPC point through room pickups to the pyramid without spending abilities', () => {
    const journey = new LabyrinthJourney()
    expect(journey.canEnterLabyrinth('sunseed')).toBe(false)
    expect(journey.canEnterLabyrinth('tideglass')).toBe(false)
    journey.grantRelic({ id: 'elder-first-point', kind: 'triangle', point: 0 })
    expect(journey.enterLabyrinth('sunseed')).toBe(true)
    collect(journey, journey.room!.relics[0])
    travel(journey, 'deeper')
    collect(journey, journey.room!.relics[0])
    travel(journey, 'deeper')
    travel(journey, 'deeper')
    collect(journey, journey.room!.relics[0])
    expect(journey.completed.has('sunseed')).toBe(true)
    expect(journey.canEnterLabyrinth('tideglass')).toBe(true)
    expect(journey.inventory.triangles.size).toBe(3)
    travel(journey, 'home')
    expect(journey.inventory.hexagon).toBe(true)
    journey.leave()
    expect(journey.enterLabyrinth('tideglass')).toBe(true)
    collect(journey, journey.room!.relics[0])
    travel(journey, 'deeper')
    collect(journey, journey.room!.relics[0])
    travel(journey, 'fold')
    collect(journey, journey.room!.relics[0])
    expect(journey.inventory.triangles.size).toBe(6)
    expect(journey.inventory.star).toBe(true)
    expect(journey.canEnterLabyrinth('starbloom')).toBe(true)
    journey.leave()
    expect(journey.enterLabyrinth('starbloom')).toBe(true)
    travel(journey, 'deeper')
    travel(journey, 'fold')
    collect(journey, journey.room!.relics[0])
    expect([...journey.completed]).toEqual(['sunseed', 'tideglass', 'starbloom'])
    expect(journey.inventory.triangles.size).toBe(6)
    expect(journey.inventory.hexagon).toBe(true)
  })

  it('requires deliberate nearby door use and does not finish a room by touching its legacy exit', () => {
    const journey = start(), door = journey.room!.doors.find(candidate => candidate.id === 'deeper')!
    expect(journey.useDoor('deeper').kind).toBe('out-of-range')
    journey.engine!.arrive(door)
    journey.update(0)
    expect(journey.engine!.state).toBe('playing')
    expect(journey.useDoor().kind).toBe('locked')
    journey.grantRelic({ id: 'test-point-1', kind: 'triangle', point: 1 })
    // The sigil is held; the way on still waits for the room's own key.
    expect(journey.useDoor()).toEqual({ kind: 'locked', message: 'This room’s key opens this door.' })
    const key = journey.engine!.items.find(item => item.kind === 'key')!
    journey.engine!.arrive(key)
    journey.update(0)
    expect(journey.engine!.doorOpen).toBe(true)
    journey.engine!.arrive(door)
    journey.update(0)
    expect(journey.useDoor().kind).toBe('travelled')
    expect(journey.useDoor('return').kind).toBe('out-of-range')
    expect(journey.room!.id).toBe(roomId('sunseed', 'steps'))
  })

  it('starts every room fresh on return — blocks, enemies and items reset — while stats and relics follow the player', () => {
    const journey = start()
    const porchRelic = journey.room!.relics[0]
    collect(journey, porchRelic)
    travel(journey, 'deeper')
    const steps = journey.engine!
    steps.setTile(4, 2, BRICK)
    steps.enemies[0].alive = false
    steps.items[0].taken = true
    steps.lives = 2
    steps.ammo = [true, false]
    steps.score = 4500
    travel(journey, 'return')
    // The room she left is forgotten the moment she leaves it.
    expect(journey.engines.has(roomId('sunseed', 'steps'))).toBe(false)
    expect(journey.engine!.lives).toBe(2)
    expect(journey.engine!.ammo).toEqual([true, false])
    expect(journey.engine!.score).toBe(4500)
    // The relic she took there is hers for good and does not lie there again.
    expect(journey.collected(porchRelic.id)).toBe(true)
    journey.engine!.arrive(porchRelic)
    journey.update(0)
    expect(journey.engine!.score).toBe(4500)
    journey.engine!.score += 500
    travel(journey, 'deeper')
    const again = journey.engine!
    expect(again).not.toBe(steps)
    expect(again.tileAt(4, 2)).toBe(EMPTY)
    expect(again.enemies.some(enemy => enemy.alive)).toBe(true)
    expect(again.items[0].taken).toBe(false)
    expect(again.score).toBe(5000)
    expect(again.lives).toBe(2)
    expect([...journey.engines.keys()]).toEqual([roomId('sunseed', 'steps')])
    // Going up to the island and back in lands in the same room, fresh: the
    // shell re-enters the labyrinth without ever calling leave().
    again.setTile(4, 2, BRICK)
    expect(journey.enterLabyrinth('sunseed')).toBe(true)
    expect(journey.room!.id).toBe(roomId('sunseed', 'steps'))
    expect(journey.engine).not.toBe(again)
    expect(journey.engine!.tileAt(4, 2)).toBe(EMPTY)
    expect(journey.engine!.lives).toBe(2)
  })

  it('opens ability gates permanently and awards each relic only once, including after retry', () => {
    const journey = start(), relic = journey.room!.relics[0], gate = journey.room!.gates[0]
    expect(journey.engine!.tileAt(gate.col, gate.row)).toBe(WALL)
    collect(journey, relic)
    const score = journey.engine!.score
    expect(journey.engine!.tileAt(gate.col, gate.row)).toBe(EMPTY)
    journey.update(0)
    expect(journey.engine!.score).toBe(score)
    expect(journey.grantRelic(relic)).toBe(false)
    journey.engine!.state = 'gameover'
    journey.engine!.lives = 0
    expect(journey.retryCurrent()).toBe(true)
    expect(journey.engine!.lives).toBe(3)
    expect(journey.inventory.triangles.has(1)).toBe(true)
    expect(journey.engine!.tileAt(gate.col, gate.row)).toBe(EMPTY)
    collect(journey, relic)
    expect(journey.engine!.score).toBe(score)
  })

  it('uses native hydrated cells and metadata as the room source, keeping the live room while she stands in it and rebuilding it fresh after she leaves', () => {
    const authored = ROOMS[0]
    const native: RoomDef = { ...authored, level: { ...authored.level, name: 'Native Sun Porch', tiles: [...authored.level.tiles] } }
    native.level.tiles[2 * ROOM_COLS + 4] = WALL
    const journey = new LabyrinthJourney()
    journey.replaceRoom(native)
    journey.grantRelic({ id: 'elder-first-point', kind: 'triangle', point: 0 })
    journey.enterLabyrinth('sunseed')
    expect(journey.room).toBe(native)
    expect(journey.engine!.tileAt(4, 2)).toBe(WALL)
    journey.engine!.setTile(4, 2, BRICK)
    // Hydration never replaces the room she is standing in.
    journey.replaceRoom(authored)
    expect(journey.room).toBe(native)
    journey.leave()
    expect(journey.engines.size).toBe(0)
    journey.enterLabyrinth('sunseed')
    // Fresh from its definition: the conjured block is gone.
    expect(journey.engine!.tileAt(4, 2)).toBe(WALL)
    expect(journey.room).toBe(native)
  })

  it('retains single-room automatic exits and resets casting position on a depth arrival', () => {
    const engine = new Engine({ ...ROOMS[0].level, interconnected: false })
    engine.arrive(engine.items.find(item => item.kind === 'key')!)
    engine.update(0)
    engine.arrive(engine.level.door)
    engine.update(0)
    expect(engine.state).toBe('won')
    const journey = start()
    journey.engine!.arrive({ col: 7, row: 4 }, -1)
    expect(journey.engine!.player.x).toBeCloseTo(7 * TILE + (TILE - journey.engine!.player.w) / 2)
    expect(journey.engine!.targetCell()).toEqual({ col: 6, row: 4 })
  })

  it('rejects malformed or repeated NPC gifts and enforces every shrine socket', () => {
    const journey = new LabyrinthJourney()
    expect(journey.grantRelic({ id: '', kind: 'triangle', point: 0 })).toBe(false)
    expect(journey.grantRelic({ id: 'bad', kind: 'triangle', point: 6 })).toBe(false)
    expect(journey.grantRelic({ id: 'bad', kind: 'triangle', point: 1.2 })).toBe(false)
    expect(journey.grantRelic({ id: 'center', kind: 'hexagon' })).toBe(true)
    expect(journey.canEnterLabyrinth('tideglass')).toBe(false)
    journey.grantRelic({ id: 'point1', kind: 'triangle', point: 1 })
    expect(journey.canEnterLabyrinth('tideglass')).toBe(false)
    journey.grantRelic({ id: 'point2', kind: 'triangle', point: 2 })
    expect(journey.canEnterLabyrinth('tideglass')).toBe(true)
    expect(journey.inventory.hexagon).toBe(true)
  })

  it('restores permanent discoveries after closing without re-awarding them or accepting invented relics', () => {
    const journey = new LabyrinthJourney()
    journey.grantRelic({ id: 'mira-dawn-triangle', kind: 'triangle', point: 0 })
    for (const room of ROOMS.filter(candidate => candidate.labyrinthId !== 'starbloom')) {
      for (const relic of room.relics) journey.grantRelic(relic)
    }
    journey.enterLabyrinth('sunseed')
    journey.engine!.setTile(4, 2, BRICK)
    const saved = JSON.parse(JSON.stringify(journey.exportProgress()))
    const restored = new LabyrinthJourney()
    restored.restoreProgress(saved)
    expect(restored.inventory.triangles.size).toBe(6)
    expect(restored.inventory.hexagon).toBe(true)
    expect(restored.inventory.star).toBe(true)
    expect([...restored.completed]).toEqual(['sunseed', 'tideglass'])
    expect(restored.enterLabyrinth('sunseed')).toBe(true)
    expect(restored.engine!.tileAt(4, 2)).toBe(EMPTY)
    expect(restored.engine!.score).toBe(saved.score)
    collect(restored, restored.room!.relics[0])
    expect(restored.engine!.score).toBe(saved.score)
    restored.restoreProgress(saved)
    expect(restored.engine!.score).toBe(saved.score)
    const invalid = new LabyrinthJourney()
    invalid.restoreProgress({ version: 1, relicIds: ['invented-star', 'bad-point', 4], score: -100 })
    invalid.restoreProgress({ version: 200, relicIds: ['mira-dawn-triangle'] })
    expect(invalid.inventory.relicIds.size).toBe(0)
    expect(invalid.inventory.star).toBe(false)
    expect(invalid.exportProgress().score).toBe(0)
  })

  it('pays off the expedition clue by making then breaking stone above the highest left porch shelf', () => {
    for (const id of [roomId('sunseed', 'porch'), roomId('tideglass', 'porch')]) {
      const room = ROOMS.find(candidate => candidate.id === id)!
      const engine = new Engine(room.level)
      const secret = engine.items.find(item => item.secret && item.deep)!
      // Over the left end of the room's highest left shelf, as the crystals say.
      const shelf = { col: secret.col, row: secret.row + 1 }
      expect(engine.tileAt(shelf.col, shelf.row)).toBe(BRICK)
      expect(engine.tileAt(shelf.col - 1, shelf.row)).not.toBe(BRICK)
      for (let row = 1; row < shelf.row; row++) for (let col = 1; col < ROOM_COLS / 2; col++) expect(engine.tileAt(col, row)).not.toBe(BRICK)
      expect(engine.tileAt(secret.col, secret.row)).toBe(EMPTY)
      engine.arrive({ col: secret.col + 1, row: secret.row }, -1)
      expect(engine.targetCell()).toEqual({ col: secret.col, row: secret.row })
      expect(engine.cast()).toBe('conjure')
      expect(engine.tileAt(secret.col, secret.row)).toBe(BRICK)
      expect(secret.hidden).toBe(true)
      expect(engine.cast()).toBe('dispel')
      expect(engine.tileAt(secret.col, secret.row)).toBe(EMPTY)
      expect(secret.hidden).toBe(false)
      expect(engine.secretFlash).toBe(1)
      engine.arrive({ col: secret.col, row: secret.row })
      engine.update(0)
      expect(secret.taken).toBe(true)
      expect(engine.score).toBe(5000)
      engine.update(0)
      expect(engine.score).toBe(5000)
    }
  })
})

// The Hush's own combat state, exercised at the Engine level only — the
// LabyrinthJourney banking (`JourneyStats.kit`/`.weapon`/`.spell`, `#bank()`,
// the `applyBarriers()` call in `#enter()`, `nearDoor()`'s solidity guard) and
// the §6.11 room content itself (buildRooms()/chamber()) are stage 2's own
// integration work; the assertions below prove the ENGINE mechanics that
// integration depends on, using Engine directly, exactly like the rest of
// this file's ROOMS-grounded specs above.
describe('combat state — engine-level (stage 1); LabyrinthJourney integration is stage 2', () => {
  it('kit/weapon/spell survive a death + respawn, and are cleared only by a fresh load(), never by spawn()', () => {
    const engine = new Engine(ROOMS[0]!.level)
    engine.kit.push('stand', 'sickle')
    engine.weapon = 'sickle'
    engine.lives = 2
    engine.life = 1   // one more tick of drain kills Dana and calls spawn()
    engine.update(1)
    expect(engine.lives).toBe(1)
    expect(engine.kit).toEqual(['stand', 'sickle'])
    expect(engine.weapon).toBe('sickle')
    engine.load(ROOMS[0]!.level)
    expect(engine.kit).toEqual([])
    expect(engine.weapon).toBeNull()
  })

  it('#definitionKey is length-gated: byte-identical with no combat items, and only changes once one is added — an old save for existing content is never disturbed', () => {
    const cols = 6, rows = 6
    const bareTiles = new Array(cols * rows).fill(EMPTY)
    const bare: LevelDef = { name: 'k', cols, rows, tiles: bareTiles, player: { col: 1, row: 1 }, door: { col: 4, row: 4 }, enemies: [], items: [], mirrors: [] }
    const withCombat: LevelDef = { ...bare, items: [{ col: 2, row: 2, kind: 'stele', gives: 'ward' }] }
    const keyBare = new Engine(bare).exportState().definitionKey
    const keyBareAgain = new Engine({ ...bare, items: [] }).exportState().definitionKey
    const keyCombat = new Engine(withCombat).exportState().definitionKey
    expect(keyBareAgain).toBe(keyBare)
    expect(keyCombat).not.toBe(keyBare)
  })

  it('a barrier sealing a real door’s own cell is exactly the case nearDoor()’s new solidity guard exists for (M6)', () => {
    const door = ROOMS[0]!.doors[0]!
    const level: LevelDef = { ...ROOMS[0]!.level, items: [...ROOMS[0]!.level.items, { col: door.col, row: door.row, kind: 'barrier', needs: 'ember' }] }
    const engine = new Engine(level)
    expect(engine.solidAt(door.col, door.row)).toBe(true)
    engine.kit.push('ember')
    engine.applyBarriers()
    expect(engine.solidAt(door.col, door.row)).toBe(false)
  })

  it('reachability contract: a stele/chest sits on solid-floored, walkable ground and is approachable from a side (mechanism proof — the real §6.11 placements land with the labyrinth.ts/levels.ts integration, stage 2)', () => {
    const cols = 8, rows = 6
    const tiles = new Array(cols * rows).fill(EMPTY)
    for (let c = 0; c < cols; c++) { tiles[c] = WALL; tiles[(rows - 1) * cols + c] = WALL }
    for (let r = 0; r < rows; r++) { tiles[r * cols] = WALL; tiles[r * cols + cols - 1] = WALL }
    for (let c = 0; c < cols; c++) tiles[(rows - 2) * cols + c] = WALL   // solid floor
    const standRow = rows - 3
    const placements = [
      { col: 3, row: standRow, kind: 'stele' as const },
      { col: 4, row: standRow, kind: 'chest' as const },
    ]
    const level: LevelDef = {
      name: 'reach', cols, rows, tiles,
      player: { col: 1, row: standRow }, door: { col: cols - 2, row: standRow },
      enemies: [], items: placements.map(p => ({ ...p, gives: 'ward' as const })), mirrors: [],
    }
    const engine = new Engine(level)
    for (const p of placements) {
      expect(engine.tileAt(p.col, p.row)).toBe(EMPTY)                        // walkable
      expect(engine.solidAt(p.col, p.row + 1)).toBe(true)                    // solid ground beneath
      const east = !engine.solidAt(p.col + 1, p.row), west = !engine.solidAt(p.col - 1, p.row)
      expect(east || west).toBe(true)                                       // approachable from a side
    }
  })
})

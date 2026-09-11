import { BRICK, EMPTY, Engine, LIFE_FULL, MAX_AMMO, SCROLL_CAP, TILE, WALL, type Cell, type LevelDef, type EngineSnapshot } from './engine.js'

// NES terrain is two bytes per row, twelve rows per room:
// https://datacrystal.tcrf.net/wiki/Solomon%27s_Key/ROM_map
export const ROOM_COLS = 16
export const ROOM_ROWS = 12

export type SigilRequirement =
  | { kind: 'triangle'; point?: number; count?: number }
  | { kind: 'hexagon' }
  | { kind: 'star' }
  | { kind: 'all'; requirements: SigilRequirement[] }

export interface RoomDoor extends Cell {
  id: string
  targetRoomId: string
  targetDoorId: string
  requires?: SigilRequirement
}
export interface RoomRelic extends Cell { id: string; kind: 'triangle' | 'hexagon' | 'star'; point?: number; lore?: string }
export interface RoomGate extends Cell { requires: SigilRequirement }
export interface RoomDef {
  id: string
  labyrinthId: string
  depth: number
  level: LevelDef
  doors: RoomDoor[]
  relics: RoomRelic[]
  gates: RoomGate[]
}
export interface LabyrinthDef {
  id: string
  name: string
  description: string
  entryRoomId: string
  requires?: SigilRequirement
  /** Collecting this labyrinth's final relic marks it explored. */
  goalRelicId: string
  color: string
}
export interface SigilInventory {
  triangles: Set<number>
  hexagon: boolean
  /** Becomes permanent as soon as the center and all six points are held. */
  star: boolean
  relicIds: Set<string>
}
export interface JourneyProgress {
  version: 1
  relicIds: string[]
  score: number
  fairyCount: number
}
export interface JourneyStats {
  score: number; lives: number; fairyCount: number; sealCount: number
  pageTime: boolean; pageSpace: boolean; ammo: boolean[]; ammoCap: number
}
export interface JourneySnapshot {
  version: 1
  roomIds: string[]
  activeRoomId: string | null
  rooms: { id: string; topologyKey: string; state: EngineSnapshot }[]
  progress: JourneyProgress
  visited: string[]
  lastRooms: [labyrinthId: string, roomId: string][]
  arrivalDoorId: string | null
  stats: JourneyStats
}
const saveObject = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw)
const saveInteger = (raw: unknown, max: number): raw is number => typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= max
function roomTopology(room: RoomDef): string {
  const requirement = (value?: SigilRequirement): unknown => !value ? null : value.kind === 'all'
    ? ['all', value.requirements.map(requirement)] : value.kind === 'triangle' ? ['triangle', value.point ?? null, value.count ?? null] : [value.kind]
  return JSON.stringify([
    room.id, room.labyrinthId, room.depth,
    [...room.doors].sort((a, b) => a.id.localeCompare(b.id)).map(d => [d.id, d.col, d.row, d.targetRoomId, d.targetDoorId, requirement(d.requires)]),
    [...room.relics].sort((a, b) => a.id.localeCompare(b.id)).map(r => [r.id, r.col, r.row, r.kind, r.point ?? null]),
    [...room.gates].sort((a, b) => a.row - b.row || a.col - b.col).map(g => [g.col, g.row, requirement(g.requires)]),
  ])
}
const NPC_RELICS: readonly RoomRelic[] = [{ id: 'mira-dawn-triangle', kind: 'triangle', point: 0, col: 0, row: 0 }]
export type DoorResult = { kind: 'travelled' | 'locked' | 'out-of-range' | 'inactive'; message: string }

export function describeRequirement(requirement?: SigilRequirement): string {
  if (!requirement) return 'Open passage'
  if (requirement.kind === 'all') return requirement.requirements.map(describeRequirement).join(' + ')
  if (requirement.kind === 'hexagon') return 'Central hexagon'
  if (requirement.kind === 'star') return 'Complete Star of David'
  if (requirement.point !== undefined) return `Triangle ${requirement.point + 1}`
  return `${requirement.count ?? 1} triangle${(requirement.count ?? 1) === 1 ? '' : 's'}`
}

export const LABYRINTHS: LabyrinthDef[] = [
  { id: 'sunseed', name: 'Sunseed Rooms', description: 'Find two more points and the central hexagon.', entryRoomId: 'sunseed-porch', requires: { kind: 'triangle', point: 0 }, goalRelicId: 'sunseed-center', color: '#efbd58' },
  { id: 'tideglass', name: 'Tideglass Rooms', description: 'Find the remaining points to assemble your star.', entryRoomId: 'tideglass-porch', requires: { kind: 'all', requirements: [{ kind: 'hexagon' }, { kind: 'triangle', point: 1 }, { kind: 'triangle', point: 2 }] }, goalRelicId: 'tideglass-point-5', color: '#58c5c5' },
  { id: 'starbloom', name: 'Pyramid of Accord', description: 'Open the star passages and reach the heart of the pyramid.', entryRoomId: 'starbloom-porch', requires: { kind: 'star' }, goalRelicId: 'starbloom-heart', color: '#b693ed' },
]

/** Authored compact chambers. Every coordinate describes exactly one native tile. */
function chamber(labyrinthId: string, suffix: string, name: string, depth: number, layout: number): RoomDef {
  const tiles: number[] = Array.from({ length: ROOM_COLS * ROOM_ROWS }, (_, i) => {
    const col = i % ROOM_COLS, row = Math.floor(i / ROOM_COLS)
    return col === 0 || col === ROOM_COLS - 1 || row === 0 || row === ROOM_ROWS - 1 ? WALL : EMPTY
  })
  const ledge = (col: number, row: number, length: number): void => {
    for (let offset = 0; offset < length; offset++) tiles[row * ROOM_COLS + col + offset] = BRICK
  }
  // Two-tile rises are within Dana's jump; the wand can extend any shelf.
  ledge(3, 9, 4)
  ledge(6, 7, 4)
  ledge(6, 5, 4)
  if (layout % 2) { ledge(11, 9, 3); ledge(2, 6, 2) }
  else { ledge(11, 7, 3); ledge(2, 3, 3) }
  const theme = labyrinthId === 'sunseed' ? 'sandstone' : labyrinthId === 'tideglass' ? 'verdant' : 'crystal'
  return {
    id: `${labyrinthId}-${suffix}`, labyrinthId, depth,
    level: {
      name, cols: ROOM_COLS, rows: ROOM_ROWS, tiles, player: { col: 2, row: 10 }, door: { col: 14, row: 10 },
      enemies: layout === 0 ? [] : [{ col: 12, row: 10, kind: layout === 3 ? 'gargoil' : 'goblin', dir: -1 }],
      items: [{ col: 4, row: 8, kind: layout === 0 ? 'bell' : 'jar' }, { col: 8, row: 6, kind: 'jewel', value: 500 }],
      mirrors: [], lifeStart: LIFE_FULL * 1.8, theme, interconnected: true,
    },
    doors: [], relics: [], gates: [],
  }
}

function join(a: RoomDef, aId: string, aCell: Cell, b: RoomDef, bId: string, bCell: Cell, requires?: SigilRequirement): void {
  a.doors.push({ ...aCell, id: aId, targetRoomId: b.id, targetDoorId: bId, requires })
  b.doors.push({ ...bCell, id: bId, targetRoomId: a.id, targetDoorId: aId, requires })
}

function buildRooms(): RoomDef[] {
  const all: RoomDef[] = []
  for (const [index, labyrinth] of LABYRINTHS.entries()) {
    const id = labyrinth.id
    const rooms = [
      chamber(id, 'porch', ['The Sun Porch', 'Tideglass Landing', 'Starbloom Landing'][index], 0, 0),
      chamber(id, 'steps', ['Amber Steps', 'The Glass Steps', 'Violet Steps'][index], 1, 1),
      chamber(id, 'loft', ['The Turning Loft', 'Moonlit Loft', 'The Folded Loft'][index], 2, 2),
      chamber(id, 'heart', ['The Hexagon Garden', 'Six-Point Garden', 'The Starbloom Heart'][index], 1, 3),
    ]
    const [porch, steps, loft, heart] = rooms
    const pointBase = index === 0 ? 1 : index * 3
    join(porch, 'deeper', { col: 14, row: 10 }, steps, 'return', { col: 1, row: 10 }, index < 2 ? { kind: 'triangle', point: pointBase } : { kind: 'star' })
    join(steps, 'deeper', { col: 14, row: 10 }, loft, 'return', { col: 1, row: 10 })
    join(loft, 'deeper', { col: 14, row: 10 }, heart, 'return', { col: 1, row: 10 }, index === 0 ? { kind: 'triangle', point: 2 } : index === 1 ? { kind: 'triangle', point: 4 } : { kind: 'star' })
    join(heart, 'home', { col: 14, row: 10 }, porch, 'loop', { col: 1, row: 10 }, index === 0 ? { kind: 'hexagon' } : { kind: 'star' })
    // A second route cuts between depths: the maze is a graph, not a level list.
    join(steps, 'fold', { col: 7, row: 4 }, heart, 'fold', { col: 7, row: 4 }, index === 0 ? { kind: 'triangle', point: 2 } : index === 1 ? { kind: 'triangle', point: 4 } : { kind: 'star' })
    if (index === 0) {
      porch.relics.push({ id: 'sunseed-point-1', kind: 'triangle', point: 1, col: 5, row: 8, lore: 'The amber shelves lead to another point above the steps.' })
      steps.relics.push({ id: 'sunseed-point-2', kind: 'triangle', point: 2, col: 8, row: 6, lore: 'The high fold returns through the garden. Its center opens Tideglass.' })
      loft.level.items.push({ col: 8, row: 4, kind: 'superjar' })
      heart.relics.push({ id: 'sunseed-center', kind: 'hexagon', col: 12, row: 8, lore: 'A star needs a heart. Join this center with your first three points at Tideglass.' })
    } else if (index === 1) {
      porch.relics.push({ id: 'tideglass-point-3', kind: 'triangle', point: 3, col: 5, row: 8, lore: 'Moonlit glass carries the fourth point. Follow the steps upward.' })
      steps.relics.push({ id: 'tideglass-point-4', kind: 'triangle', point: 4, col: 8, row: 6, lore: 'The last point sleeps in the garden beyond the fold.' })
      heart.relics.push({ id: 'tideglass-point-5', kind: 'triangle', point: 5, col: 12, row: 8, lore: 'Six points around one heart: the Pyramid of Accord now hears your star.' })
      loft.level.items.push({ col: 8, row: 4, kind: 'superjar' })
    } else {
      heart.relics.push({ id: 'starbloom-heart', kind: 'star', col: 12, row: 8, lore: 'Every path has a way home. The pyramid is awake.' })
      loft.level.items.push({ col: 8, row: 4, kind: 'life' })
    }
    if (index < 2) {
      // The scrolling expedition's inscription names this exact empty square:
      // above the left end of the porch's highest shelf (col 2, row 3).
      // Its first cast makes a stone; breaking the same stone reveals the cache.
      porch.level.items.push({ col: 2, row: 2, kind: 'treasure', value: 5000, hidden: true, secret: true, deep: true })
    }
    // These linked square tiles visibly open as an ability is acquired.
    const requirement: SigilRequirement = index === 0 ? { kind: 'triangle', point: 1 } : index === 1 ? { kind: 'hexagon' } : { kind: 'star' }
    for (const row of [9, 10]) {
      porch.gates.push({ col: 10, row, requires: requirement })
      porch.level.tiles[row * ROOM_COLS + 10] = WALL
    }
    // Relics own their tile; ordinary pickups should not obscure the sigil.
    for (const room of rooms) room.level.items = room.level.items.filter(item => !room.relics.some(relic => relic.col === item.col && relic.row === item.row))
    all.push(...rooms)
  }
  return all
}

export const ROOMS: RoomDef[] = buildRooms()

function copyLevel(level: LevelDef): LevelDef {
  return { ...level, tiles: [...level.tiles], player: { ...level.player }, door: { ...level.door }, enemies: level.enemies.map(e => ({ ...e })), items: level.items.map(i => ({ ...i })), mirrors: level.mirrors.map(m => ({ ...m })) }
}

/** Pure journey logic; the view supplies native hydrated room definitions. */
export class LabyrinthJourney {
  readonly rooms: Map<string, RoomDef>
  readonly labyrinths: readonly LabyrinthDef[]
  readonly engines = new Map<string, Engine>()
  readonly visited = new Set<string>()
  readonly completed = new Set<string>()
  readonly inventory: SigilInventory = { triangles: new Set(), hexagon: false, star: false, relicIds: new Set() }
  room: RoomDef | null = null
  engine: Engine | null = null
  lastRelic: RoomRelic | null = null
  #arrivalDoor: string | null = null
  #lastRoom = new Map<string, string>()
  #stats = { score: 0, lives: 3, fairyCount: 0, sealCount: 0, pageTime: false, pageSpace: false, ammo: [] as boolean[], ammoCap: MAX_AMMO }

  constructor(rooms: readonly RoomDef[] = ROOMS, labyrinths: readonly LabyrinthDef[] = LABYRINTHS) {
    this.rooms = new Map(rooms.map(room => [room.id, room]))
    this.labyrinths = labyrinths
  }

  /** Native tile hydration replaces authored input before a room begins play. */
  replaceRoom(room: RoomDef): void {
    if (this.engines.has(room.id)) return
    this.rooms.set(room.id, room)
  }

  has(requirement?: SigilRequirement): boolean {
    if (!requirement) return true
    if (requirement.kind === 'all') return requirement.requirements.every(part => this.has(part))
    if (requirement.kind === 'hexagon') return this.inventory.hexagon
    if (requirement.kind === 'star') return this.inventory.star
    return requirement.point === undefined ? this.inventory.triangles.size >= (requirement.count ?? 1) : this.inventory.triangles.has(requirement.point)
  }

  collected(id: string): boolean { return this.inventory.relicIds.has(id) }

  exportState(): JourneySnapshot {
    this.#bank()
    return {
      version: 1, roomIds: [...this.engines.keys()], activeRoomId: this.room?.id ?? null,
      rooms: [...this.engines].map(([id, engine]) => ({ id, topologyKey: roomTopology(this.rooms.get(id)!), state: engine.exportState() })),
      progress: this.exportProgress(), visited: [...this.visited], lastRooms: [...this.#lastRoom], arrivalDoorId: this.#arrivalDoor,
      stats: { ...this.#stats, ammo: [...this.#stats.ammo] },
    }
  }

  /** Native rooms must hydrate before restoration. Invalid or changed individual
   * rooms are skipped; the snapshot never replaces their authored definitions. */
  restoreState(raw: unknown): void {
    if (!saveObject(raw) || raw['version'] !== 1 || !saveObject(raw['stats']) || !saveObject(raw['progress'])) return
    const stats = raw['stats'], progress = raw['progress']
    if (progress['version'] !== 1 || !Array.isArray(progress['relicIds']) || progress['relicIds'].length > 256) return
    if (!Array.isArray(raw['roomIds']) || raw['roomIds'].length > 128 || raw['roomIds'].some(id => typeof id !== 'string')
      || new Set(raw['roomIds']).size !== raw['roomIds'].length || !Array.isArray(raw['rooms']) || raw['rooms'].length > 128
      || !Array.isArray(raw['visited']) || raw['visited'].length > 128 || !Array.isArray(raw['lastRooms']) || raw['lastRooms'].length > 128
      || (raw['activeRoomId'] !== null && typeof raw['activeRoomId'] !== 'string')
      || (raw['arrivalDoorId'] !== null && typeof raw['arrivalDoorId'] !== 'string')) return
    if (!saveInteger(stats['score'], 1e9) || !saveInteger(stats['lives'], 9999) || !saveInteger(stats['fairyCount'], 1e6)
      || !saveInteger(stats['sealCount'], 1e6) || typeof stats['pageTime'] !== 'boolean' || typeof stats['pageSpace'] !== 'boolean'
      || !saveInteger(stats['ammoCap'], SCROLL_CAP) || stats['ammoCap'] < MAX_AMMO || !Array.isArray(stats['ammo'])
      || stats['ammo'].length > stats['ammoCap'] || stats['ammo'].some(value => typeof value !== 'boolean')) return
    const stage = new LabyrinthJourney([...this.rooms.values()], this.labyrinths)
    stage.restoreProgress(progress)
    stage.#stats = {
      score: stats['score'], lives: stats['lives'], fairyCount: stats['fairyCount'], sealCount: stats['sealCount'],
      pageTime: stats['pageTime'], pageSpace: stats['pageSpace'], ammo: [...stats['ammo']] as boolean[], ammoCap: stats['ammoCap'],
    }
    const roomIds = new Set(raw['roomIds'] as string[]), seen = new Set<string>()
    for (const entry of raw['rooms']) {
      if (!saveObject(entry) || typeof entry['id'] !== 'string' || !roomIds.has(entry['id']) || seen.has(entry['id'])) return
      seen.add(entry['id'])
      const room = this.rooms.get(entry['id'])
      if (!room || entry['topologyKey'] !== roomTopology(room)) continue
      const engine = new Engine({ ...copyLevel(room.level), interconnected: true })
      if (!engine.restoreState(entry['state'])) continue
      for (const gate of room.gates) engine.setTile(gate.col, gate.row, stage.has(gate.requires) ? EMPTY : WALL)
      stage.engines.set(room.id, engine)
    }
    for (const id of raw['visited']) if (typeof id === 'string' && this.rooms.has(id)) stage.visited.add(id)
    for (const id of stage.engines.keys()) stage.visited.add(id)
    for (const entry of raw['lastRooms']) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue
      const room = this.rooms.get(entry[1])
      if (room?.labyrinthId === entry[0] && stage.engines.has(room.id)) stage.#lastRoom.set(entry[0], room.id)
    }
    const active = typeof raw['activeRoomId'] === 'string' ? this.rooms.get(raw['activeRoomId']) : undefined
    if (active && stage.engines.has(active.id) && stage.canEnterLabyrinth(active.labyrinthId)) {
      stage.room = active
      stage.engine = stage.engines.get(active.id)!
      Object.assign(stage.engine, stage.#stats, { ammo: [...stage.#stats.ammo] })
      stage.#lastRoom.set(active.labyrinthId, active.id)
      stage.#arrivalDoor = active.doors.some(door => door.id === raw['arrivalDoorId']) ? raw['arrivalDoorId'] as string : null
    }
    this.leave()
    this.engines.clear(); for (const [id, engine] of stage.engines) this.engines.set(id, engine)
    this.visited.clear(); for (const id of stage.visited) this.visited.add(id)
    this.completed.clear(); for (const id of stage.completed) this.completed.add(id)
    this.inventory.triangles.clear(); for (const point of stage.inventory.triangles) this.inventory.triangles.add(point)
    this.inventory.relicIds.clear(); for (const id of stage.inventory.relicIds) this.inventory.relicIds.add(id)
    this.inventory.hexagon = stage.inventory.hexagon; this.inventory.star = stage.inventory.star
    this.#stats = stage.#stats; this.#lastRoom = stage.#lastRoom; this.#arrivalDoor = stage.#arrivalDoor
    this.room = stage.room; this.engine = stage.engine; this.lastRelic = null
  }

  /** Only permanent discoveries and totals are durable; chamber action is local. */
  exportProgress(): JourneyProgress {
    this.#bank()
    return { version: 1, relicIds: [...this.inventory.relicIds], score: this.#stats.score, fairyCount: this.#stats.fairyCount }
  }

  /** Restore only known discoveries. Untrusted save data cannot invent abilities. */
  restoreProgress(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const value = raw as Record<string, unknown>
    if (value['version'] !== 1 || !Array.isArray(value['relicIds']) || value['relicIds'].length > 256) return
    const known = new Map([...this.rooms.values()].flatMap(room => room.relics).concat(NPC_RELICS).map(relic => [relic.id, relic]))
    const previousScore = this.engine?.score ?? this.#stats.score
    for (const id of value['relicIds']) {
      if (typeof id !== 'string') continue
      const relic = known.get(id)
      if (relic) this.grantRelic(relic)
    }
    const bounded = (candidate: unknown, maximum: number): candidate is number => typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 && candidate <= maximum
    this.#stats.score = bounded(value['score'], 1_000_000_000) ? value['score'] : previousScore
    if (bounded(value['fairyCount'], 1_000_000)) this.#stats.fairyCount = value['fairyCount']
    if (this.engine) { this.engine.score = this.#stats.score; this.engine.fairyCount = this.#stats.fairyCount }
    this.lastRelic = null
  }

  /** NPC gifts and room discoveries use the same permanent, unique identity. */
  grantRelic(relic: Omit<RoomRelic, keyof Cell> & Partial<Cell>): boolean {
    if (typeof relic.id !== 'string' || !relic.id.trim() || this.collected(relic.id)) return false
    if (!['triangle', 'hexagon', 'star'].includes(relic.kind)) return false
    if (relic.kind === 'triangle' && (!Number.isInteger(relic.point) || relic.point! < 0 || relic.point! >= 6)) return false
    const normalized: RoomRelic = { ...relic, col: relic.col ?? 0, row: relic.row ?? 0 }
    this.inventory.relicIds.add(relic.id)
    if (relic.kind === 'triangle') this.inventory.triangles.add(relic.point!)
    if (relic.kind === 'hexagon') this.inventory.hexagon = true
    if (relic.kind === 'star' || (this.inventory.hexagon && this.inventory.triangles.size === 6)) this.inventory.star = true
    const reward = relic.kind === 'triangle' ? 1000 : 3000
    if (this.engine) {
      this.engine.score += reward
      this.engine.pickupFlash += 1
      this.engine.pickupCell = { col: normalized.col, row: normalized.row }
    } else this.#stats.score += reward
    this.lastRelic = normalized
    for (const labyrinth of this.labyrinths) if (labyrinth.goalRelicId === relic.id) this.completed.add(labyrinth.id)
    this.#applyGates()
    this.#bank()
    return true
  }

  canEnterLabyrinth(id: string): boolean {
    const labyrinth = this.labyrinths.find(candidate => candidate.id === id)
    return !!labyrinth && this.has(labyrinth.requires)
  }

  enterLabyrinth(id: string): boolean {
    const labyrinth = this.labyrinths.find(candidate => candidate.id === id)
    if (!labyrinth || !this.has(labyrinth.requires)) return false
    return this.#enter(this.#lastRoom.get(id) ?? labyrinth.entryRoomId)
  }

  leave(): void {
    this.#bank()
    if (this.engine) this.#releaseInput(this.engine)
    this.room = null
    this.engine = null
    this.#arrivalDoor = null
  }

  #bank(): void {
    const engine = this.engine
    if (!engine) return
    this.#stats = { score: engine.score, lives: engine.lives, fairyCount: engine.fairyCount, sealCount: engine.sealCount, pageTime: engine.pageTime, pageSpace: engine.pageSpace, ammo: [...engine.ammo], ammoCap: engine.ammoCap }
  }

  #releaseInput(engine: Engine): void {
    engine.input.left = engine.input.right = engine.input.down = engine.input.jump = false
  }

  #enter(roomId: string, doorId?: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    const arrival = doorId === undefined ? undefined : room.doors.find(door => door.id === doorId)
    if (doorId !== undefined && !arrival) return false
    this.#bank()
    if (this.engine) this.#releaseInput(this.engine)
    let engine = this.engines.get(roomId)
    if (!engine) {
      engine = new Engine({ ...copyLevel(room.level), interconnected: true })
      this.engines.set(roomId, engine)
    }
    Object.assign(engine, this.#stats, { ammo: [...this.#stats.ammo] })
    this.room = room
    this.engine = engine
    this.visited.add(roomId)
    this.#lastRoom.set(room.labyrinthId, roomId)
    this.#arrivalDoor = null
    this.lastRelic = null
    this.#applyGates()
    if (arrival) {
      // Search beside the native destination cell so conjured blocks cannot
      // strand Dana inside stone on a return visit.
      const facing = arrival.col >= ROOM_COLS / 2 ? -1 : 1
      const candidates = [
        { col: arrival.col + facing, row: arrival.row },
        { col: arrival.col, row: arrival.row },
        { col: arrival.col - facing, row: arrival.row },
        room.level.player,
      ]
      const cell = candidates.find(candidate => !engine!.solidAt(candidate.col, candidate.row))
      if (cell) engine.arrive(cell, facing)
      this.#arrivalDoor = arrival.id
    } else this.#guardDoor()
    return true
  }

  /** The door Dana arrived through and has not yet stepped away from — the
   *  one door that must not take her straight back. */
  get arrivalDoor(): string | null { return this.#arrivalDoor }

  /** A door Dana is standing in when she is SET DOWN (a spawn, a retry, a
   *  respawn after a death) counts as her arrival door: every room's start
   *  cell is beside its way back, and touching a door means walking into it,
   *  never being placed in it. */
  #guardDoor(): void { this.#arrivalDoor = this.nearDoor()?.id ?? null }

  nearDoor(): RoomDoor | null {
    if (!this.room || !this.engine || this.engine.state !== 'playing') return null
    const player = this.engine.player
    const x = (player.x + player.w / 2) / TILE, y = (player.y + player.h / 2) / TILE
    return [...this.room.doors].sort((a, b) => Math.hypot(a.col + 0.5 - x, a.row + 0.5 - y) - Math.hypot(b.col + 0.5 - x, b.row + 0.5 - y))
      .find(door => Math.abs(door.col + 0.5 - x) <= 1.25 && Math.abs(door.row + 0.5 - y) <= 0.8) ?? null
  }

  useDoor(id?: string): DoorResult {
    if (!this.room || !this.engine || this.engine.state !== 'playing') return { kind: 'inactive', message: 'Enter a labyrinth to use its doors.' }
    const nearby = this.nearDoor()
    if (!nearby || (id !== undefined && nearby.id !== id)) return { kind: 'out-of-range', message: 'Stand beside a door, then press E.' }
    if (nearby.id === this.#arrivalDoor) return { kind: 'out-of-range', message: 'Step away from the arrival door before returning.' }
    if (!this.has(nearby.requires)) return { kind: 'locked', message: `${describeRequirement(nearby.requires)} opens this passage.` }
    const target = this.rooms.get(nearby.targetRoomId)
    if (!target || !this.#enter(target.id, nearby.targetDoorId)) return { kind: 'inactive', message: 'This passage has no connected room.' }
    return { kind: 'travelled', message: target.level.name }
  }

  #applyGates(): void {
    if (!this.room || !this.engine) return
    for (const gate of this.room.gates) this.engine.setTile(gate.col, gate.row, this.has(gate.requires) ? EMPTY : WALL)
  }

  update(dt: number): void {
    const engine = this.engine, room = this.room
    if (!engine || !room) return
    this.#applyGates()
    const lives = engine.lives
    engine.update(dt)
    if (engine.lives < lives && engine.state === 'playing') this.#guardDoor()
    if (this.#arrivalDoor && this.nearDoor()?.id !== this.#arrivalDoor) this.#arrivalDoor = null
    if (engine.state !== 'playing') { this.#bank(); return }
    for (const relic of room.relics) {
      if (this.collected(relic.id) || !engine.rectOverlapsCell(engine.player, relic.col, relic.row)) continue
      this.grantRelic(relic)
    }
    this.#applyGates()
    this.#bank()
  }

  /** A new attempt in the current chamber keeps earned abilities and other rooms. */
  retryCurrent(): boolean {
    if (!this.engine) return false
    this.engine.lives = 3
    this.engine.spawn()
    this.#guardDoor()
    this.#applyGates()
    this.#bank()
    return true
  }
}

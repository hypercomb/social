import {
  BRICK, COMBAT_SKILLS, EMPTY, Engine, LIFE_FULL, MAX_AMMO, SCROLL_CAP, TILE, WALL,
  type Cell, type CombatSkillId, type EngineSnapshot, type LevelDef, type SpellKind, type WeaponKind,
} from './engine.js'
import { fromAscii } from './levels.js'

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
  /** Shut until this room's own key is taken — the way ON. The way back never waits on a key. */
  keyed?: boolean
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
  kit: CombatSkillId[]; weapon: WeaponKind | null; spell: SpellKind | null
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
    [...room.doors].sort((a, b) => a.id.localeCompare(b.id)).map(d => [d.id, d.col, d.row, d.targetRoomId, d.targetDoorId, requirement(d.requires), d.keyed ?? false]),
    [...room.relics].sort((a, b) => a.id.localeCompare(b.id)).map(r => [r.id, r.col, r.row, r.kind, r.point ?? null]),
    [...room.gates].sort((a, b) => a.row - b.row || a.col - b.col).map(g => [g.col, g.row, requirement(g.requires)]),
  ])
}
const NPC_RELICS: readonly RoomRelic[] = [{ id: 'mira-dawn-triangle', kind: 'triangle', point: 0, col: 0, row: 0 }]
export type DoorResult = { kind: 'travelled' | 'locked' | 'out-of-range' | 'inactive'; message: string }

/** A room square's name, as the hive names it: every square of a room is one
 *  of its child layers (tile-surface.ts). */
export function squareName(col: number, row: number): string {
  return `cell-${String(col).padStart(2, '0')}-${String(row).padStart(2, '0')}`
}

/** A square as an entrance of the labyrinth place: `<room id>.<square>`.
 *  Being an entrance is a mark, never a kind (jwize, 2026-09-22: "whatever
 *  you decide becomes an entrance becomes an entrance" — a picture on the
 *  wall you look into and then go right into): ANY square of any room can
 *  have a place seated behind it. */
export function squareEntrance(roomId: string, cell: Cell): string {
  return `${roomId}.${squareName(cell.col, cell.row)}`
}

/** How long Dana walks against a solid square that leads in before it takes her. */
const SQUARE_PUSH = 0.3

/** The ways out of a side-view room — its seated squares, a cavern's mouth
 *  and its way deeper — and who is passing through which. An open square is
 *  passed by stepping into it, as a door is; a solid one (a stone in the
 *  wall, a brick) by walking against it a moment. A way just used is held
 *  until Dana steps away, so arriving never bounces her straight back. */
export class SquarePasses {
  #push: { id: string; t: number } | null = null
  #held: { id: string; cell: Cell } | null = null

  reset(): void { this.#push = null; this.#held = null }

  /** Hold a way until Dana steps clear of it. */
  hold(id: string, cell: Cell): void {
    this.#push = null
    this.#held = { id, cell }
  }

  /** The way Dana passes into this step, if any — reported once. `ways`
   *  maps each way to its square. */
  step(engine: Engine, ways: ReadonlyMap<string, Cell>, dt: number): string | null {
    if (engine.state !== 'playing') { this.#push = null; return null }
    const p = engine.player, cx = p.x + p.w / 2, cy = p.y + p.h / 2
    if (this.#held && Math.hypot(cx - (this.#held.cell.col + 0.5) * TILE, cy - (this.#held.cell.row + 0.5) * TILE) > TILE * 1.25) this.#held = null
    const bodyRow = Math.floor((p.y + p.h - 1) / TILE)
    const ahead = Math.floor((engine.facing > 0 ? p.x + p.w + 1 : p.x - 1) / TILE)
    const pressing = engine.facing > 0 ? engine.input.right : engine.input.left
    let pushing: string | null = null
    for (const [id, cell] of ways) {
      if (this.#held?.id === id) continue
      if (!engine.solidAt(cell.col, cell.row)) {
        if (engine.rectOverlapsCell(p, cell.col, cell.row)) { this.hold(id, cell); return id }
      } else if (pressing && cell.col === ahead && cell.row === bodyRow) pushing = id
    }
    if (!pushing) { this.#push = null; return null }
    const t = (this.#push?.id === pushing ? this.#push.t : 0) + dt
    if (t < SQUARE_PUSH) { this.#push = { id: pushing, t }; return null }
    this.hold(pushing, ways.get(pushing)!)
    return pushing
  }
}

export function describeRequirement(requirement?: SigilRequirement): string {
  if (!requirement) return 'Open passage'
  if (requirement.kind === 'all') return requirement.requirements.map(describeRequirement).join(' + ')
  if (requirement.kind === 'hexagon') return 'Central hexagon'
  if (requirement.kind === 'star') return 'Complete Star of David'
  if (requirement.point !== undefined) return `Triangle ${requirement.point + 1}`
  return `${requirement.count ?? 1} triangle${(requirement.count ?? 1) === 1 ? '' : 's'}`
}

/** Remade rooms take a new id: a room is seeded into the hive ONCE and never
 *  overwritten (tile-surface.ts), so only a new id reaches a hive that already
 *  holds the first edition — whose layer stays exactly where it is. */
const EDITION = 'ii'
export function roomId(labyrinthId: string, suffix: string): string { return `${labyrinthId}-${suffix}-${EDITION}` }

export const LABYRINTHS: LabyrinthDef[] = [
  { id: 'sunseed', name: 'Sunseed Rooms', description: 'Find two more points and the central hexagon.', entryRoomId: roomId('sunseed', 'porch'), requires: { kind: 'triangle', point: 0 }, goalRelicId: 'sunseed-center', color: '#efbd58' },
  { id: 'tideglass', name: 'Tideglass Rooms', description: 'Find the remaining points to assemble your star.', entryRoomId: roomId('tideglass', 'porch'), requires: { kind: 'all', requirements: [{ kind: 'hexagon' }, { kind: 'triangle', point: 1 }, { kind: 'triangle', point: 2 }] }, goalRelicId: 'tideglass-point-5', color: '#58c5c5' },
  { id: 'starbloom', name: 'Pyramid of Accord', description: 'Open the star passages and reach the heart of the pyramid.', entryRoomId: roomId('starbloom', 'porch'), requires: { kind: 'star' }, goalRelicId: 'starbloom-heart', color: '#b693ed' },
]

// ── the rooms ────────────────────────────────────────────────────────────
//
// Every room is drawn by hand, never stamped from one template (jwize,
// 2026-09-22: "when you break bricks there's never anything behind them …
// we have to make it more dynamic and exciting, fought out levels rather
// than boring walkthroughs"). Each room has its own idea, a key the way on
// waits for, foes that make you fight for it, and things buried in its
// stone. A room is two layers laid cell for cell:
//
//   art   — terrain, foes and pickups in the `fromAscii` legend (levels.ts),
//           plus the marks only a labyrinth room carries:
//             < return   > deeper   ^ fold   ! home   ? loop      (doors)
//             * the room's relic
//             | a shrine gate — stone until its sigil is held
//             : an empty square hiding a make-then-break find
//   finds — what the room hides, in the same legend. A pickup over a brick
//           is buried in it: break the brick. Over `.` it is a wand secret:
//           cast into the empty square. Over `:` it is the classic Solomon
//           find: the first cast walls it in, and breaking that brick pays.

const DOOR_MARKS: Readonly<Record<string, string>> = { '<': 'return', '>': 'deeper', '^': 'fold', '!': 'home', '?': 'loop' }
/** The way ON waits for the room's key; the way back never does. */
const KEYED_DOORS: ReadonlySet<string> = new Set(['deeper', 'home'])
const THEMES: Readonly<Record<string, string>> = { sunseed: 'sandstone', tideglass: 'verdant', starbloom: 'crystal' }

type RoomSuffix = 'porch' | 'steps' | 'loft' | 'heart'
interface RoomPlan {
  readonly name: string
  readonly depth: number
  readonly art: readonly string[]
  readonly finds?: readonly string[]
  /** Barrier cells (drawn as `.`): stone until their skill is in the kit. */
  readonly barriers?: readonly { readonly col: number; readonly row: number; readonly needs: CombatSkillId }[]
  /** Starting sand; a full meter when absent. */
  readonly life?: number
}
interface DrawnRoom {
  readonly room: RoomDef
  readonly doors: ReadonlyMap<string, Cell>
  readonly relic: Cell | null
  readonly gates: readonly Cell[]
  readonly keyed: boolean
}

function drawRoom(labyrinthId: string, suffix: RoomSuffix, plan: RoomPlan): DrawnRoom {
  const id = roomId(labyrinthId, suffix)
  if (plan.art.length !== ROOM_ROWS || plan.art.some(line => line.length !== ROOM_COLS)) throw new Error(`${id} is not drawn ${ROOM_COLS}×${ROOM_ROWS}`)
  const doors = new Map<string, Cell>(), gates: Cell[] = [], deep = new Set<number>()
  const relics: Cell[] = []
  const terrain = plan.art.map((line, row) => [...line].map((mark, col) => {
    const door = DOOR_MARKS[mark]
    if (door) { doors.set(door, { col, row }); return '.' }
    if (mark === '*') { relics.push({ col, row }); return '.' }
    if (mark === '|') { gates.push({ col, row }); return '#' }
    if (mark === ':') { deep.add(row * ROOM_COLS + col); return '.' }
    return mark
  }).join(''))
  const level = fromAscii(plan.name, terrain, { barriers: plan.barriers?.map(barrier => ({ ...barrier })) })
  for (const find of plan.finds ? fromAscii(plan.name, [...plan.finds]).items : []) {
    const at = find.row * ROOM_COLS + find.col
    if (level.tiles[at] === WALL) throw new Error(`${id} buries a ${find.kind} in stone at ${find.col},${find.row}`)
    if (level.tiles[at] === BRICK) level.items.push({ ...find, hidden: true })
    else level.items.push({ ...find, hidden: true, secret: true, ...(deep.has(at) ? { deep: true } : {}) })
  }
  const door = doors.get('deeper') ?? doors.get('home') ?? level.player
  return {
    room: {
      id, labyrinthId, depth: plan.depth,
      level: { ...level, door: { ...door }, lifeStart: plan.life ?? LIFE_FULL, theme: THEMES[labyrinthId], interconnected: true },
      doors: [], relics: [], gates: [],
    },
    doors, relic: relics[0] ?? null, gates, keyed: level.items.some(item => item.kind === 'key'),
  }
}

function join(a: DrawnRoom, aId: string, b: DrawnRoom, bId: string, requires?: SigilRequirement): void {
  const door = (from: DrawnRoom, id: string, to: DrawnRoom, toId: string): RoomDoor => {
    const cell = from.doors.get(id)
    if (!cell) throw new Error(`${from.room.id} has no ${id} door drawn`)
    return { ...cell, id, targetRoomId: to.room.id, targetDoorId: toId, requires, ...(from.keyed && KEYED_DOORS.has(id) ? { keyed: true } : {}) }
  }
  a.room.doors.push(door(a, aId, b, bId))
  b.room.doors.push(door(b, bId, a, aId))
}

/** What each labyrinth asks at its thresholds: on from the porch, in to the
 *  heart (the loft's door and the fold alike), home from the heart, and the
 *  porch's shrine gate. */
const WAYS: Readonly<Record<string, { onward: SigilRequirement; inward: SigilRequirement; home: SigilRequirement; gate: SigilRequirement }>> = {
  sunseed: { onward: { kind: 'triangle', point: 1 }, inward: { kind: 'triangle', point: 2 }, home: { kind: 'hexagon' }, gate: { kind: 'triangle', point: 1 } },
  tideglass: { onward: { kind: 'triangle', point: 3 }, inward: { kind: 'triangle', point: 4 }, home: { kind: 'star' }, gate: { kind: 'hexagon' } },
  starbloom: { onward: { kind: 'star' }, inward: { kind: 'star' }, home: { kind: 'star' }, gate: { kind: 'star' } },
}

const RELICS: Readonly<Record<string, Partial<Record<RoomSuffix, Omit<RoomRelic, 'col' | 'row'>>>>> = {
  sunseed: {
    porch: { id: 'sunseed-point-1', kind: 'triangle', point: 1, lore: 'The terrace kept this point. The steps above hold another.' },
    steps: { id: 'sunseed-point-2', kind: 'triangle', point: 2, lore: 'The high fold returns through the garden. Its center opens Tideglass.' },
    heart: { id: 'sunseed-center', kind: 'hexagon', lore: 'A star needs a heart. Join this center with your first three points at Tideglass.' },
  },
  tideglass: {
    porch: { id: 'tideglass-point-3', kind: 'triangle', point: 3, lore: 'Moonlit glass carries the fourth point. Follow the steps upward.' },
    steps: { id: 'tideglass-point-4', kind: 'triangle', point: 4, lore: 'The last point sleeps in the garden beyond the fold.' },
    heart: { id: 'tideglass-point-5', kind: 'triangle', point: 5, lore: 'Six points around one heart: the Pyramid of Accord now hears your star.' },
  },
  starbloom: {
    heart: { id: 'starbloom-heart', kind: 'star', lore: 'Every path has a way home. The pyramid is awake.' },
  },
}

const ROOM_PLANS: Readonly<Record<string, Readonly<Record<RoomSuffix, RoomPlan>>>> = {
  sunseed: {
    // The terrace goblin guards the first point. Break the terrace from the
    // step beneath it and the goblin walks into the gap to its ruin; climb
    // through, and the high shelf's left end keeps the inscription's find.
    porch: {
      name: 'The Sun Porch', depth: 0,
      art: [
        '################',
        '#.........#....#',
        '#:........#....#',
        '#BB.......#K...#',
        '#..V......#BB..#',
        '#..B......#....#',
        '#.B...g..*#....#',
        '#..BBBBBBB#..BB#',
        '#.........#....#',
        '#......BB.|....#',
        '#?PA......|...>#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '.J..............',
        '................',
        '..............u.',
        '................',
        '..b.............',
        '......f.........',
      ],
    },
    // Two goblins hold the floor and the key is buried in their pedestal.
    // They charge on sight: crush the first where it runs, break the pedestal,
    // and the second comes for you through the gap. The point waits up the
    // stair, and the fold runs from the high ledge to the garden.
    steps: {
      name: 'Amber Steps', depth: 1,
      art: [
        '################',
        '#..............#',
        '#.......S*....^#',
        '#......BBBB.BBB#',
        '#..............#',
        '#.....B........#',
        '#..............#',
        '#....B.........#',
        '#..............#',
        '#...B..........#',
        '#<P......g.B.g>#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '...........j....',
        '................',
        '................',
        '................',
        '................',
        '.....b..........',
        '................',
        '....u...........',
        '...........K....',
      ],
    },
    // The key sits in a sealed brick well with a sparkball loose inside it.
    // Open the wall, catch the ball in the gap, and break out the far side.
    loft: {
      name: 'The Turning Loft', depth: 2,
      art: [
        '################',
        '#..............#',
        '#...BBBBBB.....#',
        '#...B....B.....#',
        '#...B..k.B.....#',
        '#...B....B.....#',
        '#...B....B..E..#',
        '#<P.B.K..B.BBBB#',
        '#BBBBBBBBB.....#',
        '#..............#',
        '#......h......>#',
        '################',
      ],
      finds: [
        '................',
        '..............J.',
        '......F.........',
        '................',
        '................',
        '.........t......',
        '................',
        '................',
        '..b.............',
      ],
    },
    // A gargoil walks the tier and a ghost the high air. Climb to the tier's
    // edge from below, and when the gargoil stops there to scan, conjure on
    // it — its tomb is your stair. The key waits where it walked; the
    // hexagon waits under the ghost.
    heart: {
      name: 'The Hexagon Garden', depth: 1,
      art: [
        '################',
        '#...........:..#',
        '#$......h......#',
        '###...*........#',
        '#^...BBBB......#',
        '#BB............#',
        '#..K.r.........#',
        '#..BBBBBBB.....#',
        '#.........B....#',
        '#..........B...#',
        '#<P...........!#',
        '################',
      ],
      finds: [
        '................',
        '............J...',
        '................',
        '................',
        '.......t........',
        '................',
        '................',
        '........j.......',
        '................',
        '...........b....',
      ],
      barriers: [{ col: 2, row: 2, needs: 'ember' }],
    },
  },
  tideglass: {
    // A ghost sweeps each floor of the hall, smashing any stone in its way —
    // and whatever that stone held rolls out for you. Crush the low ghost as
    // it hunts, take the point, climb to the upper hall and meet the other.
    porch: {
      name: 'Tideglass Landing', depth: 0,
      art: [
        '################',
        '#..............#',
        '#:.............#',
        '#BBB...........#',
        '#...B..........#',
        '#.K...B..B...h.#',
        '#BBBBBBBBBBB...#',
        '#...........B..#',
        '#..............#',
        '#......*.....B.#',
        '#?P....B...h..>#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '.J..............',
        '..............F.',
        '................',
        '......J..b......',
        '................',
        '................',
        '................',
        '................',
        '.......t........',
      ],
    },
    // A turret in the west wall fires along the middle of the stair. Wait for
    // a bolt to pass, step into the line, and wall it off behind you. The key
    // is in the high ledge itself: break it and fall through with it.
    steps: {
      name: 'The Glass Steps', depth: 1,
      art: [
        '################',
        '#..............#',
        '#........Q..*.^#',
        '#.......BBBBBBB#',
        '#..............#',
        '#......B.......#',
        '#n.............#',
        '#.....B........#',
        '#..............#',
        '#....B.........#',
        '#<P.........g.>#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '...j............',
        '........b..K..J.',
        '................',
        '................',
        '................',
        '................',
        '................',
        '.....u..........',
      ],
    },
    // Two gargoils walk two tiers. Each stops to scan at its edge — crush
    // each from below, and climb the tombs you leave.
    loft: {
      name: 'Moonlit Loft', depth: 2,
      art: [
        '################',
        '#..............#',
        '#.............>#',
        '#..........BBBB#',
        '#....K..r......#',
        '#....BBBBB.....#',
        '#.........B....#',
        '#.......r......#',
        '#.......BBBB...#',
        '#...........BB.#',
        '#<P...H........#',
        '################',
      ],
      finds: [
        '................',
        '.............J..',
        '................',
        '................',
        '................',
        '......b.........',
        '................',
        '................',
        '.........F......',
        '............t...',
      ],
    },
    // Two goblins pace the garden's terrace between its bumpers. Break the
    // terrace from the step below and both walk into the gap in turn — the
    // key was in the stone you broke. Then the point, under the ghost.
    heart: {
      name: 'Six-Point Garden', depth: 1,
      art: [
        '################',
        '#.......h......#',
        '#......*.......#',
        '#^.....BB......#',
        '#BB............#',
        '#........B...:.#',
        '#.B.g.....g.B..#',
        '#.BBBBBBBBBBB..#',
        '#..............#',
        '#.....BB.......#',
        '#<P...........!#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '.............j..',
        '................',
        '................',
        '.............F..',
        '............b...',
        '......K.........',
        '................',
        '.......t........',
      ],
    },
  },
  starbloom: {
    // A goblin rushes you at the door; a dragon holds the tier above and
    // turns wherever you go. Draw it to the edge from below and crush it.
    // The key is nowhere to be seen: take the bell, and its fairy drifts to
    // the square the wand must find.
    porch: {
      name: 'Starbloom Landing', depth: 0,
      art: [
        '################',
        '#..............#',
        '#..............#',
        '#>:............#',
        '#BBBBB.........#',
        '#.....a........#',
        '#...BBBBBBB....#',
        '#..........BB..#',
        '#..............#',
        '#............B.#',
        '#?P...b..g.....#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '................',
        '..J.............',
        '................',
        '........K.......',
        '.....t..........',
        '...........f....',
        '................',
        '.............j..',
      ],
    },
    // Two turrets cross the stair, one from each wall, and every bolt
    // smashes the brick it meets. Step into each line behind a bolt and wall
    // it off; the west turret digs the key out of the ledge for you.
    steps: {
      name: 'Violet Steps', depth: 1,
      art: [
        '################',
        '#..............#',
        '#...........^.>#',
        '#..........BBBB#',
        '#n.......B.....#',
        '#.....BBBBB....#',
        '#.............n#',
        '#....B.........#',
        '#..............#',
        '#...B..........#',
        '#<P.......g....#',
        '################',
      ],
      finds: [
        '................',
        '.............j..',
        '................',
        '................',
        '.........K......',
        '......u.........',
        '................',
        '................',
        '................',
        '....b...........',
      ],
    },
    // Two goblins below; above, a ghost tunnels through the gallery's
    // stones, and what it breaks open is yours — the key, and a life.
    loft: {
      name: 'The Folded Loft', depth: 2,
      art: [
        '################',
        '#.:............#',
        '#>.............#',
        '#BBB...........#',
        '#....B.BB.B..h.#',
        '#BBBBBBBBBBB...#',
        '#..............#',
        '#...........B..#',
        '#..............#',
        '#............B.#',
        '#<P.....g...g..#',
        '################',
      ],
      finds: [
        '................',
        '..J.............',
        '................',
        '................',
        '.....F.K..+.....',
        '................',
        '................',
        '................',
        '................',
        '.............b..',
      ],
    },
    // The star lies in a sealed well with a sparkball loose inside; two
    // goblins guard the floor. The key home is the classic find: an empty
    // square by the door that the wand walls in and breaks open.
    heart: {
      name: 'The Starbloom Heart', depth: 1,
      art: [
        '################',
        '#..........h...#',
        '#.............$#',
        '#......BBBBBB###',
        '#......B....B..#',
        '#^.....B.k..B..#',
        '#BB....B.*..B..#',
        '#...BBBBBBBBB..#',
        '#..............#',
        '#..B...........#',
        '#<P...g...g..:!#',
        '################',
      ],
      finds: [
        '................',
        '................',
        '................',
        '.........F......',
        '................',
        '................',
        '................',
        '.....t..........',
        '................',
        '...b............',
        '.............K..',
      ],
      barriers: [{ col: 13, row: 2, needs: 'hold' }],
    },
  },
}


function buildRooms(): RoomDef[] {
  const all: RoomDef[] = []
  for (const labyrinth of LABYRINTHS) {
    const plans = ROOM_PLANS[labyrinth.id], ways = WAYS[labyrinth.id]
    const drawn = {
      porch: drawRoom(labyrinth.id, 'porch', plans.porch),
      steps: drawRoom(labyrinth.id, 'steps', plans.steps),
      loft: drawRoom(labyrinth.id, 'loft', plans.loft),
      heart: drawRoom(labyrinth.id, 'heart', plans.heart),
    }
    const { porch, steps, loft, heart } = drawn
    join(porch, 'deeper', steps, 'return', ways.onward)
    join(steps, 'deeper', loft, 'return')
    join(loft, 'deeper', heart, 'return', ways.inward)
    join(heart, 'home', porch, 'loop', ways.home)
    // A second route cuts between depths: the maze is a graph, not a level list.
    join(steps, 'fold', heart, 'fold', ways.inward)
    for (const suffix of ['porch', 'steps', 'loft', 'heart'] as const) {
      const room = drawn[suffix], relic = RELICS[labyrinth.id]?.[suffix]
      if (!!relic !== !!room.relic) throw new Error(`${room.room.id} draws ${room.relic ? 'a relic nobody names' : `no square for ${relic?.id}`}`)
      if (relic && room.relic) room.room.relics.push({ ...relic, ...room.relic })
      for (const gate of room.gates) room.room.gates.push({ ...gate, requires: ways.gate })
      all.push(room.room)
    }
  }
  return all
}

export const ROOMS: RoomDef[] = buildRooms()

/** Adds a participant's labyrinth — its definition and its rooms — under
 *  new ids (story-addons.ts reads and checks them first). Refused whole
 *  when the labyrinth's id or any room's is taken. */
export function registerLabyrinth(definition: LabyrinthDef, rooms: readonly RoomDef[]): boolean {
  if (LABYRINTHS.some(labyrinth => labyrinth.id === definition.id)) return false
  if (rooms.some(room => room.labyrinthId !== definition.id || ROOMS.some(known => known.id === room.id))) return false
  LABYRINTHS.push(definition)
  ROOMS.push(...rooms)
  return true
}

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
  /** The seated squares of the room she stands in, and who is passing which. */
  readonly #squares = new SquarePasses()
  #lastRoom = new Map<string, string>()
  #stats: JourneyStats = {
    score: 0, lives: 3, fairyCount: 0, sealCount: 0, pageTime: false, pageSpace: false, ammo: [] as boolean[], ammoCap: MAX_AMMO,
    kit: [], weapon: null, spell: null,
  }

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
      stats: { ...this.#stats, ammo: [...this.#stats.ammo], kit: [...this.#stats.kit] },
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
    // kit/weapon/spell (§3.5.3), mirroring engine.ts's own restoreState() rule
    // one-for-one: absent entirely (a v1/v2 journey saved before the Hush
    // existed) defaults to empty/null; present but forged (an unknown id, a
    // duplicate, or a weapon/spell not actually in the kit) refuses the whole
    // restore, exactly like every other validated field above.
    const rawKit = stats['kit']
    let kit: CombatSkillId[]
    if (rawKit === undefined) kit = []
    else {
      if (!Array.isArray(rawKit) || rawKit.length > COMBAT_SKILLS.length || new Set(rawKit).size !== rawKit.length
        || rawKit.some(id => typeof id !== 'string' || !COMBAT_SKILLS.includes(id as CombatSkillId))) return
      kit = [...rawKit] as CombatSkillId[]
    }
    const rawWeapon = stats['weapon']
    if (rawWeapon !== undefined && rawWeapon !== null
      && (typeof rawWeapon !== 'string' || (rawWeapon !== 'sickle' && rawWeapon !== 'sling') || !kit.includes(rawWeapon as CombatSkillId))) return
    const weapon = (rawWeapon === undefined ? null : rawWeapon) as WeaponKind | null
    const rawSpell = stats['spell']
    if (rawSpell !== undefined && rawSpell !== null
      && (typeof rawSpell !== 'string' || (rawSpell !== 'ward' && rawSpell !== 'ember' && rawSpell !== 'hold') || !kit.includes(rawSpell as CombatSkillId))) return
    const spell = (rawSpell === undefined ? null : rawSpell) as SpellKind | null
    const stage = new LabyrinthJourney([...this.rooms.values()], this.labyrinths)
    stage.restoreProgress(progress)
    stage.#stats = {
      score: stats['score'], lives: stats['lives'], fairyCount: stats['fairyCount'], sealCount: stats['sealCount'],
      pageTime: stats['pageTime'], pageSpace: stats['pageSpace'], ammo: [...stats['ammo']] as boolean[], ammoCap: stats['ammoCap'],
      kit, weapon, spell,
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
      // Where she was in each labyrinth is remembered on its own: the room's
      // engine is gone the moment she left it, and that must not send her
      // back to the entry room after a reload.
      if (room?.labyrinthId === entry[0]) stage.#lastRoom.set(entry[0], room.id)
    }
    const active = typeof raw['activeRoomId'] === 'string' ? this.rooms.get(raw['activeRoomId']) : undefined
    if (active && stage.engines.has(active.id) && stage.canEnterLabyrinth(active.labyrinthId)) {
      stage.room = active
      stage.engine = stage.engines.get(active.id)!
      Object.assign(stage.engine, stage.#stats, { ammo: [...stage.#stats.ammo], kit: [...stage.#stats.kit] })
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
    this.#forget()
    this.room = null
    this.engine = null
    this.#arrivalDoor = null
  }

  // ROOMS ALWAYS START FRESH (jwize, 2026-09-21): leaving a room forgets it —
  // enemies, taken items, found secrets, conjured blocks — so the next visit
  // plays it from its authored definition. What follows Dana out is exactly
  // the journey-wide state: her stats (`#bank`), the relics she has collected
  // (`inventory`, each awarded once), and the kit that opens barriers. A room
  // is remembered only while she is standing in it, which is what a save made
  // inside a room still restores.
  #forget(): void {
    if (this.room) this.engines.delete(this.room.id)
  }

  #bank(): void {
    const engine = this.engine
    if (!engine) return
    this.#stats = {
      score: engine.score, lives: engine.lives, fairyCount: engine.fairyCount, sealCount: engine.sealCount,
      pageTime: engine.pageTime, pageSpace: engine.pageSpace, ammo: [...engine.ammo], ammoCap: engine.ammoCap,
      kit: [...engine.kit], weapon: engine.weapon, spell: engine.spell,
    }
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
    // The room she is leaving is forgotten and the one she enters is built
    // fresh — even when it is the same room again (see `#forget`): the shell
    // never calls `leave()` on the way up to the island, it re-enters the
    // labyrinth at her last room, and that return is a fresh start too. A
    // room restored from a save keeps its engine until she first steps out.
    this.#forget()
    let engine = this.engines.get(roomId)
    if (!engine) {
      engine = new Engine({ ...copyLevel(room.level), interconnected: true })
      this.engines.set(roomId, engine)
    }
    Object.assign(engine, this.#stats, { ammo: [...this.#stats.ammo], kit: [...this.#stats.kit] })
    // Re-derive this room's barriers against the (persistent) kit that just
    // landed on it — without this, a freshly-constructed room's barriers seal
    // against the engine's still-empty class-field `kit` (the constructor's
    // load()→spawn()→applyBarriers() runs BEFORE the Object.assign above ever
    // reaches it), so a barrier whose attainment Dana already holds would stay
    // wrongly sealed on both a first visit and a revisit (M6 — a real bug).
    engine.applyBarriers()
    this.room = room
    this.engine = engine
    this.visited.add(roomId)
    this.#lastRoom.set(room.labyrinthId, roomId)
    this.#arrivalDoor = null
    this.#squares.reset()
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
    // A sealed barrier can sit on a door's own cell (M6) — a door is never a
    // real destination while its cell is solid, exactly like standing inside
    // wand-cast stone would be.
    return this.room.doors
      .filter(door => !this.engine!.solidAt(door.col, door.row))
      .sort((a, b) => Math.hypot(a.col + 0.5 - x, a.row + 0.5 - y) - Math.hypot(b.col + 0.5 - x, b.row + 0.5 - y))
      .find(door => Math.abs(door.col + 0.5 - x) <= 1.25 && Math.abs(door.row + 0.5 - y) <= 0.8) ?? null
  }

  /** Equip an already-learned skill (§4.9's UseContext/useVerb read `weapon`/
   *  `spell` back off the getters below); banks immediately so the choice
   *  survives a death/leave without waiting for the next natural #bank(). */
  equip(id: CombatSkillId): boolean {
    const ok = this.engine?.equip(id) ?? false
    if (ok) this.#bank()
    return ok
  }

  /** Read-only surface for the shell (§4.9/M22): the live room's engine when
   *  one is active, else the banked journey-wide value — never a second
   *  source of truth, since #bank()/#enter() keep the two in lockstep. */
  get kit(): readonly CombatSkillId[] { return this.engine?.kit ?? this.#stats.kit }
  get weapon(): WeaponKind | null { return this.engine?.weapon ?? this.#stats.weapon }
  get spell(): SpellKind | null { return this.engine?.spell ?? this.#stats.spell }

  /** A door opens when its sigil is held and — for the way on — once this
   *  room's own key is in hand. The key is the room's; a fresh visit asks again. */
  canPass(door: RoomDoor): boolean {
    return this.has(door.requires) && (!door.keyed || this.engine?.doorOpen === true)
  }

  /** Why a shut door is shut, in the words the room says it. */
  lockMessage(door: RoomDoor): string {
    return this.has(door.requires) ? 'This room’s key opens this door.' : `${describeRequirement(door.requires)} opens this passage.`
  }

  /** The seated square Dana passes into this step, if any — reported once,
   *  then held until she steps away. An open square is passed by stepping
   *  into it, as a door is; a solid one (a stone in the wall, a brick) by
   *  walking against it a moment. `seated` maps each square of this room
   *  that leads in to its cell. */
  enteringSquare(seated: ReadonlyMap<string, Cell>, dt: number): string | null {
    if (!this.engine || !this.room) return null
    return this.#squares.step(this.engine, seated, dt)
  }

  useDoor(id?: string): DoorResult {
    if (!this.room || !this.engine || this.engine.state !== 'playing') return { kind: 'inactive', message: 'Enter a labyrinth to use its doors.' }
    const nearby = this.nearDoor()
    if (!nearby || (id !== undefined && nearby.id !== id)) return { kind: 'out-of-range', message: 'Stand beside a door, then press E.' }
    if (nearby.id === this.#arrivalDoor) return { kind: 'out-of-range', message: 'Step away from the arrival door before returning.' }
    if (!this.canPass(nearby)) return { kind: 'locked', message: this.lockMessage(nearby) }
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

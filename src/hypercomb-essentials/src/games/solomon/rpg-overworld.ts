/** The world above the rooms: walking, conversation, knowledge, shrine
 * assembly and the wand. The model has no DOM or storage dependency;
 * inventory belongs to the journey. The world is an ISLAND that scrolls
 * continuously — there are no screens to flip between. Its land is derived
 * from ISLAND_DEF (island.ts); the people, entrances and brickwork below stand
 * on it. Play starts at an epicentre — the valley, the Brick Garden beside it
 * and Saltmere below — and the rest of the island is room to grow. */

import {
  VALLEY_COLS, VALLEY_ROWS, buildIsland, isWalkableTerrain, islandRegionAt, islandTerrainAt, stampWidth,
  type Island, type IslandDef, type IslandStamp, type IslandTerrain,
} from './island.js'
import { BURST_LIFE, IslandPainter, canvasContext, type IslandCamera, type WandBurst } from './island-paint.js'
import { VEIL_ZOOM, veilCanvasPicture, type VeilDirection, type VeilLeg, type VeilPicture } from './place-veil.js'
import { drawPlace, type PlaceGlow, type PlaceSprite } from './island-places.js'
import { PLAYER_LOOK, drawWalker, lookFor } from './island-sprites.js'
import { playChestReveal, type TreasureKind } from './island-treasure.js'

export type ShrineComponent = { kind: 'triangle'; point: number } | { kind: 'hexagon' } | { kind: 'star' }
export type WorldRelic = ShrineComponent & { id: string }
export interface WorldInput { up?: boolean; down?: boolean; left?: boolean; right?: boolean }
export interface WorldHooks {
  has(requirement: ShrineComponent): boolean
  grantRelic(relic: WorldRelic): unknown
  onEnter(labyrinthId: string): void
  onDungeon?(levelIndex: number): void
  onJournal?(): void
  onMessage?(message: string): void
}
export interface WorldPlace { id: string; name: string; x: number; y: number }
export interface WorldShrine extends WorldPlace {
  kind: 'shrine'; labyrinthId: string; subtitle: string; components: readonly ShrineComponent[]
}
export interface WorldPerson extends WorldPlace {
  kind: 'person'; role: string; color: string; clue: string; question: string
  answers: readonly string[]; correct: number; insight: string; retry: string; reward?: WorldRelic
}
export interface WorldDungeon extends WorldPlace {
  kind: 'dungeon'; levelIndex: number; subtitle: string; clue: string
}
/** Someone who lives on the island. They talk; they ask nothing. */
export interface WorldResident extends WorldPlace {
  kind: 'resident'; role: string; color: string; lines: readonly string[]
}
/** Ground laid out for a shrine nobody has built yet. A plot names no shrine:
 *  empty is a finished state, and a builder's shrine seats onto it later. */
export interface WorldPlot extends WorldPlace {
  kind: 'plot'; subtitle: string; clue: string
}
/** Something left for a curious traveller; opening it adds its lore and what it held to the journal. */
export interface WorldCache extends WorldPlace {
  kind: 'cache'; subtitle: string; lore: string; items: readonly { kind: TreasureKind; name: string }[]
}
export interface WorldSign extends WorldPlace {
  kind: 'sign'; subtitle: string; text: string
}
export type WorldEncounter = WorldShrine | WorldPerson | WorldDungeon | WorldResident | WorldPlot | WorldCache | WorldSign
/** What a bubble beside a place holds: a line for a while, or a question with
 *  its choices until it is answered or walked away from. */
interface WorldSpeech { key: string; until: number; text?: string; nodes?: () => Node[] }
export type ShrineState = 'missing' | 'ready' | 'open'
/** What one cast of the wand changed; `seal` is true when a seal opened or closed with it. */
export interface WandChange { col: number; row: number; terrain: IslandTerrain; seal: boolean }
export interface WorldResult {
  ok: boolean; message: string; encounter?: WorldEncounter; wand?: WandChange
  /** True only the first time a cache is opened. */
  fresh?: boolean
}
export interface WorldSnapshot {
  /** 2 = island coordinates. Version 1 saves hold valley-local coordinates. */
  version: 2
  player: { x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' }
  met: string[]
  solved: string[]
  journal: string[]
  filledSockets: string[]
  /** Cells the wand changed, as `<place>:<col>,<row>` in that place's own coordinates. */
  wand: string[]
  opened: string[]
}

/** The Brick Garden, one road east of the valley: a walled court whose seal
 *  gives way when all four rune plates hold bricks, a pond crossed by raising
 *  stones out of rune springs, and a cracked brick hiding a nook. */
const BRICK_GARDEN: IslandStamp = {
  id: 'brick-garden', name: 'The Brick Garden', col: 80, row: 108,
  map: [
    'TTTTTTTTTTTTTTTTTTTT',
    'T.........~~~~~~~..T',
    'T.WWWWWWW.~~~~PP~..T',
    'T.WrWPWrW.~~~~m~~..T',
    'T.WPPSPPW.~~mmm~~..T',
    'T.WPPPPPW.~~m~~~~..T',
    'T.WrPPPrW.~~m~~~~..T',
    'T.WPPPPPW.sssssss..T',
    'T.WWWBWWW...#......T',
    '####################',
    'T..........WWBWW...T',
    'T...........WPW....T',
    'T...........WWW....T',
    'TTTTTTTTTTTTTTTTTTTT',
  ],
  gates: [{ id: 'west', col: 0, row: 9 }, { id: 'east', col: 19, row: 9 }],
}
const gardenPoint = (col: number, row: number): { x: number; y: number } => ({ x: BRICK_GARDEN.col + col, y: BRICK_GARDEN.row + row })

export const ISLAND_DEF: IslandDef = {
  seed: 7,
  cols: 256,
  rows: 192,
  valley: { col: 52, row: 110, name: 'The Sevenfold Valley' },
  spine: { name: 'The Spine', points: [{ x: 118, y: 44 }, { x: 150, y: 56 }, { x: 182, y: 62 }, { x: 206, y: 86 }, { x: 212, y: 116 }] },
  forests: [{ x: 62, y: 76, r: 30 }, { x: 186, y: 132, r: 18 }],
  lakes: [{ x: 142, y: 114, r: 7 }],
  rivers: [
    [{ x: 150, y: 60 }, { x: 142, y: 84 }, { x: 142, y: 108 }],
    [{ x: 146, y: 120 }, { x: 160, y: 142 }, { x: 172, y: 176 }],
    [{ x: 206, y: 94 }, { x: 226, y: 104 }, { x: 246, y: 110 }],
    [{ x: 104, y: 50 }, { x: 88, y: 38 }, { x: 70, y: 20 }],
  ],
  towns: [
    { id: 'saltmere', name: 'Saltmere', x: 84, y: 142, plaza: { w: 10, h: 6 } },
    { id: 'lanternwick', name: 'Lanternwick', x: 74, y: 58, plaza: { w: 8, h: 6 } },
    { id: 'cinderreach', name: 'Cinderreach', x: 184, y: 96, plaza: { w: 10, h: 6 } },
  ],
  clearings: [
    { id: 'grove-plot', x: 50, y: 84, r: 4 },
    { id: 'lakeside-plot', x: 128, y: 106, r: 4 },
    { id: 'cliff-plot', x: 162, y: 42, r: 4 },
    { id: 'tidewater-plot', x: 150, y: 160, r: 4 },
  ],
  stamps: [BRICK_GARDEN],
  regions: [
    { name: 'Saltmere', x: 84, y: 142, r: 14 },
    { name: 'Lanternwick', x: 74, y: 58, r: 13 },
    { name: 'Cinderreach', x: 184, y: 96, r: 15 },
    { name: 'Whisperwood', x: 62, y: 76, r: 26 },
    { name: 'Mirror Lake', x: 138, y: 112, r: 14 },
    { name: 'The Tidewater Shore', x: 150, y: 162, r: 16 },
  ],
  roads: [
    ['valley-south', 'saltmere'], ['valley-north', 'lanternwick'], ['valley-east', 'brick-garden-west'],
    ['brick-garden-east', 'lakeside-plot'], ['lakeside-plot', 'cinderreach'], ['saltmere', 'tidewater-plot'],
    ['saltmere', 'lakeside-plot'], ['lanternwick', 'grove-plot'], ['lanternwick', 'cliff-plot'], ['cinderreach', 'cliff-plot'],
  ],
  wilds: 'The Wilds',
}

let island: Island | null = null
/** Built on first use, never at import: every hive loads this module and few open the game. */
export function theIsland(): Island { return island ??= buildIsland(ISLAND_DEF) }

export const WORLD_COLS = ISLAND_DEF.cols
export const WORLD_ROWS = ISLAND_DEF.rows
/** A position given in the Sevenfold Valley's own coordinates. */
export function valleyPoint(col: number, row: number): { x: number; y: number } {
  return { x: ISLAND_DEF.valley.col + col, y: ISLAND_DEF.valley.row + row }
}
export const WORLD_START: Readonly<{ x: number; y: number }> = valleyPoint(4, 12)
const REACH = 1.8
const SPEED = 4.2
/** A chest has to be stood at; a sign can be read from a step away. */
const REACH_OF: Readonly<Partial<Record<WorldEncounter['kind'], number>>> = { cache: 0.95, sign: 2.2 }
/** Walk this close to a signpost and it shows what it says. */
const SIGN_READ = 1.9
const FACING_STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const
const WAND_CELLS: ReadonlySet<IslandTerrain> = new Set<IslandTerrain>(['crack', 'rune', 'spring'])
const WAND_MADE: Readonly<Partial<Record<IslandTerrain, IslandTerrain>>> = { crack: 'rubble', rune: 'laid', spring: 'stone' }
const WAND_WORDS: Readonly<Partial<Record<IslandTerrain, string>>> = {
  rubble: 'The cracked brick crumbles to rubble.',
  crack: 'The wand sets a cracked brick back in its place.',
  laid: 'A brick settles onto the rune plate.',
  rune: 'The brick lifts from the rune plate.',
  stone: 'A stepping stone rises out of the rune spring.',
  spring: 'The stone sinks back into the spring.',
}

export const RELIC_LORE: Readonly<Record<string, { title: string; text: string }>> = {
  'triangle:0': { title: 'Dawn triangle', text: 'The first point answers the sun. Set it into the Dawn shrine; Sunseed’s amber shelves hide two more points. Seek the central hexagon beyond the turning loft.' },
  'triangle:1': { title: 'Tide triangle', text: 'Passages join places as well as depths. A door marked with the tide point reveals another part of the same labyrinth.' },
  'triangle:2': { title: 'Root triangle', text: 'Returning is part of discovery. A room you have visited may hold a passage that a later piece can open.' },
  'triangle:3': { title: 'Ember triangle', text: 'The fourth point belongs to the Pyramid star. Its glow records your knowledge even after you place its image in a shrine.' },
  'triangle:4': { title: 'Wind triangle', text: 'The fifth point belongs to the Pyramid star. Look across a room before changing its blocks; the way onward may be above you.' },
  'triangle:5': { title: 'Dusk triangle', text: 'The last point completes the outer star. The six points still need the central hexagon before the whole star is complete.' },
  hexagon: { title: 'Heart hexagon', text: 'The hollow heart opens Tideglass alongside the Tide and Root triangles. Knowledge lives in its high shelves. Six outer triangles and this central hexagon form a complete star.' },
  star: { title: 'Star of David', text: 'Six triangles and their central hexagon form one complete star. Its knowledge opens the Pyramid shrine and the final star-marked passages.' },
}

export const WORLD_SHRINES: readonly WorldShrine[] = [
  { kind: 'shrine', id: 'dawn-shrine', name: 'Dawn Shrine', subtitle: 'Sunseed · the first labyrinth', ...valleyPoint(8, 4), labyrinthId: 'sunseed', components: [{ kind: 'triangle', point: 0 }] },
  { kind: 'shrine', id: 'tide-shrine', name: 'Tide Observatory', subtitle: 'Tideglass · connected depths', ...valleyPoint(16, 4), labyrinthId: 'tideglass', components: [{ kind: 'triangle', point: 1 }, { kind: 'triangle', point: 2 }, { kind: 'hexagon' }] },
  { kind: 'shrine', id: 'pyramid-shrine', name: 'Pyramid of Accord', subtitle: 'Complete the star to uncover its rooms', ...valleyPoint(20, 8), labyrinthId: 'starbloom', components: [...Array.from({ length: 6 }, (_, point) => ({ kind: 'triangle' as const, point })), { kind: 'hexagon' }] },
]

export const WORLD_PEOPLE: readonly WorldPerson[] = [
  {
    kind: 'person', id: 'mira', name: 'Mira', role: 'Keeper of beginnings', ...valleyPoint(5, 11), color: '#d589bf',
    clue: 'Mira shows a mosaic: six triangle points around one hexagon. “The stone marked DAWN faces the sunrise. Knowledge stays yours when you share it with a shrine.”',
    question: 'Which direction should the Dawn point face?', answers: ['West, toward sunset', 'East, toward sunrise', 'Down, into the earth'], correct: 1,
    retry: 'Read the inscription again: DAWN faces the sunrise. The sun rises in the east. Try again whenever you are ready.',
    insight: 'Yes: east, toward the sunrise. Take the Dawn triangle. Walk north to the Dawn Shrine and fill its matching socket. Every piece also records a clue in your journal.',
    reward: { id: 'mira-dawn-triangle', kind: 'triangle', point: 0 },
  },
  {
    kind: 'person', id: 'oren', name: 'Oren', role: 'Cartographer of depths', ...valleyPoint(12, 9), color: '#80bbd9',
    clue: 'Oren draws two rooms at different depths, linked by a pair of doors. “The return door leads back to the room you left. Your changes wait there for you.”',
    question: 'After finding a new piece at another depth, where might a new path appear?', answers: ['In a room I visited earlier', 'Only outside the labyrinth', 'Nowhere; doors work once'], correct: 0,
    retry: 'Oren taps the return arrow. A piece can open a matching object in a room you already know; returning is useful.',
    insight: 'Exactly. Doors connect the depths in both directions. Collect pieces, revisit the matching marks, and build a mental map of the rooms.',
  },
  {
    kind: 'person', id: 'sela', name: 'Sela', role: 'Reader of the stars', ...valleyPoint(18, 12), color: '#e2b36f',
    clue: 'Sela lays out six triangular points with an empty hexagon in the middle. “The outline is only part of the star. Every chamber has a place in its pattern.”',
    question: 'What does the six-pointed outline still need to form the complete shrine?', answers: ['A seventh triangle', 'A central hexagon', 'Another doorway'], correct: 1,
    retry: 'Look at the center of the pattern: the empty space has six sides. The central hexagon completes the star.',
    insight: 'The central hexagon. Gather every point and the heart, then fill all seven sockets at the Pyramid. Your abilities remain yours after every placement.',
  },
]

export const WORLD_DUNGEONS: readonly WorldDungeon[] = [
  { kind: 'dungeon', id: 'wayfarer-cavern', name: 'Wayfarer Cavern', ...valleyPoint(9, 12), levelIndex: 0, subtitle: 'A scrolling dungeon', clue: 'An expedition through longer ruins. Read its inscriptions, interpret the rune sequence, and open the way onward. Return to the world with what you have learned.' },
  { kind: 'dungeon', id: 'highland-cavern', name: 'Highland Cavern', ...valleyPoint(20, 4), levelIndex: 2, subtitle: 'A deeper scrolling expedition', clue: 'An optional expedition through a larger cavern. Search for inscriptions and gather the information that explains its rune gate.' },
]

export const WORLD_RESIDENTS: readonly WorldResident[] = [
  {
    kind: 'resident', id: 'hollis', name: 'Hollis', role: 'Brickwarden of the Brick Garden', ...gardenPoint(10.5, 8.5), color: '#b77a4a',
    lines: [
      'The court’s cracked door is the first lesson. Face it and raise your wand: cracked brick crumbles, rune plates take a brick, rune springs raise a stone.',
      'Four plates, one seal. Lay a brick on every plate and the seal gives way.',
      'The wand you carry is the one the rooms below will ask of you. Practise here, where nothing bites.',
    ],
  },
  {
    kind: 'resident', id: 'tamsin', name: 'Tamsin', role: 'Harbour keeper of Saltmere', x: 80, y: 140, color: '#c98f5a',
    lines: [
      'Welcome to Saltmere. The valley road brought you south; the coast road runs east to the Tidewater shore.',
      'There is an empty plot on the Tidewater shore. The old stones are waiting for someone to raise a shrine on them.',
    ],
  },
  {
    kind: 'resident', id: 'ode', name: 'Ode', role: 'Net mender', x: 87, y: 143, color: '#6fa3b8',
    lines: [
      'Rivers run down from the Spine. Wherever a road meets one, the old builders laid a bridge.',
      'Follow the north road past Mirror Lake and you will reach Cinderreach, under the mountains.',
    ],
  },
  {
    kind: 'resident', id: 'pell', name: 'Pell', role: 'Harbour child', x: 83, y: 140, color: '#e0c35c',
    lines: [
      'Have you been to the Brick Garden? Hollis lets me watch. The stones come up out of the water like fish.',
      'My grandmother says people from far away will come and build shrines here. I want to play every one.',
    ],
  },
  {
    kind: 'resident', id: 'brannoch', name: 'Brannoch', role: 'Lamplighter of Lanternwick', x: 71, y: 56, color: '#d8a24a',
    lines: [
      'Whisperwood swallows anyone who leaves the road. Keep to it and you will reach the old grove plot to the southwest.',
      'The road east runs toward the Spine and on to a cliffside plot where the wind never stops.',
    ],
  },
  {
    kind: 'resident', id: 'ilse', name: 'Ilse', role: 'Woodcarver', x: 76, y: 59, color: '#9c7bc4',
    lines: [
      'Every shrine was built by someone. A shrine is its own set of rooms, and whoever builds one decides the puzzles inside.',
      'The valley’s shrines lead down into labyrinths. Other shrines may lead somewhere else entirely.',
    ],
  },
  {
    kind: 'resident', id: 'harl', name: 'Harl', role: 'Pass warden of Cinderreach', x: 180, y: 94, color: '#8fa0b3',
    lines: [
      'The north road climbs through the Spine. It is steep, but the pass stays open all year.',
      'Beyond the pass there is a cliffside plot. Nobody has built on it yet.',
    ],
  },
  {
    kind: 'resident', id: 'veya', name: 'Veya', role: 'Smith', x: 187, y: 97, color: '#c46a4f',
    lines: [
      'Mountains are not walls. Roads find the low places; follow them and you will always cross.',
      'Rock you cannot walk over is still worth looking at. Every range hides something.',
    ],
  },
  {
    kind: 'resident', id: 'orrin', name: 'Orrin', role: 'Traveller', x: 183, y: 97, color: '#7fb07a',
    lines: [
      'I walked here from Saltmere without once losing sight of the road. The whole island is one long walk, if you let it be.',
      'North of the valley the forest is deep. East of here the rivers run down to the sea.',
    ],
  },
]

export const WORLD_PLOTS: readonly WorldPlot[] = [
  { kind: 'plot', id: 'grove-plot', name: 'Old Grove Plot', subtitle: 'An empty shrine plot', x: 50, y: 84, clue: 'Roots have grown over six foundation stones laid in a ring.' },
  { kind: 'plot', id: 'lakeside-plot', name: 'Lakeside Plot', subtitle: 'An empty shrine plot', x: 128, y: 106, clue: 'A flat terrace looks out over Mirror Lake. Its corner stones are already set.' },
  { kind: 'plot', id: 'cliff-plot', name: 'Cliffside Plot', subtitle: 'An empty shrine plot', x: 162, y: 42, clue: 'A wind-scoured shelf beyond the Spine, with a doorway cut into bare rock and nothing behind it yet.' },
  { kind: 'plot', id: 'tidewater-plot', name: 'Tidewater Plot', subtitle: 'An empty shrine plot', x: 150, y: 160, clue: 'Salt-white stones mark a floor just above the tide line.' },
]

export const WORLD_CACHES: readonly WorldCache[] = [
  {
    kind: 'cache', id: 'court-cache', name: 'Brickwright’s Coffer', subtitle: 'Behind the court’s seal', ...gardenPoint(5.5, 3.5),
    lore: 'Four plates, four bricks. The seal listens for weight, not for keys. Whatever you lay down with the wand stays laid until you lift it again.',
    items: [{ kind: 'note', name: 'Brickwright’s note' }, { kind: 'coins', name: 'Old garden coins' }, { kind: 'gem', name: 'Amber brick-gem' }],
  },
  {
    kind: 'cache', id: 'pond-cache', name: 'Stone-Ferry Chest', subtitle: 'On the islet in the rune pond', ...gardenPoint(14.5, 2.5),
    lore: 'The stones you raised still stand behind you. In the rooms below, the same wand raises the floor you need to reach a door.',
    items: [{ kind: 'note', name: 'Ferryman’s note' }, { kind: 'feather', name: 'Heron feather' }],
  },
  {
    kind: 'cache', id: 'nook-cache', name: 'Hidden Nook', subtitle: 'Behind a cracked brick', ...gardenPoint(13.5, 11.5),
    lore: 'Some bricks are cracked on purpose. Builders leave them so a curious traveller will try the wand where nothing seems to invite it.',
    items: [{ kind: 'note', name: 'Builder’s scrap' }, { kind: 'gem', name: 'Violet rune-gem' }],
  },
]

export const WORLD_SIGNS: readonly WorldSign[] = [
  { kind: 'sign', id: 'valley-east-sign', name: 'Signpost', subtitle: 'At the valley’s east road', x: 77.5, y: 115.5, text: 'East: the Brick Garden, where the old builders’ wand-work still answers. South, by the valley’s lower road: Saltmere.' },
  { kind: 'sign', id: 'valley-south-sign', name: 'Signpost', subtitle: 'At the valley’s south road', x: 65.5, y: 127.5, text: 'South: Saltmere and the harbour. East of the valley: the Brick Garden.' },
  { kind: 'sign', id: 'garden-sign', name: 'Signpost', subtitle: 'The Brick Garden', ...gardenPoint(1.5, 10.5), text: 'THE BRICK GARDEN. Face a cracked brick, a rune plate or a rune spring and raise your wand (Z).' },
]

export const WORLD_ENCOUNTERS: readonly WorldEncounter[] = [
  ...WORLD_SHRINES, ...WORLD_PEOPLE, ...WORLD_DUNGEONS, ...WORLD_RESIDENTS, ...WORLD_PLOTS, ...WORLD_CACHES, ...WORLD_SIGNS,
]

export function componentKey(component: ShrineComponent): string {
  return component.kind === 'triangle' ? `triangle:${component.point}` : component.kind
}
export function componentName(component: ShrineComponent): string {
  return RELIC_LORE[componentKey(component)]?.title ?? 'Unknown piece'
}

/** The island as built. A cell spans [col, col + 1). Wand changes are the model's. */
export function worldTerrain(col: number, row: number): IslandTerrain {
  return islandTerrainAt(theIsland(), col, row)
}

export class RpgOverworld {
  readonly player = { x: WORLD_START.x, y: WORLD_START.y, facing: 'down' as 'up' | 'down' | 'left' | 'right' }
  readonly filledSockets = new Set<string>()
  readonly journal = new Set<string>()
  readonly met = new Set<string>()
  readonly solved = new Set<string>()
  readonly opened = new Set<string>()
  readonly hooks: WorldHooks
  readonly #talks = new Map<string, number>()
  /** Island cells the wand has changed. */
  readonly #changed = new Set<number>()
  readonly #stampCells = new Map<string, number[]>()
  constructor(hooks: WorldHooks) { this.hooks = hooks }

  get island(): Island { return theIsland() }
  regionAt(): string { return islandRegionAt(this.island, this.player.x, this.player.y) }

  /** A cell as it is now: the island as built, with the wand's changes on top. */
  terrainAt(col: number, row: number): IslandTerrain {
    const land = this.island
    const built = islandTerrainAt(land, col, row)
    if (built === 'seal') return this.sealOpen(land.stampOf[row * land.cols + col] ?? -1) ? 'rubble' : 'seal'
    if (!WAND_CELLS.has(built) || !this.#changed.has(row * land.cols + col)) return built
    return WAND_MADE[built] ?? built
  }

  /** A place's seal stands until every rune plate in that place holds a brick. */
  sealOpen(stamp: number): boolean {
    const plates = this.#cellsOf(stamp, 'rune')
    return plates.length > 0 && plates.every(cell => this.#changed.has(cell))
  }

  sealCells(stamp: number): { col: number; row: number }[] {
    const { cols } = this.island
    return this.#cellsOf(stamp, 'seal').map(cell => ({ col: cell % cols, row: Math.floor(cell / cols) }))
  }

  /** Walled in on every side — a cache behind a seal or a cracked brick stays
   *  unseen until the wand opens a way to it. */
  enclosed(place: WorldPlace): boolean {
    const col = Math.floor(place.x), row = Math.floor(place.y)
    return [[0, -1], [0, 1], [-1, 0], [1, 0]].every(([dx, dy]) => !isWalkableTerrain(this.terrainAt(col + dx!, row + dy!)))
  }

  /** The cell the wand points at: the one in front of the cell you stand in. */
  wandTarget(): { col: number; row: number } {
    const [dx, dy] = FACING_STEP[this.player.facing]
    return { col: Math.floor(this.player.x) + dx, row: Math.floor(this.player.y) + dy }
  }
  canCast(): boolean {
    const { col, row } = this.wandTarget()
    return WAND_CELLS.has(islandTerrainAt(this.island, col, row))
  }

  cast(): WorldResult {
    const land = this.island
    const { col, row } = this.wandTarget()
    const built = islandTerrainAt(land, col, row)
    const made = WAND_MADE[built]
    if (!WAND_CELLS.has(built) || !made) return this.result(false, 'The wand stirs, but only cracked bricks, rune plates and rune springs answer it.')
    const cell = row * land.cols + col, stamp = land.stampOf[cell] ?? -1
    const wasOpen = this.sealOpen(stamp)
    const making = !this.#changed.has(cell)
    const after = making ? made : built
    if (!isWalkableTerrain(after) && this.#overlaps(col, row)) return this.result(false, 'Step back first: the wand will not close the cell you are standing in.')
    if (making) this.#changed.add(cell); else this.#changed.delete(cell)
    const open = this.sealOpen(stamp)
    if (wasOpen && !open && this.sealCells(stamp).some(seal => this.#overlaps(seal.col, seal.row))) {
      if (making) this.#changed.delete(cell); else this.#changed.add(cell)
      return this.result(false, 'Step out of the doorway first: the seal would close on you.')
    }
    const message = open === wasOpen ? WAND_WORDS[after] ?? '' : open ? 'Every plate holds a brick. The seal dissolves.' : 'A plate is empty again, and the seal closes.'
    this.hooks.onMessage?.(message)
    return { ok: true, message, wand: { col, row, terrain: after, seal: open !== wasOpen } }
  }

  exportState(): WorldSnapshot {
    return {
      version: 2, player: { ...this.player }, met: [...this.met].sort(), solved: [...this.solved].sort(),
      journal: [...this.journal].sort(), filledSockets: [...this.filledSockets].sort(), wand: this.#wandKeys(), opened: [...this.opened].sort(),
    }
  }

  /** Inventory is restored by the journey first. Only owned components can
   *  reappear in a shrine; a different slot replaces every local collection. */
  restoreState(raw: unknown): void {
    Object.assign(this.player, { ...WORLD_START, facing: 'down' })
    this.met.clear(); this.solved.clear(); this.journal.clear(); this.filledSockets.clear()
    this.opened.clear(); this.#talks.clear(); this.#changed.clear()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const saved = raw as Record<string, unknown>
    const version = saved['version']
    if (version !== 1 && version !== 2) return
    const includes = (field: string, id: string): boolean => Array.isArray(saved[field]) && (saved[field] as unknown[]).includes(id)
    for (const person of WORLD_PEOPLE) {
      const solved = includes('solved', person.id) && (!person.reward || this.owns(person.reward))
      if (includes('met', person.id) || solved) {
        this.met.add(person.id)
        this.journal.add(`person:${person.id}`)
      }
      if (solved) this.solved.add(person.id)
    }
    for (const shrine of WORLD_SHRINES) shrine.components.forEach((piece, index) => {
      const key = `${shrine.id}:${index}`
      if (includes('filledSockets', key) && this.owns(piece)) {
        this.filledSockets.add(key)
        this.journal.add(componentKey(piece))
      }
    })
    for (const key of Object.keys(RELIC_LORE)) {
      const piece: ShrineComponent = key.startsWith('triangle:')
        ? { kind: 'triangle', point: Number(key.slice('triangle:'.length)) }
        : { kind: key as 'hexagon' | 'star' }
      if (includes('journal', key) && this.owns(piece)) this.journal.add(key)
    }
    for (const cache of WORLD_CACHES) {
      if (!includes('opened', cache.id)) continue
      this.opened.add(cache.id)
      this.journal.add(`cache:${cache.id}`)
    }
    const land = this.island
    if (Array.isArray(saved['wand'])) for (const key of saved['wand'] as unknown[]) {
      const match = typeof key === 'string' ? /^([a-z0-9-]+):(\d+),(\d+)$/.exec(key) : null
      const place = match ? land.def.stamps.find(candidate => candidate.id === match[1]) : undefined
      if (!match || !place) continue
      const col = Number(match[2]), row = Number(match[3])
      if (col >= stampWidth(place) || row >= place.map.length) continue
      if (WAND_CELLS.has(islandTerrainAt(land, place.col + col, place.row + row))) this.#changed.add((place.row + row) * land.cols + place.col + col)
    }
    const player = saved['player']
    if (player && typeof player === 'object' && !Array.isArray(player)) {
      const position = player as Record<string, unknown>
      let x = position['x'], y = position['y']
      const facing = position['facing']
      // A version 1 save was written on the one-screen valley, so its
      // coordinates are valley-local and only ever name a place inside it.
      if (version === 1 && typeof x === 'number' && typeof y === 'number') {
        const inside = x >= 0 && x < VALLEY_COLS && y >= 0 && y < VALLEY_ROWS
        const moved = valleyPoint(x, y)
        x = inside ? moved.x : NaN
        y = inside ? moved.y : NaN
      }
      if (typeof x === 'number' && typeof y === 'number' && this.walkable(x, y)) {
        this.player.x = x; this.player.y = y
      }
      if (facing === 'up' || facing === 'down' || facing === 'left' || facing === 'right') this.player.facing = facing
    }
  }

  walkable(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    for (const ox of [-0.2, 0.2]) for (const oy of [-0.2, 0.2]) {
      if (!isWalkableTerrain(this.terrainAt(Math.floor(x + ox), Math.floor(y + oy)))) return false
    }
    return true
  }

  update(dt: number, input: WorldInput = {}): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    let dx = Number(!!input.right) - Number(!!input.left)
    let dy = Number(!!input.down) - Number(!!input.up)
    if (!dx && !dy) return
    this.player.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down'
    const scale = SPEED * Math.min(dt, 0.25) / Math.hypot(dx, dy)
    dx *= scale; dy *= scale
    // Small collision steps prevent a dropped frame from crossing a lake edge.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15))
    for (let i = 0; i < steps; i++) {
      if (this.walkable(this.player.x + dx / steps, this.player.y)) this.player.x += dx / steps
      if (this.walkable(this.player.x, this.player.y + dy / steps)) this.player.y += dy / steps
    }
  }

  near(encounter: WorldEncounter): boolean {
    return Math.hypot(this.player.x - encounter.x, this.player.y - encounter.y) <= (REACH_OF[encounter.kind] ?? REACH)
  }
  /** The closest place E acts on. Signs are read by walking up to them, never by pressing E. */
  nearest(): WorldEncounter | undefined {
    return WORLD_ENCOUNTERS.filter(place => place.kind !== 'sign' && this.near(place)).sort((a, b) =>
      Math.hypot(this.player.x - a.x, this.player.y - a.y) - Math.hypot(this.player.x - b.x, this.player.y - b.y))[0]
  }
  interact(targetId?: string): WorldResult {
    const encounter = targetId ? WORLD_ENCOUNTERS.find(place => place.id === targetId) : this.nearest()
    if (!encounter) return this.result(false, 'Explore the world. Walk close to a person, shrine or cavern and press E to interact.')
    if (!this.near(encounter)) return this.result(false, `Walk closer to ${encounter.name} to interact.`)
    if (encounter.kind === 'dungeon') return this.enterDungeon(encounter.id)
    if (encounter.kind === 'shrine' && this.shrineStatus(encounter.id) === 'open') return this.enter(encounter.id)
    if (encounter.kind === 'person') {
      this.met.add(encounter.id)
      this.journal.add(`person:${encounter.id}`)
    }
    if (encounter.kind === 'cache') {
      const fresh = !this.opened.has(encounter.id)
      this.opened.add(encounter.id)
      this.journal.add(`cache:${encounter.id}`)
      return { ok: true, message: encounter.name, encounter, fresh }
    }
    return { ok: true, message: encounter.name, encounter }
  }
  answer(npcId: string, choiceIndex: number): WorldResult {
    const person = WORLD_PEOPLE.find(npc => npc.id === npcId)
    if (!person || !this.near(person)) return this.result(false, 'Walk closer to speak with them.')
    this.met.add(person.id); this.journal.add(`person:${person.id}`)
    if (choiceIndex !== person.correct) return this.result(false, person.retry)
    this.solved.add(person.id)
    if (person.reward) {
      if (!this.hooks.has(person.reward)) this.hooks.grantRelic(person.reward)
      this.journal.add(componentKey(person.reward))
    }
    return this.result(true, person.insight)
  }
  /** A resident's next line; they cycle through what they know. */
  talk(residentId: string): WorldResult {
    const resident = WORLD_RESIDENTS.find(candidate => candidate.id === residentId)
    if (!resident || !this.near(resident)) return this.result(false, 'Walk closer to speak with them.')
    const turn = this.#talks.get(resident.id) ?? 0
    this.#talks.set(resident.id, turn + 1)
    return { ok: true, message: resident.lines[turn % resident.lines.length] ?? '', encounter: resident }
  }
  socketFilled(shrineId: string, index: number): boolean { return this.filledSockets.has(`${shrineId}:${index}`) }
  owns(component: ShrineComponent): boolean { return this.hooks.has(component) || this.hooks.has({ kind: 'star' }) }
  shrineStatus(shrineId: string): ShrineState {
    const shrine = WORLD_SHRINES.find(place => place.id === shrineId)
    if (!shrine) return 'missing'
    if (shrine.components.every((_, i) => this.socketFilled(shrineId, i))) return 'open'
    return shrine.components.every(piece => this.owns(piece)) ? 'ready' : 'missing'
  }
  fillSocket(shrineId: string, index: number): WorldResult {
    const shrine = WORLD_SHRINES.find(place => place.id === shrineId)
    if (!shrine || !this.near(shrine)) return this.result(false, 'Walk up to the shrine before placing a piece.')
    const component = shrine.components[index]
    if (!component) return this.result(false, 'That socket is not part of this shrine.')
    if (this.socketFilled(shrineId, index)) return this.result(true, 'This socket already holds its piece. Your ability remains with you.')
    if (!this.owns(component)) return this.result(false, `Find the ${componentName(component)} before filling this socket.`)
    this.filledSockets.add(`${shrineId}:${index}`)
    this.journal.add(componentKey(component))
    return this.result(true, this.shrineStatus(shrineId) === 'open'
      ? `${shrine.name} is complete. The labyrinth is open; your pieces and their knowledge stay with you.`
      : `${componentName(component)} placed. Its ability and knowledge stay with you.`)
  }
  enter(shrineId: string): WorldResult {
    const shrine = WORLD_SHRINES.find(place => place.id === shrineId)
    if (!shrine || !this.near(shrine)) return this.result(false, 'Walk up to the shrine to enter.')
    if (this.shrineStatus(shrineId) !== 'open') return this.result(false, 'Fill every component socket in this shrine before entering.')
    this.hooks.onEnter(shrine.labyrinthId)
    return { ok: true, message: `Entering ${shrine.name}.` }
  }
  enterDungeon(dungeonId: string): WorldResult {
    const dungeon = WORLD_DUNGEONS.find(place => place.id === dungeonId)
    if (!dungeon || !this.near(dungeon)) return this.result(false, 'Walk up to the cavern entrance first.')
    if (!this.hooks.onDungeon) return this.result(false, 'This expedition is not available here yet.')
    this.hooks.onDungeon(dungeon.levelIndex)
    return { ok: true, message: `Entering ${dungeon.name}.` }
  }
  private result(ok: boolean, message: string): WorldResult { this.hooks.onMessage?.(message); return { ok, message } }

  #overlaps(col: number, row: number): boolean {
    const { x, y } = this.player
    return x + 0.2 > col && x - 0.2 < col + 1 && y + 0.2 > row && y - 0.2 < row + 1
  }

  #cellsOf(stamp: number, terrain: IslandTerrain): number[] {
    const key = `${stamp}:${terrain}`
    let cells = this.#stampCells.get(key)
    if (!cells) {
      const land = this.island, place = land.def.stamps[stamp]
      cells = []
      if (place) for (let row = 0; row < place.map.length; row++) for (let col = 0; col < stampWidth(place); col++) {
        if (islandTerrainAt(land, place.col + col, place.row + row) === terrain) cells.push((place.row + row) * land.cols + place.col + col)
      }
      this.#stampCells.set(key, cells)
    }
    return cells
  }

  /** Saved by place and local cell, so the island can grow without moving them. */
  #wandKeys(): string[] {
    const land = this.island
    const keys: string[] = []
    for (const cell of this.#changed) {
      const place = land.def.stamps[land.stampOf[cell] ?? -1]
      if (!place) continue
      const col = cell % land.cols, row = (cell - col) / land.cols
      keys.push(`${place.id}:${col - place.col},${row - place.row}`)
    }
    return keys.sort()
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const node = element('button', className, text)
  node.type = 'button'; node.addEventListener('click', action)
  return node
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
/** A figure's feet stand a little below its position, at the foot of its collision box. */
const FOOT = 0.22

function placeDetail(place: WorldEncounter): string {
  return place.kind === 'person' || place.kind === 'resident' ? place.role : place.subtitle
}
function placeLook(place: WorldEncounter, model: RpgOverworld): readonly [PlaceSprite, PlaceGlow] {
  if (place.kind === 'shrine') {
    const state = model.shrineStatus(place.id)
    return [place.id === 'pyramid-shrine' ? 'pyramid' : 'shrine', state === 'open' ? 'open' : state === 'ready' ? 'ready' : null]
  }
  if (place.kind === 'dungeon') return ['cavern', null]
  if (place.kind === 'plot') return ['plot', null]
  if (place.kind === 'cache') return [model.opened.has(place.id) ? 'cache-open' : 'cache', null]
  return ['sign', null]
}
const MINIMAP_DOT: Readonly<Record<WorldEncounter['kind'], string | null>> = {
  shrine: '#ffd978', dungeon: '#e8c79a', plot: '#bfe3ff', cache: '#f2c96b', person: null, resident: null, sign: null,
}

/** Six equilateral points share the sides of the central hexagon. */
function shrinePolygon(component: ShrineComponent): { x: number; y: number }[] {
  const point = (angle: number, radius: number) => ({ x: 120 + Math.cos(angle * Math.PI / 180) * radius, y: 120 + Math.sin(angle * Math.PI / 180) * radius })
  if (component.kind === 'hexagon') return Array.from({ length: 6 }, (_, i) => point(-60 + i * 60, 100 / Math.sqrt(3)))
  const angle = -90 + (component.kind === 'triangle' ? component.point : 0) * 60
  return [point(angle - 30, 100 / Math.sqrt(3)), point(angle, 100), point(angle + 30, 100 / Math.sqrt(3))]
}

/** A keyboard-walkable island. The canvases show the land, a camera follows the
 *  player, and people and entrances are real buttons on a layer that moves
 *  with the camera. The shell supplies the animation loop. */
export class RpgOverworldView {
  readonly model: RpgOverworld
  #root: HTMLDivElement | null = null
  #map: HTMLDivElement | null = null
  #layer: HTMLDivElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #above: CanvasRenderingContext2D | null = null
  #painter: IslandPainter | null = null
  #minimap: CanvasRenderingContext2D | null = null
  #minimapBase: HTMLCanvasElement | null = null
  #minimapKey = ''
  #regionTitle: HTMLElement | null = null
  #banner: HTMLDivElement | null = null
  #resize: ResizeObserver | null = null
  #player: HTMLCanvasElement | null = null
  #sprite: CanvasRenderingContext2D | null = null
  #spriteKey = ''
  #prompt: HTMLButtonElement | null = null
  #dialog: HTMLDivElement | null = null
  #lastFocus: HTMLElement | null = null
  #places = new Map<string, HTMLButtonElement>()
  readonly #placeArt = new Map<string, CanvasRenderingContext2D>()
  readonly #placeLooks = new Map<string, string>()
  readonly #bursts: WandBurst[] = []
  #stopReveal: (() => void) | null = null
  /** Speech beside people, signs, shrines and plots: in the world, never in a
   *  dialog. Jaime, 2026-09-11: "these kind of messages should be eradicated
   *  … when there are choices you still want the open view style … if they
   *  ask you a question you can answer and then you can do something
   *  different." A question keeps its bubble open, with its choices inside,
   *  until it is answered or the player walks away. */
  #speechLayer: HTMLDivElement | null = null
  readonly #bubbles = new Map<string, { place: WorldEncounter; bubble: HTMLDivElement }>()
  readonly #speech = new Map<string, WorldSpeech>()
  #askSerial = 0
  #notice = ''
  readonly #camera: IslandCamera = { x: 0, y: 0, width: 0, height: 0, tile: 32, dpr: 1 }
  readonly #look = { x: 0, y: 0, ready: false }
  #time = 0
  #region = ''
  #pendingRegion = ''
  #pendingFor = 0
  constructor(hooks: WorldHooks) { this.model = new RpgOverworld(hooks) }
  get isDialogOpen(): boolean { return this.#dialog !== null }
  exportState(): WorldSnapshot { return this.model.exportState() }
  restoreState(raw: unknown): void {
    this.closeDialog()
    this.#speech.clear()
    this.model.restoreState(raw)
    this.#notice = ''
    this.#region = this.model.regionAt()
    if (this.#regionTitle) this.#regionTitle.textContent = this.#region
    // The wand may have changed any baked cell; start the island's bakes from scratch.
    if (this.#painter) this.#painter = new IslandPainter(this.model.island, (col, row) => this.model.terrainAt(col, row))
    this.#look.ready = false
    this.refresh()
    this.#draw(0)
  }

  /** The island as the veil sees it: the map's canvases at one cell per
   *  block, scaled around an island point — the entrance you take, or where
   *  you stand when you come back up. Read lazily, from the camera as it is
   *  when the veil draws. */
  leaveLeg(at: { x: number; y: number }, direction: VeilDirection): VeilLeg | null { return this.#veilLeg(at, VEIL_ZOOM[direction].leave) }
  arriveLeg(at: { x: number; y: number }, direction: VeilDirection): VeilLeg | null { return this.#veilLeg(at, VEIL_ZOOM[direction].arrive) }
  #veilLeg(at: { x: number; y: number }, scale: number): VeilLeg | null {
    const map = this.#map, ground = this.#ctx?.canvas, camera = this.#camera
    if (!map || !ground) return null
    const canvases = [ground, this.#above?.canvas].filter((canvas): canvas is HTMLCanvasElement => !!canvas)
    const picture: VeilPicture = {
      get cols() { return Math.ceil(camera.width / camera.tile) },
      get rows() { return Math.ceil(camera.height / camera.tile) },
      paint(ctx, block) { veilCanvasPicture(canvases, this.cols, this.rows).paint(ctx, block) },
    }
    return {
      element: map, picture, scale,
      get origin(): readonly [number, number] {
        return camera.width && camera.height ? [clamp((at.x * camera.tile - camera.x) / camera.width, 0, 1), clamp((at.y * camera.tile - camera.y) / camera.height, 0, 1)] : [0.5, 0.5]
      },
    }
  }

  mount(host: HTMLElement): void {
    this.dispose()
    const land = this.model.island
    const root = element('div', 'sol-rpg-world')
    root.append(element('style', '', WORLD_STYLE))
    const heading = element('div', 'sol-rpg-world-heading')
    this.#region = this.model.regionAt()
    this.#regionTitle = element('h2', '', this.#region)
    heading.append(element('span', 'sol-rpg-eyebrow', 'THE ISLAND ABOVE'), this.#regionTitle, element('p', '', 'Meet its people. Learn the signs. Open the way below.'))
    const journal = button('Knowledge journal', () => {
      if (this.model.hooks.onJournal) this.model.hooks.onJournal()
      else this.openJournal()
    }, 'sol-rpg-journal')
    heading.append(journal); root.append(heading)
    const map = element('div', 'sol-rpg-map')
    this.#map = map
    map.setAttribute('role', 'group'); map.setAttribute('aria-label', 'Island map. Move with arrow keys or W A S D; the view follows you. Approach a person or entrance, then press Enter or E, or click, to interact. Z raises the wand at the cell in front of you.')
    const canvas = element('canvas', 'sol-rpg-canvas')
    canvas.setAttribute('aria-hidden', 'true')
    this.#ctx = canvasContext(canvas)
    this.#painter = new IslandPainter(land, (col, row) => this.model.terrainAt(col, row))
    const layer = element('div', 'sol-rpg-layer')
    this.#layer = layer
    const speech = element('div', 'sol-rpg-speech')
    speech.setAttribute('aria-live', 'polite')
    this.#speechLayer = speech
    for (const place of WORLD_ENCOUNTERS) {
      const marker = button('', () => this.interact(place.id), `sol-rpg-place sol-rpg-place-${place.kind}`)
      marker.setAttribute('aria-label', `${place.name}, ${placeDetail(place)}`)
      const walker = place.kind === 'person' || place.kind === 'resident'
      const art = element('canvas', walker ? 'sol-rpg-figure' : 'sol-rpg-sprite')
      art.width = walker ? 64 : 96; art.height = 96
      art.setAttribute('aria-hidden', 'true')
      const artContext = canvasContext(art)
      if (artContext && walker) drawWalker(artContext, lookFor(place.id, place.color), 'down', 0)
      else if (artContext) this.#placeArt.set(place.id, artContext)
      marker.style.zIndex = String(Math.round(place.y * 10))
      marker.append(art, element('span', 'sol-rpg-place-label', place.name))
      this.#places.set(place.id, marker); layer.append(marker)
      if (place.kind !== 'dungeon' && place.kind !== 'cache') {
        const bubble = element('div', `sol-rpg-bubble sol-rpg-bubble-${place.kind}`)
        bubble.dataset['for'] = place.id
        speech.append(bubble)
        this.#bubbles.set(place.id, { place, bubble })
      }
    }
    this.#player = element('canvas', 'sol-rpg-player')
    this.#player.width = 64; this.#player.height = 96
    this.#player.setAttribute('role', 'img'); this.#player.setAttribute('aria-label', 'You')
    this.#sprite = canvasContext(this.#player)
    this.#spriteKey = ''
    layer.append(this.#player)
    const above = element('canvas', 'sol-rpg-canvas sol-rpg-above')
    above.setAttribute('aria-hidden', 'true')
    this.#above = canvasContext(above)
    this.#banner = element('div', 'sol-rpg-region')
    this.#banner.setAttribute('aria-hidden', 'true')
    const minimap = element('canvas', 'sol-rpg-minimap')
    minimap.setAttribute('aria-hidden', 'true')
    minimap.width = land.cols; minimap.height = land.rows
    this.#minimap = canvasContext(minimap)
    this.#minimapBase = this.#minimap ? this.#painter.minimap() : null
    map.append(canvas, layer, above, speech, this.#banner, minimap)
    this.#prompt = button('', () => this.interact(), 'sol-rpg-world-prompt')
    this.#prompt.setAttribute('aria-live', 'polite')
    const controls = element('div', 'sol-rpg-world-controls')
    controls.append(element('span', '', 'WASD / arrows · Walk'), button('E · Interact', () => this.interact()), button('Z · Wand', () => this.cast()))
    root.append(map, this.#prompt, controls)
    host.append(root); this.#root = root
    this.#layout(); this.refresh(); this.#fit()
    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => this.#fit())
      this.#resize.observe(map)
    }
  }

  update(dt: number, input: WorldInput = {}): void {
    if (this.isDialogOpen) return
    const beforeX = this.model.player.x, beforeY = this.model.player.y
    this.model.update(dt, input)
    const moved = beforeX !== this.model.player.x || beforeY !== this.model.player.y
    if (moved) this.#notice = ''
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0
    this.#time += step
    for (const burst of this.#bursts) burst.age += step
    while (this.#bursts.length && this.#bursts[0]!.age >= BURST_LIFE) this.#bursts.shift()
    if (this.#player) this.#player.dataset['moving'] = String(moved)
    this.#trackRegion(step)
    this.refresh()
    this.#draw(step)
  }

  /** Raises the wand at the cell in front of the player. */
  cast(): void {
    if (this.isDialogOpen) return
    const target = this.model.wandTarget()
    const result = this.model.cast()
    const change = result.wand
    if (change && this.#painter) {
      this.#painter.invalidate(change.col, change.row)
      if (change.seal) {
        const land = this.model.island
        for (const seal of this.model.sealCells(land.stampOf[change.row * land.cols + change.col] ?? -1)) this.#painter.invalidate(seal.col, seal.row)
      }
    }
    const lays = change?.terrain === 'laid' || change?.terrain === 'stone' || change?.terrain === 'crack'
    this.#bursts.push({ x: target.col + 0.5, y: target.row + 0.5, age: 0, kind: !change ? 'deny' : lays ? 'lay' : 'lift' })
    this.#notice = result.message
    this.refresh()
    this.#draw(0.0001)
  }

  refresh(): void {
    const tile = this.#camera.tile
    const { player } = this.model
    if (this.#player) {
      this.#player.style.left = `${player.x * tile}px`
      this.#player.style.top = `${(player.y + FOOT) * tile}px`
      this.#player.style.zIndex = String(Math.round(player.y * 10))
      this.#player.dataset['facing'] = player.facing
      const step = this.#player.dataset['moving'] === 'true' ? Math.floor(this.#time * 8) % 4 : 0
      const key = `${player.facing}:${step}`
      if (this.#sprite && key !== this.#spriteKey) {
        this.#spriteKey = key
        drawWalker(this.#sprite, PLAYER_LOOK, player.facing, step)
      }
    }
    for (const shrine of WORLD_SHRINES) {
      const marker = this.#places.get(shrine.id)
      if (marker) marker.dataset['state'] = this.model.shrineStatus(shrine.id)
    }
    for (const place of WORLD_ENCOUNTERS) {
      const marker = this.#places.get(place.id)
      if (!marker) continue
      const close = Math.hypot(player.x - place.x, player.y - place.y) < 4
      if (close !== ('near' in marker.dataset)) {
        if (close) marker.dataset['near'] = ''
        else delete marker.dataset['near']
      }
      const art = this.#placeArt.get(place.id)
      if (!art) continue
      const [sprite, glow] = placeLook(place, this.model)
      const look = `${sprite}:${glow}`
      if (this.#placeLooks.get(place.id) === look) continue
      this.#placeLooks.set(place.id, look)
      drawPlace(art, sprite, glow)
    }
    for (const { place, bubble } of this.#bubbles.values()) {
      const distance = Math.hypot(player.x - place.x, player.y - place.y)
      const spoken = this.#speech.get(place.id)
      if (spoken && (spoken.until < this.#time || distance > 4.5)) this.#speech.delete(place.id)
      const speech = this.#speech.get(place.id)
      const signText = place.kind === 'sign' && distance < SIGN_READ ? place.text : ''
      const key = speech?.key ?? (signText ? `sign:${place.id}` : '')
      // Keep the words while fading out, so the bubble does not empty as it goes.
      if (key && bubble.dataset['key'] !== key) {
        bubble.dataset['key'] = key
        if (speech?.nodes) bubble.replaceChildren(...speech.nodes())
        else bubble.textContent = speech?.text ?? signText
      }
      bubble.classList.toggle('is-shown', !!key)
      bubble.classList.toggle('is-live', !!speech?.nodes)
      // A bubble near the top of the view opens downward, so it stays on screen.
      bubble.classList.toggle('is-below', this.#camera.height > 0 && place.y * tile - this.#camera.y < this.#camera.height * 0.42)
    }
    const nearest = this.model.nearest()
    const accessible = nearest?.kind === 'dungeon' || (nearest?.kind === 'shrine' && this.model.shrineStatus(nearest.id) === 'open')
    const verb = nearest?.kind === 'person' || nearest?.kind === 'resident' ? 'talk'
      : nearest?.kind === 'plot' ? 'look'
        : nearest?.kind === 'sign' ? 'read'
          : nearest?.kind === 'cache' ? this.model.opened.has(nearest.id) ? 'read again' : 'open'
            : 'assemble'
    const message = this.#notice || (nearest
      ? accessible ? `${nearest.name} · ${nearest.kind === 'dungeon' ? 'Read inscriptions and solve rune gates.' : 'The shrine is complete.'} Enter / E or click to enter`
        : `${nearest.name} · Enter / E or click to ${verb}`
      : 'Walk the valley. Mira, by the west path, has your first clue.')
    if (this.#prompt && this.#prompt.textContent !== message) this.#prompt.textContent = message
    if (this.#prompt) this.#prompt.disabled = !nearest
  }
  /** A question is waiting beside someone or something: a person's choices,
   *  or a shrine's sockets. Play goes on around it. */
  get isSpeaking(): boolean { return [...this.#speech.values()].some(speech => !!speech.nodes) }
  /** Puts every open question away; true when one was open. */
  dismiss(): boolean {
    const open = this.isSpeaking
    for (const [id, speech] of this.#speech) if (speech.nodes) this.#speech.delete(id)
    if (open) this.refresh()
    return open
  }
  interact(targetId?: string): void {
    if (this.isDialogOpen) return
    const result = this.model.interact(targetId)
    if (!result.encounter) { this.#notice = result.ok ? '' : result.message; this.refresh(); return }
    this.#notice = ''
    const place = result.encounter
    // E opened this question, so E puts it away again.
    if (!targetId && this.#speech.get(place.id)?.nodes) { this.#speech.delete(place.id); this.refresh(); return }
    if (place.kind === 'person') this.openPerson(place)
    else if (place.kind === 'shrine') this.openShrine(place)
    else if (place.kind === 'resident') this.#speak(place, this.model.talk(place.id).message)
    else if (place.kind === 'plot') this.#openPlot(place)
    else if (place.kind === 'cache') this.#openCache(place, result.fresh === true)
    else if (place.kind === 'sign') this.#speak(place, place.text)
  }
  closeDialog(): void {
    this.#stopReveal?.(); this.#stopReveal = null
    this.#dialog?.remove(); this.#dialog = null
    this.#lastFocus?.focus({ preventScroll: true }); this.#lastFocus = null
    this.refresh()
  }
  dispose(): void {
    this.#resize?.disconnect(); this.#resize = null
    this.#dialog = null; this.#lastFocus = null
    this.#root?.remove(); this.#root = null; this.#map = null; this.#layer = null; this.#player = null; this.#prompt = null
    this.#places.clear(); this.#placeArt.clear(); this.#placeLooks.clear(); this.#bursts.length = 0
    this.#bubbles.clear(); this.#speech.clear(); this.#speechLayer = null
    this.#ctx = null; this.#above = null; this.#sprite = null; this.#spriteKey = ''; this.#painter = null
    this.#minimap = null; this.#minimapBase = null; this.#minimapKey = ''
    this.#regionTitle = null; this.#banner = null
    this.#camera.width = this.#camera.height = 0; this.#look.ready = false
  }

  /** Sizes the canvases to the map and picks a cell size that shows a
   *  comfortable stretch of land on a phone and on a wide screen alike. */
  #fit(): void {
    const map = this.#map
    if (!map || !map.clientWidth || !map.clientHeight) return
    const width = map.clientWidth, height = map.clientHeight
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 2)
    const tile = clamp(Math.round(Math.min(width / 22, height / 13)), 26, 48)
    const rescaled = tile !== this.#camera.tile
    Object.assign(this.#camera, { width, height, dpr, tile })
    for (const surface of [this.#ctx?.canvas, this.#above?.canvas]) {
      if (surface) { surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr) }
    }
    if (rescaled) this.#layout()
    this.#look.ready = false
    this.refresh()
    this.#draw(0)
  }

  #layout(): void {
    const tile = this.#camera.tile
    this.#map?.style.setProperty('--sprite-scale', String(Math.round(tile / 36 * 100) / 100))
    for (const place of WORLD_ENCOUNTERS) {
      const marker = this.#places.get(place.id)
      if (!marker) continue
      marker.style.left = `${place.x * tile}px`
      marker.style.top = `${(place.y + FOOT) * tile}px`
    }
    for (const { place, bubble } of this.#bubbles.values()) {
      bubble.style.left = `${place.x * tile}px`
      bubble.style.top = `${(place.y + FOOT) * tile}px`
    }
  }

  #draw(dt: number): void {
    const camera = this.#camera
    if (!camera.width || !camera.height) return
    const { player } = this.model, tile = camera.tile
    const targetX = clamp(player.x * tile - camera.width / 2, 0, Math.max(0, WORLD_COLS * tile - camera.width))
    const targetY = clamp(player.y * tile - camera.height / 2, 0, Math.max(0, WORLD_ROWS * tile - camera.height))
    if (!this.#look.ready || dt <= 0) {
      this.#look.x = targetX; this.#look.y = targetY; this.#look.ready = true
    } else {
      const follow = 1 - Math.exp(-dt * 9)
      this.#look.x += (targetX - this.#look.x) * follow
      this.#look.y += (targetY - this.#look.y) * follow
    }
    camera.x = Math.round(this.#look.x)
    camera.y = Math.round(this.#look.y)
    const shift = `translate3d(${-camera.x}px, ${-camera.y}px, 0)`
    if (this.#layer) this.#layer.style.transform = shift
    if (this.#speechLayer) this.#speechLayer.style.transform = shift
    if (this.#ctx && this.#painter) {
      this.#painter.paint(this.#ctx, this.#above, camera, this.#time)
      if (this.#above) this.#painter.paintOverlay(this.#above, camera, this.#time, this.#bursts, this.model.canCast() ? this.model.wandTarget() : null)
    }
    // Only places on or near the screen take part in the focus order.
    const margin = tile * 3
    for (const place of WORLD_ENCOUNTERS) {
      const marker = this.#places.get(place.id)
      if (!marker) continue
      const px = place.x * tile, py = place.y * tile
      const offscreen = px < camera.x - margin || px > camera.x + camera.width + margin || py < camera.y - margin || py > camera.y + camera.height + margin
      const unseen = offscreen || (place.kind === 'cache' && this.model.enclosed(place))
      if (marker.hidden !== unseen) marker.hidden = unseen
    }
    this.#paintMinimap()
  }

  #paintMinimap(): void {
    const ctx = this.#minimap, base = this.#minimapBase
    if (!ctx || !base) return
    const { player } = this.model, camera = this.#camera
    const key = `${camera.x},${camera.y},${camera.width},${camera.height},${camera.tile},${Math.round(player.x * 2)},${Math.round(player.y * 2)}`
    if (key === this.#minimapKey) return
    this.#minimapKey = key
    ctx.drawImage(base, 0, 0)
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.85)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(camera.x / camera.tile, camera.y / camera.tile, camera.width / camera.tile, camera.height / camera.tile)
    for (const place of WORLD_ENCOUNTERS) {
      const color = MINIMAP_DOT[place.kind]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(place.x - 2, place.y - 2, 4, 4)
    }
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#1b2a2f'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(player.x, player.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  /** The region title changes once the player has actually arrived, so
   *  brushing along a border does not flicker the banner. */
  #trackRegion(dt: number): void {
    const region = this.model.regionAt()
    if (region === this.#region) { this.#pendingRegion = ''; return }
    if (region !== this.#pendingRegion) { this.#pendingRegion = region; this.#pendingFor = 0 }
    this.#pendingFor += dt
    if (this.#pendingFor < 0.4) return
    this.#region = region
    this.#pendingRegion = ''
    if (this.#regionTitle) this.#regionTitle.textContent = region
    const banner = this.#banner
    if (!banner) return
    banner.textContent = region
    banner.classList.remove('is-shown')
    void banner.offsetWidth // restart the animation
    banner.classList.add('is-shown')
  }

  /** A line spoken in the world, beside whoever said it, for long enough to read. */
  #speak(place: WorldEncounter, text: string): void {
    if (!text) return
    this.#speech.set(place.id, { key: `say:${text}`, text, until: this.#time + Math.max(4, text.length / 16) })
    this.refresh()
  }
  /** Something asked beside a place, with its choices inside the bubble. It
   *  stays until answered or walked away from; a timed one fades. */
  #ask(place: WorldEncounter, nodes: () => Node[], seconds = Infinity): void {
    this.#speech.set(place.id, { key: `ask:${place.id}:${++this.#askSerial}`, nodes, until: seconds === Infinity ? Infinity : this.#time + seconds })
    this.refresh()
  }
  #openPlot(plot: WorldPlot): void {
    this.#speak(plot, `${plot.clue} No shrine stands here yet. A builder’s shrine — its own puzzle rooms — can be set on ground like this, and every traveller who walks here will be able to enter it.`)
  }
  /** The chest opens on a small stage — lid, light, and what it held rising
   *  out — the first time; afterwards it shows the settled scene. */
  #openCache(cache: WorldCache, fresh: boolean): void {
    const body = this.dialog(cache.name, cache.subtitle)
    const stage = element('canvas', 'sol-rpg-treasure')
    stage.width = 480; stage.height = 260
    stage.setAttribute('aria-hidden', 'true')
    const list = element('ul', `sol-rpg-items${fresh ? ' is-fresh' : ''}`)
    list.setAttribute('aria-label', 'Inside the chest')
    cache.items.forEach((item, index) => {
      const entry = element('li', 'sol-rpg-item', item.name)
      entry.style.animationDelay = `${0.9 + index * 0.22}s`
      list.append(entry)
    })
    body.append(stage, list, element('p', 'sol-rpg-clue', cache.lore))
    const context = canvasContext(stage)
    if (context) this.#stopReveal = playChestReveal(context, cache.items.map(item => item.kind), fresh)
  }

  private dialog(title: string, subtitle: string): HTMLDivElement {
    const previousFocus = this.#lastFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    this.#stopReveal?.(); this.#stopReveal = null
    this.#dialog?.remove()
    const backdrop = element('div', 'sol-rpg-dialog-backdrop')
    const body = element('div', 'sol-rpg-dialog')
    body.setAttribute('role', 'dialog'); body.setAttribute('aria-modal', 'true'); body.setAttribute('aria-label', title)
    body.tabIndex = -1
    const close = button('×', () => this.closeDialog(), 'sol-rpg-close')
    close.setAttribute('aria-label', 'Close (E)')
    close.title = 'Close (E)'
    body.append(close, element('span', 'sol-rpg-eyebrow', subtitle), element('h2', '', title))
    backdrop.append(body); this.#root?.append(backdrop); this.#dialog = backdrop; this.#lastFocus = previousFocus
    body.addEventListener('keydown', event => {
      // Enter activates the focused choice; keep the shell's movement keys out
      // of the conversation so a selection cannot also move the player. E
      // opened the conversation, so E puts it away again.
      if (event.key === 'Escape' || (event.key.toLowerCase() === 'e' && !event.repeat)) { event.preventDefault(); event.stopPropagation(); this.closeDialog(); return }
      if (event.key === 'Tab') {
        const actions = Array.from(body.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const first = actions[0], last = actions[actions.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === body)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === body)) { event.preventDefault(); first?.focus() }
      }
      event.stopPropagation()
    })
    body.addEventListener('keyup', event => event.stopPropagation())
    body.focus({ preventScroll: true })
    return body
  }
  /** A person speaks beside themselves. A question keeps its choices in the
   *  bubble until it is answered; a wrong answer can be corrected; once it
   *  is answered, the reply and the insight fade in their own time. */
  private openPerson(person: WorldPerson, reply = ''): void {
    const solved = this.model.solved.has(person.id)
    this.#ask(person, () => {
      const nodes: Node[] = [element('p', 'sol-rpg-clue', person.clue)]
      if (reply) nodes.push(element('p', 'sol-rpg-reply', reply))
      if (solved) {
        if (!reply) nodes.push(element('p', 'sol-rpg-reply', person.insight))
        return nodes
      }
      nodes.push(element('h4', '', person.question))
      const choices = element('div', 'sol-rpg-choices')
      person.answers.forEach((answer, index) => choices.append(button(answer, () => {
        const result = this.model.answer(person.id, index)
        this.openPerson(person, result.message)
      })))
      nodes.push(choices)
      return nodes
    }, solved ? 9 : Infinity)
  }
  /** The shrine's sockets sit in a bubble beside it. Placing a piece keeps
   *  the bubble; the last piece opens the way and the bubble says so. */
  private openShrine(shrine: WorldShrine, reply = ''): void {
    this.#ask(shrine, () => [
      element('p', '', 'Fill each marked socket with its matching piece. Every piece stays with you as a permanent ability.'),
      this.#shrinePattern(shrine),
      ...(reply ? [element('p', 'sol-rpg-reply', reply)] : []),
      element('p', 'sol-rpg-pattern-key', 'Lit sockets can be filled. Numbered points surround the heart (H). The way opens when every marked socket is filled.'),
    ])
  }
  #shrinePattern(shrine: WorldShrine): HTMLElement {
    const pattern = element('div', 'sol-rpg-shrine-pattern')
    pattern.setAttribute('role', 'group'); pattern.setAttribute('aria-label', 'Star of David shrine: six triangular points surrounding one central hexagon')
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    outline.setAttribute('viewBox', '0 0 240 240'); outline.setAttribute('aria-hidden', 'true')
    const allPieces: ShrineComponent[] = [...Array.from({ length: 6 }, (_, point) => ({ kind: 'triangle' as const, point })), { kind: 'hexagon' }]
    for (const component of allPieces) {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      polygon.setAttribute('points', shrinePolygon(component).map(point => `${point.x},${point.y}`).join(' '))
      outline.append(polygon)
    }
    pattern.append(outline)
    for (let index = 0; index < shrine.components.length; index++) {
      const piece = shrine.components[index]!
      const filled = this.model.socketFilled(shrine.id, index), owned = this.model.owns(piece)
      const socket = button('', () => {
        const result = this.model.fillSocket(shrine.id, index)
        if (result.ok && this.model.shrineStatus(shrine.id) === 'open') {
          this.#speak(shrine, `${result.message} The way is open: walk in.`)
          return
        }
        this.openShrine(shrine, result.message)
      }, `sol-rpg-socket${filled ? ' is-filled' : owned ? ' is-owned' : ''}`)
      const vertices = shrinePolygon(piece)
      const minX = Math.min(...vertices.map(point => point.x)), maxX = Math.max(...vertices.map(point => point.x))
      const minY = Math.min(...vertices.map(point => point.y)), maxY = Math.max(...vertices.map(point => point.y))
      socket.style.left = `${minX / 240 * 100}%`; socket.style.top = `${minY / 240 * 100}%`
      socket.style.width = `${(maxX - minX) / 240 * 100}%`; socket.style.height = `${(maxY - minY) / 240 * 100}%`
      socket.style.clipPath = `polygon(${vertices.map(point => `${(point.x - minX) / (maxX - minX) * 100}% ${(point.y - minY) / (maxY - minY) * 100}%`).join(',')})`
      const state = filled ? 'Placed · ability retained' : owned ? 'Place piece' : 'Piece not yet found'
      const label = piece.kind === 'triangle' ? String(piece.point + 1) : 'H'
      const glyph = element('span', 'sol-rpg-socket-glyph', filled ? '✓' : label)
      // The centroid keeps the mark inside diagonal triangular points.
      glyph.style.left = `${(vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length - minX) / (maxX - minX) * 100}%`
      glyph.style.top = `${(vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length - minY) / (maxY - minY) * 100}%`
      socket.append(glyph)
      socket.setAttribute('aria-label', `${componentName(piece)}: ${state}`)
      socket.title = `${componentName(piece)} · ${state}`
      socket.disabled = filled || !owned
      pattern.append(socket)
    }
    return pattern
  }
  private openJournal(): void {
    const body = this.dialog('Knowledge journal', 'PIECES REMEMBER WHAT YOU LEARN')
    body.append(element('p', '', 'Shrines recognize your permanent collection. Place each component at an entrance, then use its clue to recognize matching objects within the rooms.'))
    for (const person of WORLD_PEOPLE) if (this.model.met.has(person.id)) {
      body.append(element('h3', '', `${person.name} · ${person.role}`), element('p', '', this.model.solved.has(person.id) ? person.insight : person.clue))
    }
    let known = 0
    for (const [key, lore] of Object.entries(RELIC_LORE)) {
      const requirement: ShrineComponent = key.startsWith('triangle:') ? { kind: 'triangle', point: Number(key.split(':')[1]) } : { kind: key as 'hexagon' | 'star' }
      if (!this.model.owns(requirement)) continue
      known++; body.append(element('h3', '', lore.title), element('p', '', lore.text))
    }
    for (const cache of WORLD_CACHES) if (this.model.opened.has(cache.id)) {
      known++; body.append(element('h3', '', cache.name), element('p', '', cache.lore), element('p', 'sol-rpg-reply', `Found: ${cache.items.map(item => item.name).join(', ')}`))
    }
    if (!known && !this.model.met.size) body.append(element('p', 'sol-rpg-clue', 'Your first page is waiting. Talk to Mira beside the west path.'))
  }
}

const WORLD_STYLE = `
.sol-rpg-world{position:relative;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;align-items:stretch;overflow:hidden;color:#f5edd9;background:radial-gradient(ellipse at 50% 45%,#233938,#111e25 75%);font-family:system-ui,sans-serif;box-sizing:border-box;padding:12px 18px 8px}
.sol-rpg-world [hidden]{display:none!important}.sol-rpg-world *{box-sizing:border-box}.sol-rpg-world button{font:inherit;color:inherit;cursor:pointer}.sol-rpg-world button:focus-visible{outline:3px solid #ffdd83;outline-offset:4px}.sol-rpg-world button:disabled{cursor:default;opacity:.7}
.sol-rpg-world-heading{position:relative;flex-shrink:0;padding-right:170px;margin-bottom:10px}.sol-rpg-eyebrow{display:block;font-size:10px;font-weight:750;letter-spacing:.18em;color:#dfbd7a}.sol-rpg-world h2{margin:4px 0;font-size:clamp(17px,2.4vw,26px);font-weight:650}.sol-rpg-world-heading p{margin:0;font-size:12px;color:#b5c8c2}.sol-rpg-journal{position:absolute;right:0;top:14px;border:1px solid #758574;background:#30433d;border-radius:8px;padding:10px 12px;font-size:11px!important}
.sol-rpg-map{position:relative;flex:1 1 auto;min-height:200px;border:1px solid #adba87;border-radius:14px;background:#1d5274;box-shadow:0 18px 60px #0005;isolation:isolate;overflow:hidden;--sprite-scale:1}
.sol-rpg-canvas{position:absolute;z-index:0;inset:0;width:100%;height:100%;display:block}.sol-rpg-above{z-index:2;pointer-events:none}
.sol-rpg-layer{position:absolute;z-index:1;left:0;top:0;width:0;height:0;will-change:transform}
.sol-rpg-place{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;transform:translate(-50%,-46px) scale(var(--sprite-scale));transform-origin:50% 46px;border:0;background:transparent;padding:0}
.sol-rpg-sprite{display:block;width:48px;height:48px}.sol-rpg-figure{display:block;width:32px;height:48px}
.sol-rpg-place-label{margin-top:1px;white-space:nowrap;background:rgba(14,22,26,.76);border:1px solid rgba(255,240,200,.24);border-radius:999px;padding:2px 9px;color:#fff4d6;font-size:11px;font-weight:600;letter-spacing:.02em;line-height:1.3;box-shadow:0 2px 6px rgba(0,0,0,.35);transition:opacity .25s}
.sol-rpg-place-resident:not([data-near]) .sol-rpg-place-label,.sol-rpg-place-sign:not([data-near]) .sol-rpg-place-label,.sol-rpg-place-cache:not([data-near]) .sol-rpg-place-label{opacity:0}
.sol-rpg-place-shrine[data-state=open] .sol-rpg-place-label{color:#c6ffe0}.sol-rpg-place-plot .sol-rpg-place-label{border-style:dashed;color:#d8e6ee}
.sol-rpg-player{position:absolute;pointer-events:none;width:32px;height:48px;transform:translate(-50%,-46px) scale(var(--sprite-scale));transform-origin:50% 46px}
.sol-rpg-region{position:absolute;z-index:4;left:50%;top:12%;transform:translateX(-50%);pointer-events:none;opacity:0;padding:7px 28px;font-size:clamp(14px,2.2vw,22px);font-weight:600;letter-spacing:.24em;text-transform:uppercase;white-space:nowrap;color:#fff3cf;border-top:1px solid #f1d99a99;border-bottom:1px solid #f1d99a99;background:linear-gradient(90deg,transparent,#0c1a1fcc 18%,#0c1a1fcc 82%,transparent);text-shadow:0 2px 3px #0008}.sol-rpg-region.is-shown{animation:sol-rpg-region 2.8s ease both}@keyframes sol-rpg-region{0%{opacity:0;transform:translate(-50%,-6px)}14%{opacity:1;transform:translate(-50%,0)}78%{opacity:1}100%{opacity:0}}
.sol-rpg-minimap{position:absolute;z-index:4;right:10px;bottom:10px;width:152px;height:114px;border:1px solid #e9d9a488;border-radius:6px;background:#1d5274;opacity:.93;pointer-events:none;box-shadow:0 6px 18px #0006}
.sol-rpg-world-controls{display:flex;flex-shrink:0;justify-content:center;gap:14px;align-items:center;font-size:10px;color:#c5d1c5}.sol-rpg-world-controls button{border:1px solid #61736a;background:#294137;padding:5px 12px;border-radius:5px}
.sol-rpg-dialog-backdrop{position:absolute;inset:0;z-index:10;background:#09171dcc;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}.sol-rpg-dialog{position:relative;max-width:650px;width:100%;max-height:100%;overflow:auto;padding:26px;border-radius:16px;border:1px solid #a9a17e;background:linear-gradient(145deg,#263d39,#172b2e);box-shadow:0 20px 70px #0008;outline:none}.sol-rpg-dialog h2{font-size:24px;padding-right:28px}.sol-rpg-dialog h3{font-size:14px;color:#f2d799;margin:20px 0 8px}.sol-rpg-dialog p{font-size:13px;line-height:1.65;color:#d5e2d9}.sol-rpg-dialog .sol-rpg-close{position:absolute;right:13px;top:12px;width:30px;height:30px;border:1px solid #657b71;background:#314740;border-radius:50%;font-size:21px}.sol-rpg-clue{background:#b6cdac12;border-left:3px solid #b8ca96;border-radius:3px;padding:12px 15px}.sol-rpg-reply{color:#f9dea1!important}.sol-rpg-choices{display:grid;gap:8px}.sol-rpg-choices button,.sol-rpg-primary{padding:11px 14px;border:1px solid #a5b48e;border-radius:7px;background:#3b5745;text-align:left;font-size:13px!important}.sol-rpg-primary{display:block;margin-top:18px;background:#826f38;border-color:#d5b970;color:#fff4d8!important;font-weight:650!important}.sol-rpg-socket{display:flex;flex-direction:column;align-items:center;gap:5px;background:#15272b;border:1px dashed #7b8977;border-radius:9px;padding:10px 6px}.sol-rpg-socket strong{font-size:12px}.sol-rpg-socket small{font-size:10px;color:#b8c7bd}.sol-rpg-socket-glyph{font-size:30px;color:#9eab91}.sol-rpg-socket.is-owned{border:1px solid #d8b769;background:#564d30}.sol-rpg-socket.is-owned .sol-rpg-socket-glyph{color:#ffe19a}.sol-rpg-socket.is-filled{border:1px solid #86ba9b;background:#294c3a;opacity:1!important}.sol-rpg-socket.is-filled .sol-rpg-socket-glyph{color:#bbf7ce}
@media(max-width:600px){.sol-rpg-world{padding:10px 8px 6px}.sol-rpg-world-heading{padding-right:0;margin-bottom:8px}.sol-rpg-world-heading p{max-width:62%;font-size:10px}.sol-rpg-journal{top:18px;padding:7px;font-size:10px!important}.sol-rpg-map{border-radius:10px}.sol-rpg-minimap{width:96px;height:72px;right:6px;bottom:6px}.sol-rpg-place-label{max-width:84px;white-space:normal;text-align:center}.sol-rpg-world-prompt{font-size:10px}.sol-rpg-dialog{padding:20px}.sol-rpg-dialog-backdrop{padding:10px}.sol-rpg-dialog p{font-size:12px}.sol-rpg-socket strong{font-size:10px}.sol-rpg-socket small{font-size:9px}}
.sol-rpg-shrine-pattern{position:relative;display:block;width:min(100%,280px);aspect-ratio:1;margin:12px auto 0;background:radial-gradient(circle,#8097731c,transparent 68%)}.sol-rpg-shrine-pattern svg{position:absolute;inset:0;width:100%;height:100%;fill:#172d30;stroke:#718571;stroke-width:2;stroke-linejoin:round}.sol-rpg-shrine-pattern .sol-rpg-socket{position:absolute;display:block;padding:0;border:0;border-radius:0;background:#5a6559;opacity:1}.sol-rpg-shrine-pattern .sol-rpg-socket.is-owned{background:#be9f50}.sol-rpg-shrine-pattern .sol-rpg-socket.is-filled{background:#68a787}.sol-rpg-shrine-pattern .sol-rpg-socket:not(:disabled):hover,.sol-rpg-shrine-pattern .sol-rpg-socket:focus-visible{background:#efd087;filter:brightness(1.25);outline:none}.sol-rpg-shrine-pattern .sol-rpg-socket-glyph{position:absolute;transform:translate(-50%,-50%);color:#fff9e5!important;font-size:18px;font-weight:750;text-shadow:0 1px 2px #0005}.sol-rpg-pattern-key{text-align:center;font-size:11px!important;color:#b6c6b7!important;margin:0 0 12px}.sol-rpg-shrine-information{margin:22px 0 0;border-top:1px solid #69816b55;padding-top:3px}.sol-rpg-shrine-information dt{font-size:12px;font-weight:650;color:#f2d799;margin-top:15px}.sol-rpg-shrine-information dd{font-size:12px;line-height:1.6;margin:4px 0 0;color:#c3d4c8}
.sol-rpg-world .sol-rpg-world-prompt{flex-shrink:0;max-width:100%;min-height:30px;border:0;background:transparent;padding:8px 6px 3px;line-height:1.5;font-size:12px;text-align:center;color:#f0dbb4}.sol-rpg-world .sol-rpg-world-prompt:disabled{opacity:1;cursor:default}.sol-rpg-world-prompt:not(:disabled):hover{color:#fff0ba;text-decoration:underline}
.sol-rpg-speech{position:absolute;z-index:3;left:0;top:0;width:0;height:0;pointer-events:none;will-change:transform}.sol-rpg-bubble{position:absolute;width:max-content;max-width:230px;padding:7px 11px;border:2px solid #1c1230;border-radius:12px;background:rgba(255,249,234,.97);color:#2a2118;font-size:12px;line-height:1.4;font-weight:500;box-shadow:0 6px 16px rgba(0,0,0,.35);transform:translate(-50%,calc(-100% - 54px * var(--sprite-scale)));opacity:0;transition:opacity .25s}.sol-rpg-bubble.is-shown{opacity:1}.sol-rpg-bubble::after{content:'';position:absolute;left:50%;bottom:-7px;width:11px;height:11px;background:inherit;border-right:2px solid #1c1230;border-bottom:2px solid #1c1230;transform:translateX(-50%) rotate(45deg)}.sol-rpg-bubble-sign{background:rgba(240,224,186,.97);font-family:Georgia,serif;font-size:12.5px}
.sol-rpg-bubble.is-below{transform:translate(-50%,calc(16px * var(--sprite-scale)))}.sol-rpg-bubble.is-below::after{bottom:auto;top:-7px;border:0;border-left:2px solid #1c1230;border-top:2px solid #1c1230}
.sol-rpg-bubble.is-live{pointer-events:auto;max-width:290px;text-align:left}.sol-rpg-bubble p{margin:0 0 6px;font-size:12px;line-height:1.45}.sol-rpg-bubble p:last-child{margin-bottom:0}.sol-rpg-bubble .sol-rpg-clue{background:transparent;border-left:0;border-radius:0;padding:0}.sol-rpg-bubble h4{margin:6px 0 5px;font-size:12px;color:#3a2a10}.sol-rpg-bubble .sol-rpg-choices{display:grid;gap:5px;margin-bottom:2px}.sol-rpg-bubble .sol-rpg-choices button{padding:6px 9px;border:1px solid #8a7550;border-radius:7px;background:#fff6e0;color:#2a2118;text-align:left;font-size:11.5px;cursor:pointer}.sol-rpg-bubble .sol-rpg-choices button:hover,.sol-rpg-bubble .sol-rpg-choices button:focus-visible{background:#ffe9b8;outline:none}.sol-rpg-bubble .sol-rpg-reply{color:#7a4b0b!important;font-weight:600}.sol-rpg-bubble .sol-rpg-shrine-pattern{width:160px;margin:4px auto 2px}.sol-rpg-bubble .sol-rpg-shrine-pattern .sol-rpg-socket-glyph{font-size:14px}.sol-rpg-bubble .sol-rpg-pattern-key{font-size:10px!important;color:#5a4a30!important;margin:4px 0 0;text-align:left}
.sol-rpg-treasure{display:block;width:100%;max-width:440px;aspect-ratio:240/130;margin:6px auto 2px;border-radius:12px;background:radial-gradient(ellipse at 50% 78%,#3d311d,#16130f 72%)}.sol-rpg-items{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:10px 0 4px;padding:0}.sol-rpg-item{padding:4px 11px;border-radius:999px;background:rgba(255,220,140,.12);border:1px solid rgba(255,220,140,.4);color:#ffe8b0;font-size:12px;font-weight:600}.sol-rpg-items.is-fresh .sol-rpg-item{animation:sol-rpg-item .45s ease both}@keyframes sol-rpg-item{from{opacity:0;transform:translateY(8px) scale(.9)}to{opacity:1;transform:none}}
`

// Side-view caverns: long caves walked, jumped and fought through, seen from
// the side, with a camera that follows Dana along them. A cavern is drawn the
// way a labyrinth room is — two ASCII layers laid cell for cell, terrain and
// what it hides — at any size: long and low running on, or tall and narrow
// going down. Its mouth is the way back up and where a traveller comes in;
// its way deeper is an entrance a story may seat a place behind, and waits
// for the cavern's key. Like every place, ANY of its squares can be made to
// lead elsewhere (jwize, 2026-09-22). Pure: no DOM.
//
//   art   — the `fromAscii` legend (levels.ts), plus
//             < the mouth   > the way deeper   : an empty square hiding a
//             make-then-break find
//   finds — a pickup over a brick is buried in it; over `.` it is a wand
//           secret; over `:` the first cast walls it in and breaking pays.

import { BRICK, Engine, LIFE_FULL, TILE, WALL, type Cell, type CombatSkillId, type EngineSnapshot, type LevelDef, type SpellKind, type WeaponKind } from './engine.js'
import { fromAscii } from './levels.js'
import { SquarePasses } from './labyrinth.js'

export interface SideCavernDefinition {
  /** The place id — /^[a-z0-9-]{1,64}$/. */
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly level: LevelDef
  /** The way back up, and where a traveller comes in from above. */
  readonly mouth: Cell
  /** The way deeper; a story may seat a place behind it. */
  readonly deeper: Cell | null
  /** The way deeper waits for the cavern's key. */
  readonly keyed: boolean
}

interface CavernPlan {
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly theme: string
  /** Starting sand, in full meters — a long cavern gives more. */
  readonly meters: number
  readonly art: readonly string[]
  readonly finds: readonly string[]
}

function drawCavern(plan: CavernPlan): SideCavernDefinition {
  const cols = plan.art[0]?.length ?? 0
  if (!cols || plan.art.some(line => line.length !== cols)) throw new Error(`${plan.id} is not drawn square`)
  let mouth: Cell | null = null, deeper: Cell | null = null
  const deep = new Set<number>()
  const terrain = plan.art.map((line, row) => [...line].map((mark, col) => {
    if (mark === '<') { mouth = { col, row }; return '.' }
    if (mark === '>') { deeper = { col, row }; return '.' }
    if (mark === ':') { deep.add(row * cols + col); return '.' }
    return mark
  }).join(''))
  if (!mouth) throw new Error(`${plan.id} has no mouth`)
  const level = fromAscii(plan.name, terrain)
  for (const find of fromAscii(plan.name, [...plan.finds]).items) {
    const at = find.row * cols + find.col
    if (level.tiles[at] === WALL) throw new Error(`${plan.id} buries a ${find.kind} in stone at ${find.col},${find.row}`)
    if (level.tiles[at] === BRICK) level.items.push({ ...find, hidden: true })
    else level.items.push({ ...find, hidden: true, secret: true, ...(deep.has(at) ? { deep: true } : {}) })
  }
  const found = { mouth: mouth as Cell, deeper: deeper as Cell | null }
  return {
    id: plan.id, name: plan.name, subtitle: plan.subtitle,
    level: { ...level, door: { ...(found.deeper ?? found.mouth) }, lifeStart: LIFE_FULL * plan.meters, theme: plan.theme, interconnected: true, pits: true },
    mouth: found.mouth, deeper: found.deeper, keyed: level.items.some(item => item.kind === 'key'),
  }
}

/** The caverns, in the order the Greenwood reaches them. */
const PLANS: readonly CavernPlan[] = [
  // Behind the cave under the Mossback's roots: a long run east. A goblin
  // charges at the mouth; a bottomless gap swallows the one that charges
  // across it; a ghost hunts the brick-roofed tunnel, whose roof hides what a
  // head-butt shakes loose; a turret sweeps the climb to the key; a last gap
  // and a last goblin guard the way deeper.
  {
    id: 'root-run', name: 'The Root Run', subtitle: 'A long cave running east under the Mossback', theme: 'verdant', meters: 2,
    art: [
      '################################################',
      '#####....####........##########....:...........#',
      '#####....####........##########......K.........#',
      '#####................##########....BBBB........#',
      '#................B...##########................#',
      '#....................##########...B............#',
      '#....................##########...............n#',
      '#....BBB.............##########..B.............#',
      '#....................BBBBBBBBBB................#',
      '#...............................B..............#',
      '#<P.......g.B..........h...................Bg.>#',
      '#############...#########################..#####',
    ],
    finds: [
      '................................................',
      '...................................J............',
      '................................................',
      '................................................',
      '.................u..............................',
      '........................................j.......',
      '................................................',
      '......b.........................................',
      '........................J..t....................',
      '................................b...............',
      '............f..............................j....',
      '................................................',
    ],
  },
  // Under the burrow by the western trees: a shaft going straight down,
  // tier after tier — a goblin on a shelf, a sparkball loose in the middle,
  // a gargoil walking over the drop, and the key buried in the bottom's
  // stone beside the way deeper.
  {
    id: 'the-burrow', name: 'The Burrow', subtitle: 'A shaft going straight down under the western trees', theme: 'abyss', meters: 2,
    art: [
      '################',
      '#..............#',
      '#..............#',
      '#<P......g.....#',
      '###########....#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#........BBB...#',
      '#..............#',
      '#..............#',
      '#....h.........#',
      '#BBB############',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#....B..g...g..#',
      '##########BBB###',
      '#..............#',
      '#..............#',
      '#..............#',
      '#.BBB..........#',
      '#..............#',
      '#..............#',
      '#...r..........#',
      '###########B####',
      '#..............#',
      '#..............#',
      '#......:.......#',
      '#..............#',
      '#..............#',
      '#...g........>.#',
      '################',
    ],
    finds: [
      '................',
      '.............j..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '..........J.....',
      '................',
      '................',
      '................',
      '..f.............',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....J..........',
      '..........Ku....',
      '................',
      '................',
      '................',
      '...b............',
      '................',
      '................',
      '................',
      '...........t....',
      '................',
      '................',
      '.......J........',
      '................',
      '................',
      '................',
      '................',
    ],
  },
]

export const SIDE_CAVERNS: readonly SideCavernDefinition[] = PLANS.map(drawCavern)

// ── a walk through one ───────────────────────────────────────────────────

/** What a step through a cavern came to: up out of its mouth, down through a
 *  way that leads on, or a way deeper that is still shut. */
export type CavernStep =
  | { readonly kind: 'up' }
  | { readonly kind: 'down'; readonly entrance: string }
  | { readonly kind: 'locked' }
  | null

/** The skills a traveller carries into a cavern from the labyrinths. */
export interface CavernKit { readonly kit: readonly CombatSkillId[]; readonly weapon: WeaponKind | null; readonly spell: SpellKind | null }

function copyLevel(level: LevelDef): LevelDef {
  return { ...level, tiles: [...level.tiles], player: { ...level.player }, door: { ...level.door }, enemies: level.enemies.map(e => ({ ...e })), items: level.items.map(i => ({ ...i })), mirrors: level.mirrors.map(m => ({ ...m })) }
}

export class SideCavernRun {
  readonly definition: SideCavernDefinition
  engine: Engine
  readonly #ways = new SquarePasses()
  #lockedSaid = false

  constructor(definition: SideCavernDefinition) {
    this.definition = definition
    this.engine = new Engine(copyLevel(definition.level))
    this.begin()
  }

  /** Coming down into the cavern: the cavern fresh, Dana beside its mouth. */
  begin(kit?: CavernKit): void {
    const engine = new Engine(copyLevel(this.definition.level))
    if (kit) { Object.assign(engine, { kit: [...kit.kit], weapon: kit.weapon, spell: kit.spell }); engine.applyBarriers() }
    this.engine = engine
    this.#ways.reset()
    this.#lockedSaid = false
  }

  /** Back up out of a place below: the cavern as it was, and the way just
   *  used waits until Dana steps away from it. */
  returnFrom(entrance: string): void {
    const square = /^cell-([0-9]{2})-([0-9]{2})$/.exec(entrance)
    const cell = entrance === 'mouth' ? this.definition.mouth : entrance === 'deeper' ? this.definition.deeper
      : square ? { col: Number(square[1]), row: Number(square[2]) } : null
    if (cell) this.#ways.hold(entrance, cell)
  }

  get holdsKey(): boolean { return !this.definition.keyed || this.engine.doorOpen }

  /** One fixed step. \`seated\` maps each square a story made lead elsewhere
   *  to its cell. */
  step(dt: number, seated: ReadonlyMap<string, Cell> = new Map()): CavernStep {
    const engine = this.engine
    engine.update(dt)
    if (engine.state !== 'playing') return null
    const ways = new Map<string, Cell>([['mouth', this.definition.mouth]])
    const deeper = this.definition.deeper
    if (deeper && this.holdsKey) ways.set('deeper', deeper)
    for (const [id, cell] of seated) ways.set(id, cell)
    const way = this.#ways.step(engine, ways, dt)
    if (way === 'mouth') return { kind: 'up' }
    if (way) return { kind: 'down', entrance: way }
    const atShutWay = !!deeper && !this.holdsKey && engine.rectOverlapsCell(engine.player, deeper.col, deeper.row)
    if (atShutWay && !this.#lockedSaid) { this.#lockedSaid = true; return { kind: 'locked' } }
    if (!atShutWay) this.#lockedSaid = false
    return null
  }

  /** After every life is spent: start again from the mouth, the cavern fresh. */
  retry(): void {
    this.engine.lives = 3
    this.engine.spawn()
    this.#ways.reset()
  }

  exportState(): EngineSnapshot { return this.engine.exportState() }

  restoreState(raw: unknown): void {
    const engine = new Engine(copyLevel(this.definition.level))
    if (engine.restoreState(raw)) { this.engine = engine; this.#ways.reset() }
  }

  /** The whole cavern as a small picture: stone, brick, air, and its ways. */
  seed(largest = 48): { readonly cols: number; readonly rows: number; readonly rgb: Uint8ClampedArray } {
    const { cols: levelCols, rows: levelRows } = this.engine
    const step = Math.max(1, Math.ceil(Math.max(levelCols, levelRows) / largest))
    const cols = Math.ceil(levelCols / step), rows = Math.ceil(levelRows / step)
    const rgb = new Uint8ClampedArray(cols * rows * 3)
    const ways = [this.definition.mouth, ...(this.definition.deeper ? [this.definition.deeper] : [])]
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const c = col * step + (step >> 1), r = row * step + (step >> 1)
      const tile = this.engine.tileAt(c, r)
      const colour = ways.some(way => Math.abs(way.col - c) < step && Math.abs(way.row - r) < step) ? CAVERN_WAY
        : tile === WALL ? CAVERN_STONE : tile === BRICK ? CAVERN_BRICK : CAVERN_AIR
      const at = (row * cols + col) * 3
      rgb[at] = colour[0]; rgb[at + 1] = colour[1]; rgb[at + 2] = colour[2]
    }
    return { cols, rows, rgb }
  }

  /** Where Dana stands, as fractions of the whole cavern. */
  get at(): { readonly x: number; readonly y: number } {
    const p = this.engine.player
    return { x: (p.x + p.w / 2) / (this.engine.cols * TILE), y: (p.y + p.h / 2) / (this.engine.rows * TILE) }
  }
}

const CAVERN_STONE = [88, 72, 60] as const
const CAVERN_BRICK = [196, 118, 44] as const
const CAVERN_AIR = [22, 18, 28] as const
const CAVERN_WAY = [120, 190, 230] as const

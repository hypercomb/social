// diamondcoreprocessor.com/games/bubble/levels.ts
//
// Built-in single-screen rooms, authored as readable ASCII. Bubble Bobble is one
// enclosed screen per round — a solid floor and floating one-way ledges for the
// bubbles to carry foes up to. The side walls + ceiling are the screen edges
// themselves (the engine bounds the box; no border tiles needed).
//
// WORLDS: the rounds run in themed sets of three. `theme` indexes the renderer's
// THEMES table (see renderer.ts) — a whole world, not just a recolour: brick
// palette AND brick masonry style AND the backdrop motif. Rounds 1-3 Insect Cave,
// 4-6 Ember Forge, 7-9 Crystal Grotto, 10-12 Moss Thicket, 13-15 Coral Reef.
//
// LAYOUT RULE: the grid is the ARCADE-FINE 15px brick (40×26 — Bub spans ~1.5
// tiles, platforms are ONE tile thin). Ledge tiers sit on a 4-ROW RHYTHM
// (floor 25 → rows 21 → 17 → 13 → 9), which is the arcade's ~4-blocks-between-
// ledges spacing at our scale. That number is NOT free: Bub's jump apex is ~69px
// (see engine.ts JUMP_V) and a 4-row gap is 60px, so he *just* clears one tier —
// widen the rhythm and you force the jump up with it, which is precisely how it
// once drifted to a floaty 6-row/7.5-tile leap. Rows 0–8 stay open as sky: the
// Monstas cruise there and the bubbles gather under the ceiling. Leave the outer
// columns clear so foam can rise up the flanks. A foe or '*' on row r sits on
// the platform at row r+1. Rows are padded to `cols` (the 40-wide floor sets the
// width), so trailing dots may be omitted.
//
// Levels are static built-ins; custom levels live in localStorage, the same
// participant-local class as Solomon's — never in the layer (that would skew
// the lineage signature across peers).

import { EMPTY, WALL, ENEMY_KIND_COUNT, type LevelDef, type Cell, type EnemySpawn } from './engine.js'

// ASCII legend:
//   '#' WALL (one-way platform)   '.'/' ' EMPTY   'P' player spawn
//   '*' a diamond (static treasure — sits on the platform below it, like a foe)
//   'e'/'E' an assorted foe facing right / left — cycles through every species
//   explicit species (lower = faces right, upper = faces left):
//     'z'/'Z' zen-chan   'm'/'M' mighta   'b'/'B' banebou   'o'/'O' monsta
const CHAR_TILE: Record<string, number> = { '#': WALL }

/** Parse an ASCII level. Entity glyphs leave their cell EMPTY and record a
 *  placement. Rows are padded / truncated to `cols` so authoring is forgiving. */
export function fromAscii(name: string, art: string[], theme = 0, bonus = false): LevelDef {
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  const tiles = new Array<number>(rows * cols).fill(EMPTY)
  let player: Cell = { col: 1, row: rows - 2 }
  const enemies: EnemySpawn[] = []
  const diamonds: Cell[] = []
  let kind = 0

  for (let r = 0; r < rows; r++) {
    const line = art[r]
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.'
      const i = r * cols + c
      switch (ch) {
        case 'P': player = { col: c, row: r }; break
        case '*': diamonds.push({ col: c, row: r }); break
        // e/E: an assorted foe, cycling through every species in turn.
        case 'e': enemies.push({ col: c, row: r, dir: 1,  kind: kind++ % ENEMY_KIND_COUNT }); break
        case 'E': enemies.push({ col: c, row: r, dir: -1, kind: kind++ % ENEMY_KIND_COUNT }); break
        // explicit species (lower = faces right, upper = faces left):
        case 'z': enemies.push({ col: c, row: r, dir: 1,  kind: 0 }); break   // zen-chan
        case 'Z': enemies.push({ col: c, row: r, dir: -1, kind: 0 }); break
        case 'm': enemies.push({ col: c, row: r, dir: 1,  kind: 1 }); break   // mighta
        case 'M': enemies.push({ col: c, row: r, dir: -1, kind: 1 }); break
        case 'b': enemies.push({ col: c, row: r, dir: 1,  kind: 2 }); break   // banebou
        case 'B': enemies.push({ col: c, row: r, dir: -1, kind: 2 }); break
        case 'o': enemies.push({ col: c, row: r, dir: 1,  kind: 3 }); break   // monsta
        case 'O': enemies.push({ col: c, row: r, dir: -1, kind: 3 }); break
        default: tiles[i] = CHAR_TILE[ch] ?? EMPTY
      }
    }
  }
  return { name, cols, rows, tiles, player, enemies, theme, diamonds, bonus }
}

export const BUILTIN_LEVELS: LevelDef[] = [
  // ═══ World 1 — Insect Cave · teal stone under a cold starfield ═══
  // Round 1 — the classic cave: three thin ledge segments on every tier, open
  // flanks for the bubbles. Start bottom-left.
  fromAscii('Insect Cave', [
    '', '', '', '', '', '', '', '',
    '....z..........................Z',
    '....########....########....########',
    '', '',
    '..........z..................Z',
    '....########....########....########',
    '', '',
    '..................z',
    '....########....########....########',
    '', '', '',
    '....########....########....########',
    '', '',
    '.P',
    '########################################',
  ], 0),
  // Round 2 — a zig-zag staircase: each tier is one long span, alternating
  // sides, so you climb by crossing the room.
  fromAscii('Stepping Stones', [
    '', '', '', '', '', '', '', '',
    '............................b......Z',
    '....................####################',
    '', '',
    '........z',
    '####################',
    '', '',
    '............................m',
    '....................####################',
    '', '',
    '..........z',
    '######################',
    '', '',
    '.P',
    '########################################',
  ], 0),
  // Round 3 — open air with Monstas cruising the sky; twin ledges each tier.
  fromAscii('Cross Winds', [
    '', '', '', '',
    '.....o..............................O',
    '', '', '',
    '.......z........................Z',
    '......##########........##########',
    '', '',
    '..................z.Z',
    '..............############',
    '', '', '',
    '......##########........##########',
    '', '', '',
    '..............############',
    '', '',
    '.P',
    '########################################',
  ], 0),

  // ═══ World 2 — Ember Forge · amber stone, embers rising off the floor ═══
  // Round 4 — the forge floor: broad hearth slabs with a work shelf between.
  fromAscii('Ember Forge', [
    '', '', '', '', '', '', '', '',
    '....m..........................M',
    '....##########............##########',
    '', '',
    '.................b.b',
    '..............############',
    '', '',
    '....z............................Z',
    '..######........########........######',
    '', '', '',
    '......################......',
    '', '',
    '.P',
    '########################################',
  ], 1),
  // Round 5 — twin towers with a centre pad between them: hop tower → pad →
  // tower, weaving up the middle.
  fromAscii('Twin Towers', [
    '', '', '', '', '', '', '', '',
    '....z..............................Z',
    '...#######....................#######',
    '', '',
    '..................b.b',
    '.................######',
    '', '',
    '',
    '...#######....................#######',
    '', '',
    '.....m..............................M',
    '...#######....................#######',
    '', '',
    '.P',
    '########################################',
  ], 1),
  // Round 6 — rows of stubby anvil blocks; Mightas hurl boulders down the lanes.
  fromAscii('Anvil Rows', [
    '', '', '', '', '', '', '', '',
    '......e.........e..........e',
    '.....####.......####.......####',
    '', '',
    '..............M............m',
    '..######......######......######',
    '', '',
    '....b.................B',
    '...#####....#####....#####....#####',
    '', '', '',
    '..######......######......######',
    '', '',
    '.P',
    '########################################',
  ], 1),

  // ═══ World 3 — Crystal Grotto · violet facets, drifting motes ═══
  // Round 7 — staggered crystal shelves splayed off both walls.
  fromAscii('Crystal Grotto', [
    '', '', '', '', '', '', '', '',
    '.......z................Z',
    '......########....########',
    '', '',
    '..............o.....O',
    '..........############',
    '', '',
    '.....b..................B',
    '....######............######',
    '', '', '',
    '..........#######',
    '', '',
    '.P',
    '########################################',
  ], 2),
  // Round 8 — one long prism staircase climbing right, tier by tier.
  fromAscii('Prism Steps', [
    '', '', '', '', '', '', '', '',
    '...........................b',
    '........................########',
    '', '',
    '............z.......O',
    '............########',
    '', '',
    '..m',
    '..########',
    '', '', '',
    '.............####',
    '', '',
    '.P.....................Z',
    '########################################',
  ], 2),
  // Round 9 — a central spire: wide base shelves narrowing to a top perch.
  fromAscii('Shard Spire', [
    '', '', '', '', '', '', '', '',
    '..................z',
    '................########',
    '', '',
    '..........m......M',
    '........############',
    '', '',
    '....b................B',
    '..########......########',
    '', '', '',
    '.............####',
    '', '',
    '.P',
    '########################################',
  ], 2),

  // ═══ World 4 — Moss Thicket · mossy stone, drifting spores ═══
  // Round 10 — a mossy hollow: a wide middle bough over splayed side ledges.
  fromAscii('Moss Thicket', [
    '', '', '', '', '', '', '', '',
    '.....z..........................Z',
    '...########..............########',
    '', '',
    '...............b.b',
    '............############',
    '', '',
    '.....m....................M',
    '..######..............######',
    '', '', '',
    '................######',
    '', '',
    '.P',
    '########################################',
  ], 3),
  // Round 11 — interlocking roots: short spans woven across every tier.
  fromAscii('Root Tangle', [
    '', '', '', '', '', '', '', '',
    '..z.........m.........Z',
    '..####.....#####.....####',
    '', '',
    '.............b',
    '..........########',
    '', '',
    '...............o',
    '.......##########',
    '', '', '',
    '..####..........####',
    '', '',
    '.P..................B',
    '########################################',
  ], 3),
  // Round 12 — the canopy: one long high walkway over an open drop.
  fromAscii('Canopy Walk', [
    '', '', '', '', '', '', '', '',
    '....z......................Z',
    '..################################',
    '', '',
    '.........b..........B',
    '.......##############',
    '', '',
    '....m.....................M',
    '....######............######',
    '', '', '',
    '..............####',
    '', '',
    '.P',
    '########################################',
  ], 3),

  // ═══ World 5 — Coral Reef · coral blocks, bubbles rising through the water ═══
  // Round 13 — a reef shelf: three coral banks per tier, Monstas in the current.
  fromAscii('Coral Reef', [
    '', '', '', '', '', '', '', '',
    '....z.........m.........Z',
    '....######....######....######',
    '', '',
    '.......o..........O',
    '..#########....#########',
    '', '',
    '.....b.................B',
    '....########....########....####',
    '', '', '',
    '..........#####',
    '', '',
    '.P',
    '########################################',
  ], 4),
  // Round 14 — tide pools: broad basins with narrow rims to climb.
  fromAscii('Tide Pools', [
    '', '', '', '', '', '', '', '',
    '.........z..........Z',
    '.......#########....#########',
    '', '',
    '....b..................B',
    '....######..........######',
    '', '',
    '............o',
    '..####................####',
    '', '', '',
    '.........##########',
    '', '',
    '.P.......................M',
    '########################################',
  ], 4),
  // Round 15 — the finale: the full mixed cast on a layered arena.
  fromAscii('Monster Hall', [
    '', '', '', '', '', '', '', '',
    '..e........E.........e.........E',
    '.########..########..########..########',
    '', '',
    '.....o..............................O',
    '............################',
    '', '',
    '....b.........................B',
    '..######......######......######',
    '', '',
    '..................z.Z',
    '..............############',
    '', '',
    '.P',
    '########################################',
  ], 4),
]

/** The DIAMOND ROOM — the arcade's secret bonus screen, dropped between rounds
 *  (see BONUS_EVERY in overlay.ts). No foes: five tiers of treasure and a short
 *  clock. Sweep every last diamond before it runs out for the all-clear. It is
 *  deliberately NOT in BUILTIN_LEVELS — it isn't a round you can select, it's
 *  something that happens to you. */
export const DIAMOND_ROOM: LevelDef = fromAscii('Diamond Room', [
  '', '', '', '', '', '', '', '',
  '.....*...*...*...*...*...*...*...*',
  '....################################',
  '', '',
  '.....*...*...*...*...*...*...*...*',
  '....################################',
  '', '',
  '.....*...*...*...*...*...*...*...*',
  '....################################',
  '', '',
  '.....*...*...*...*...*...*...*...*',
  '....################################',
  '', '',
  '.P...*...*...*...*...*...*...*...*',
  '########################################',
], 2, true)

export function cloneLevel(l: LevelDef): LevelDef {
  return {
    name: l.name, cols: l.cols, rows: l.rows,
    tiles: l.tiles.slice(),
    player: { ...l.player },
    enemies: l.enemies.map(e => ({ ...e })),
    theme: l.theme,
    diamonds: l.diamonds?.map(d => ({ ...d })),
    bonus: l.bonus,
  }
}

// ── custom level store (localStorage) ────────────────────────
//
// Designer-made levels live in localStorage — participant-local UI data, the
// same class as screensaver prefs, NOT layer state (a level in the layer would
// skew the lineage signature across peers).

const STORE_KEY = 'hc:bubble-levels'

// Untrusted level data (Import JSON + this localStorage store) is the only attack
// surface these games expose. Bound the dimensions + entity counts and require
// in-bounds integer coordinates so a crafted level can't exhaust memory (a giant
// grid / canvas) or stall the render loop. Single-screen levels are tiny — the
// designer authors 40×26 — so these caps are generous headroom.
const MAX_DIM = 120
const MAX_ENTITIES = MAX_DIM * MAX_DIM

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** A finite, in-bounds {col,row} or null. */
function asCell(v: unknown, cols: number, rows: number): Cell | null {
  if (!v || typeof v !== 'object') return null
  const { col, row } = v as Record<string, unknown>
  if (!isInt(col) || !isInt(row) || col < 0 || col >= cols || row < 0 || row >= rows) return null
  return { col, row }
}

/** Validate untrusted level JSON into a CLEAN LevelDef, or null if anything is
 *  out of bounds. Used by both the importer and the localStorage loader so a
 *  tampered store entry is held to the same limits as a pasted one. */
export function sanitizeLevel(raw: unknown): LevelDef | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const cols = d['cols'], rows = d['rows']
  if (!isInt(cols) || !isInt(rows) || cols < 1 || rows < 1 || cols > MAX_DIM || rows > MAX_DIM) return null
  const n = cols * rows
  const tilesRaw = d['tiles']
  if (!Array.isArray(tilesRaw) || tilesRaw.length !== n) return null

  const player = asCell(d['player'], cols, rows)
  if (!player) return null

  const enemiesRaw = Array.isArray(d['enemies']) ? d['enemies'] : []
  if (enemiesRaw.length > MAX_ENTITIES) return null
  const enemies: EnemySpawn[] = []
  for (const e of enemiesRaw) {
    const c = asCell(e, cols, rows); if (!c) return null
    const es = e as EnemySpawn
    const kind = isInt(es?.kind) ? ((es.kind % ENEMY_KIND_COUNT) + ENEMY_KIND_COUNT) % ENEMY_KIND_COUNT : 0
    enemies.push({ col: c.col, row: c.row, dir: es?.dir === -1 ? -1 : 1, kind })
  }

  const diamondsRaw = Array.isArray(d['diamonds']) ? d['diamonds'] : []
  if (diamondsRaw.length > MAX_ENTITIES) return null
  const diamonds: Cell[] = []
  for (const g of diamondsRaw) {
    const c = asCell(g, cols, rows); if (!c) return null
    diamonds.push(c)
  }

  // Only WALL survives — an unrecognised code collapses to EMPTY so a tampered
  // store can't smuggle in odd geometry.
  const tiles = new Array<number>(n)
  for (let i = 0; i < n; i++) { const t = Number(tilesRaw[i]); tiles[i] = t === WALL ? WALL : EMPTY }

  return {
    name: typeof d['name'] === 'string' ? d['name'].slice(0, 80) : 'Imported',
    cols, rows, tiles, player, enemies, diamonds,
    // themeFor() wraps the index, so any non-negative integer is safe here.
    theme: isInt(d['theme']) && d['theme'] >= 0 ? d['theme'] : 0,
    bonus: d['bonus'] === true,
  }
}

export function loadCustomLevels(): LevelDef[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(sanitizeLevel).filter((l): l is LevelDef => l !== null)
  } catch { return [] }
}

export function saveCustomLevels(levels: LevelDef[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(levels)) } catch { /* quota / disabled */ }
}

/** Insert or replace a custom level by name. Returns the new list. */
export function upsertCustomLevel(level: LevelDef): LevelDef[] {
  const levels = loadCustomLevels()
  const i = levels.findIndex(l => l.name === level.name)
  if (i >= 0) levels[i] = level
  else levels.push(level)
  saveCustomLevels(levels)
  return levels
}

export function deleteCustomLevel(name: string): LevelDef[] {
  const levels = loadCustomLevels().filter(l => l.name !== name)
  saveCustomLevels(levels)
  return levels
}

/** A blank canvas for the designer — an enclosed screen with just a full-width
 *  floor and a player spawn (the side walls + ceiling are the screen edges). */
export function emptyLevel(name: string, cols = 40, rows = 26): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  for (let c = 0; c < cols; c++) tiles[(rows - 1) * cols + c] = WALL
  return {
    name, cols, rows, tiles,
    player: { col: 1, row: rows - 2 },
    enemies: [],
    diamonds: [],
    theme: 0,
  }
}

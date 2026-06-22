// diamondcoreprocessor.com/games/bubble/levels.ts
//
// Built-in single-screen rooms, authored as readable ASCII. Bubble Bobble is one
// enclosed screen per round — a solid floor and a few floating one-way ledges for
// the bubbles to carry foes up to. The side walls + ceiling are the screen edges
// themselves (the engine bounds the box; no border tiles needed). Levels are
// static built-ins; should custom levels arrive they'd live in localStorage, the
// same participant-local class as Solomon's — never in the layer (that would skew
// the lineage signature across peers).

import { EMPTY, WALL, ENEMY_KIND_COUNT, type LevelDef, type Cell, type EnemySpawn } from './engine.js'

// ASCII legend:
//   '#' WALL (one-way platform)   '.'/' ' EMPTY   'P' player spawn
//   'e'/'E' an assorted foe facing right / left — cycles through every species
//   explicit species (lower = faces right, upper = faces left):
//     'z'/'Z' zen-chan   'm'/'M' mighta   'b'/'B' banebou   'o'/'O' monsta
const CHAR_TILE: Record<string, number> = { '#': WALL }

/** Parse an ASCII level. Entity glyphs leave their cell EMPTY and record a
 *  placement. Rows are padded / truncated to `cols` so authoring is forgiving. */
export function fromAscii(name: string, art: string[]): LevelDef {
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  const tiles = new Array<number>(rows * cols).fill(EMPTY)
  let player: Cell = { col: 1, row: rows - 2 }
  const enemies: EnemySpawn[] = []
  let kind = 0

  for (let r = 0; r < rows; r++) {
    const line = art[r]
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.'
      const i = r * cols + c
      switch (ch) {
        case 'P': player = { col: c, row: r }; break
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
  return { name, cols, rows, tiles, player, enemies }
}

export const BUILTIN_LEVELS: LevelDef[] = [
  // Round 1 — the classic symmetric bowl: two side ledges, a wide centre shelf,
  // two more side ledges, and a full floor. Start bottom-left, like Bub.
  fromAscii('Insect Cave', [
    '....................',
    '...z...........Z....',
    '..######....######..',
    '....................',
    '......z....Z........',
    '.....##########.....',
    '....................',
    '....................',
    '..######....######..',
    '....................',
    '....................',
    '.P..................',
    '####################',
  ]),
  // Round 2 — stepped ledges with a couple of bouncers worked in.
  fromAscii('Stepping Stones', [
    '....................',
    '..z...............M.',
    '..########..######..',
    '....................',
    '......b......b......',
    '....######..######..',
    '....................',
    '..m..............z..',
    '..######....######..',
    '....................',
    '....................',
    '.P..................',
    '####################',
  ]),
  // Round 3 — open air with a Monsta (flyer) crossing it; ledges to bounce up to.
  fromAscii('Cross Winds', [
    '....................',
    '....o...........O...',
    '...######..######...',
    '....................',
    '........z..Z........',
    '.......########.....',
    '....................',
    '....o...........O...',
    '...######..######...',
    '....................',
    '....................',
    '.P..................',
    '####################',
  ]),
  // Round 4 — a tall pillar room: narrow shelves up the sides, ride bubbles high.
  fromAscii('Twin Towers', [
    '....................',
    '..z..............Z..',
    '..####........####..',
    '..............b.....',
    '..####........####..',
    '.....m......m.......',
    '..####........####..',
    '....................',
    '......########......',
    '........e...........',
    '....................',
    '.P..................',
    '####################',
  ]),
  // Round 5 — a full mixed cast on a layered arena.
  fromAscii('Monster Hall', [
    '....................',
    '..e....E....e....E..',
    '.####.####.####.####',
    '....................',
    '....o..........O....',
    '....................',
    '...b....m..M....b...',
    '..##############.##..',
    '....................',
    '......z....Z........',
    '.....##########.....',
    '.P..................',
    '####################',
  ]),
]

export function cloneLevel(l: LevelDef): LevelDef {
  return {
    name: l.name, cols: l.cols, rows: l.rows,
    tiles: l.tiles.slice(),
    player: { ...l.player },
    enemies: l.enemies.map(e => ({ ...e })),
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
// designer authors ~20×13 — so these caps are generous headroom.
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

  // Only WALL survives — an unrecognised code collapses to EMPTY so a tampered
  // store can't smuggle in odd geometry.
  const tiles = new Array<number>(n)
  for (let i = 0; i < n; i++) { const t = Number(tilesRaw[i]); tiles[i] = t === WALL ? WALL : EMPTY }

  return {
    name: typeof d['name'] === 'string' ? d['name'].slice(0, 80) : 'Imported',
    cols, rows, tiles, player, enemies,
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
export function emptyLevel(name: string, cols = 20, rows = 13): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  for (let c = 0; c < cols; c++) tiles[(rows - 1) * cols + c] = WALL
  return {
    name, cols, rows, tiles,
    player: { col: 1, row: rows - 2 },
    enemies: [],
  }
}

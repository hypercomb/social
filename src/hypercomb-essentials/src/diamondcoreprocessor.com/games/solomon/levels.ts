// diamondcoreprocessor.com/games/solomon/levels.ts
//
// Built-in levels (authored as readable ASCII) + the participant-local store
// for designer-made levels. Custom levels live in localStorage — the same
// class of participant-local UI data as screensaver prefs / accent colour, NOT
// layer state (a level in the layer would skew the lineage signature across
// peers, the same rule that keeps viewport + clipboard out of history).

import { EMPTY, WALL, BRICK, type LevelDef, type Cell, type EnemySpawn } from './engine.js'

const STORE_KEY = 'hc:solomon-levels'

// ASCII legend:
//   '#' WALL   'B' BRICK   '.'/' ' EMPTY
//   'P' player spawn   'D' door   'K' key
//   'g' gem   'e' enemy (faces right)   'E' enemy (faces left)
const CHAR_TILE: Record<string, number> = { '#': WALL, 'B': BRICK }

/** Parse an ASCII level. Entity glyphs leave their cell EMPTY and record a
 *  placement. Rows are padded / truncated to `cols` so authoring is forgiving. */
export function fromAscii(name: string, art: string[]): LevelDef {
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  const tiles = new Array<number>(rows * cols).fill(EMPTY)
  let player: Cell = { col: 1, row: rows - 2 }
  let door: Cell = { col: cols - 2, row: rows - 2 }
  let key: Cell | null = null
  const gems: Cell[] = []
  const enemies: EnemySpawn[] = []

  for (let r = 0; r < rows; r++) {
    const line = art[r]
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.'
      const i = r * cols + c
      switch (ch) {
        case 'P': player = { col: c, row: r }; break
        case 'D': door = { col: c, row: r }; break
        case 'K': key = { col: c, row: r }; break
        case 'g': gems.push({ col: c, row: r }); break
        case 'e': enemies.push({ col: c, row: r, dir: 1 }); break
        case 'E': enemies.push({ col: c, row: r, dir: -1 }); break
        default: tiles[i] = CHAR_TILE[ch] ?? EMPTY
      }
    }
  }
  return { name, cols, rows, tiles, player, door, key, gems, enemies }
}

export const BUILTIN_LEVELS: LevelDef[] = [
  fromAscii('Awakening', [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.........g........#',
    '#........K.........#',
    '#.......######.....#',
    '#..................#',
    '#..................#',
    '#.P..........e....D#',
    '####################',
  ]),
  fromAscii('Twin Towers', [
    '####################',
    '#..................#',
    '#....K........g....#',
    '#...####....####...#',
    '#..................#',
    '#........gg........#',
    '#......######......#',
    '#..................#',
    '#..E............e..#',
    '#....######........#',
    '#..................#',
    '#.P..............D.#',
    '####################',
  ]),
  fromAscii('The Vault', [
    '####################',
    '#..................#',
    '#.K......g........D#',
    '#.###...###......###',
    '#......E....g......#',
    '#....######...###..#',
    '#..................#',
    '#..g....e.....e....#',
    '#.####.....####....#',
    '#..................#',
    '#......BBBB........#',
    '#.P....####......E.#',
    '####################',
  ]),
]

// ── custom level store (localStorage) ────────────────────────

function isValid(l: unknown): l is LevelDef {
  if (!l || typeof l !== 'object') return false
  const d = l as Record<string, unknown>
  return typeof d['name'] === 'string'
    && typeof d['cols'] === 'number' && typeof d['rows'] === 'number'
    && Array.isArray(d['tiles']) && d['tiles'].length === (d['cols'] as number) * (d['rows'] as number)
    && !!d['player'] && !!d['door']
}

export function loadCustomLevels(): LevelDef[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(isValid) : []
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

export function cloneLevel(l: LevelDef): LevelDef {
  return {
    name: l.name, cols: l.cols, rows: l.rows,
    tiles: l.tiles.slice(),
    player: { ...l.player },
    door: { ...l.door },
    key: l.key ? { ...l.key } : null,
    gems: l.gems.map(g => ({ ...g })),
    enemies: l.enemies.map(e => ({ ...e })),
  }
}

/** A blank canvas for the designer — walled border, floor, a spawn + door. */
export function emptyLevel(name: string, cols = 20, rows = 13): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  for (let c = 0; c < cols; c++) { tiles[c] = WALL; tiles[(rows - 1) * cols + c] = WALL }
  for (let r = 0; r < rows; r++) { tiles[r * cols] = WALL; tiles[r * cols + cols - 1] = WALL }
  return {
    name, cols, rows, tiles,
    player: { col: 1, row: rows - 2 },
    door: { col: cols - 2, row: rows - 2 },
    key: null, gems: [], enemies: [],
  }
}

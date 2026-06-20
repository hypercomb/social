// diamondcoreprocessor.com/games/solomon/levels.ts
//
// Built-in rooms (authored as readable ASCII) + the participant-local store for
// designer-made levels. The built-ins recreate the FEEL and content of the NES
// original's opening rooms — a safe tutorial, the demon-mirror room, a turret/
// flyer chamber, a constellation climb, a gargoyle ascent, a ghost corridor —
// translated onto our grid. (Tecmo's exact block maps are screenshots, not data,
// so geometry is authored to make each room's documented solution work, with the
// real item placements: key, bells, hidden jars.)
//
// Custom levels live in localStorage — the same class of participant-local UI
// data as screensaver prefs / accent colour, NOT layer state (a level in the
// layer would skew the lineage signature across peers, the same rule that keeps
// viewport + clipboard out of history).

import {
  EMPTY, WALL, BRICK, LIFE_FULL,
  type LevelDef, type Cell, type EnemySpawn, type EnemyKind, type ItemSpawn, type ItemKind,
} from './engine.js'

const STORE_KEY = 'hc:solomon-levels'

// ASCII legend (one char per cell):
//   '#' grey WALL (permanent)   'B' orange BRICK (breakable)   '.'/' ' EMPTY
//   'P' player start   'D' door
//   items:  K key · b bell · j jewel(500) · J jewel(5000) · f jar(fireball) ·
//           F super-jar · t hourglass(full) · u hourglass(half) · + extra life
//   foes:   g goblin · r gargoil · h ghost · a dragon · o demonhead · n panel
//   'M' demon mirror (spawns demonheads)
const CHAR_TILE: Record<string, number> = { '#': WALL, 'B': BRICK }
const CHAR_ENEMY: Record<string, EnemyKind> = {
  g: 'goblin', r: 'gargoil', h: 'ghost', a: 'dragon', o: 'demonhead', n: 'panel',
}
const CHAR_ITEM: Record<string, { kind: ItemKind; value?: number }> = {
  K: { kind: 'key' },
  b: { kind: 'bell' },
  j: { kind: 'jewel', value: 500 },
  J: { kind: 'jewel', value: 5000 },
  f: { kind: 'jar' },
  F: { kind: 'superjar' },
  t: { kind: 'hourglass' },
  u: { kind: 'hourglassHalf' },
  '+': { kind: 'life' },
}

/** Author options: hidden items (revealed by destroying their covering brick)
 *  carry their own coordinates; everything else is in the ASCII art. */
interface AsciiOpts { hidden?: ItemSpawn[]; lifeStart?: number }

/** Parse an ASCII room. Entity glyphs leave their cell EMPTY and record a
 *  placement; rows are padded / truncated to `cols` so authoring is forgiving.
 *  Enemies face inward (toward room centre) by default. */
export function fromAscii(name: string, art: string[], opts: AsciiOpts = {}): LevelDef {
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  const tiles = new Array<number>(rows * cols).fill(EMPTY)
  let player: Cell = { col: 1, row: rows - 2 }
  let door: Cell = { col: cols - 2, row: rows - 2 }
  const items: ItemSpawn[] = []
  const enemies: EnemySpawn[] = []
  const mirrors: Cell[] = []
  const inward = (c: number): 1 | -1 => (c < cols / 2 ? 1 : -1)

  for (let r = 0; r < rows; r++) {
    const line = art[r]
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.'
      const i = r * cols + c
      if (ch === 'P') { player = { col: c, row: r }; continue }
      if (ch === 'D') { door = { col: c, row: r }; continue }
      if (ch === 'M') { mirrors.push({ col: c, row: r }); continue }
      const en = CHAR_ENEMY[ch]
      if (en) { enemies.push({ col: c, row: r, kind: en, dir: inward(c) }); continue }
      const it = CHAR_ITEM[ch]
      if (it) { items.push({ col: c, row: r, kind: it.kind, value: it.value }); continue }
      tiles[i] = CHAR_TILE[ch] ?? EMPTY
    }
  }

  // Hidden items need a breakable cover so they can be revealed — drop a brick
  // over any hidden coord that isn't already solid.
  for (const h of opts.hidden ?? []) {
    items.push({ ...h, hidden: true })
    const i = h.row * cols + h.col
    if (tiles[i] === EMPTY) tiles[i] = BRICK
  }

  return { name, cols, rows, tiles, player, door, enemies, items, mirrors, lifeStart: opts.lifeStart }
}

export const BUILTIN_LEVELS: LevelDef[] = [
  // Room 1 — Awakening. The tutorial room: a lone goblin (crush it by conjuring a
  // block in its face, or just slip past), a bell + key up on a ledge to build
  // stairs to, and a fireball jar hidden in the ledge.
  fromAscii('Awakening', [
    '####################',
    '#..................#',
    '#........b.........#',
    '#..................#',
    '#.........K........#',
    '#.......BBBBB......#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.......g..........#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 10, row: 5, kind: 'jar' }] }),

  // Room 2 — Hall of Mirrors. Two demon mirrors rain endless demonheads; shelter
  // low-left, then build up to the bell + key. A super-jar hides in the mid ledge.
  fromAscii('Hall of Mirrors', [
    '####################',
    '#...M..........M...#',
    '#..................#',
    '#.......b....K.....#',
    '#....BBB....BBB....#',
    '#..................#',
    '#..................#',
    '#........BBB.......#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 9, row: 7, kind: 'superjar' }] }),

  // Room 3 — The Vault. A panel-monster turret on the left wall, a ghost cruising
  // the middle, a gargoil and a goblin below. An extra Dana waits on the top-right
  // ledge; the key sits mid-right. Time the turret, wall off the ghost.
  fromAscii('The Vault', [
    '####################',
    '#..............+...#',
    '#.............BBB..#',
    '#n.................#',
    '#BBBB.............h#',
    '#..................#',
    '#......BBBB........#',
    '#..................#',
    '#...........K......#',
    '#.........BBBB.....#',
    '#....r.............#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 7, row: 6, kind: 'jar' }, { col: 11, row: 9, kind: 'jewel', value: 2000 }] }),

  // Room 4 — Constellation of Aries. A vertical room: key and a high-value zodiac
  // jewel stacked in the centre column, gargoils on side ledges, goblins prowling
  // the floor. Climb the middle, drop the gargoils.
  fromAscii('Constellation', [
    '####################',
    '#........J.........#',
    '#.......BBB........#',
    '#..................#',
    '#........K.........#',
    '#.......BBB........#',
    '#..................#',
    '#..r...........r...#',
    '#.BBB........BBBB..#',
    '#..................#',
    '#.....g......g.....#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 4, row: 10, kind: 'bell' }, { col: 15, row: 10, kind: 'bell' }] }),

  // Room 5 — Gargoyle Climb. An ascent past gargoils perched on alternating
  // ledges — drop each one as you build up to the key. Blue jewels reward the
  // bottom corners; a top gargoil guards a hidden fairy bell.
  fromAscii('Gargoyle Climb', [
    '####################',
    '#...............r..#',
    '#............BBBB..#',
    '#..r..............#',
    '#BBBB.............#',
    '#..................#',
    '#........K.........#',
    '#.......BBB........#',
    '#..................#',
    '#...r..........r...#',
    '#..BBB.j....j.BBB..#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 16, row: 2, kind: 'bell' }] }),

  // Room 6 — Ghost Corridor. Ghosts stacked across corridor floors smash any
  // bridge they cross — grab the super-jar up top to sweep a whole row, or turn
  // them with blocks while you squeeze past. A goblin charges from below.
  fromAscii('Ghost Corridor', [
    '####################',
    '#..K......F........#',
    '#..BBB....BB.......#',
    '#.........h........#',
    '#BBBBBBBB..........#',
    '#.........h........#',
    '#.......BBBBBBB....#',
    '#....h.............#',
    '#BBBBBBB...........#',
    '#..............h...#',
    '#.........g........#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 15, row: 1, kind: 'jewel', value: 2000 }] }),
]

// ── custom level store (localStorage) ────────────────────────

// Untrusted level data (Import JSON + this localStorage store) is the only attack
// surface these games expose. Bound the dimensions + entity counts and require
// in-bounds integer coordinates so a crafted level can't exhaust memory (a giant
// grid / canvas) or stall the render loop. Single-screen rooms are tiny — the
// designer authors ~20×13 — so these caps are generous headroom.
const MAX_DIM = 120
const MAX_ENTITIES = MAX_DIM * MAX_DIM
const ENEMY_KINDS = new Set<EnemyKind>(['goblin', 'gargoil', 'ghost', 'demonhead', 'dragon', 'panel'])
const ITEM_KINDS = new Set<ItemKind>(['key', 'jewel', 'bell', 'jar', 'superjar', 'hourglass', 'hourglassHalf', 'fairy', 'life'])

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** A finite, in-bounds {col,row} or null. */
function asCell(v: unknown, cols: number, rows: number): Cell | null {
  if (!v || typeof v !== 'object') return null
  const { col, row } = v as Record<string, unknown>
  if (!isInt(col) || !isInt(row) || col < 0 || col >= cols || row < 0 || row >= rows) return null
  return { col, row }
}

/** Validate untrusted level JSON into a CLEAN LevelDef, or null if anything is
 *  out of bounds. Accepts BOTH the current shape (items[]/typed enemies/mirrors)
 *  and the legacy shape (key:Cell + gems[] + plain enemies) so levels saved by an
 *  older build still load. Held to the same limits as a pasted level. */
export function sanitizeLevel(raw: unknown): LevelDef | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const cols = d['cols'], rows = d['rows']
  if (!isInt(cols) || !isInt(rows) || cols < 1 || rows < 1 || cols > MAX_DIM || rows > MAX_DIM) return null
  const n = cols * rows
  const tilesRaw = d['tiles']
  if (!Array.isArray(tilesRaw) || tilesRaw.length !== n) return null

  const player = asCell(d['player'], cols, rows)
  const door = asCell(d['door'], cols, rows)
  if (!player || !door) return null

  // Items: prefer the new items[] array; fall back to legacy key + gems.
  const items: ItemSpawn[] = []
  if (Array.isArray(d['items'])) {
    if (d['items'].length > MAX_ENTITIES) return null
    for (const raw of d['items']) {
      const c = asCell(raw, cols, rows); if (!c) return null
      const kind = (raw as ItemSpawn)?.kind
      if (!ITEM_KINDS.has(kind)) return null
      const value = (raw as ItemSpawn).value
      items.push({ col: c.col, row: c.row, kind, hidden: !!(raw as ItemSpawn).hidden, value: isInt(value) ? value : undefined })
    }
  } else {
    const key = d['key'] == null ? null : asCell(d['key'], cols, rows)
    if (d['key'] != null && !key) return null
    if (key) items.push({ col: key.col, row: key.row, kind: 'key' })
    const gemsRaw = Array.isArray(d['gems']) ? d['gems'] : []
    if (gemsRaw.length > MAX_ENTITIES) return null
    for (const g of gemsRaw) { const c = asCell(g, cols, rows); if (!c) return null; items.push({ col: c.col, row: c.row, kind: 'jewel', value: 500 }) }
  }

  const enemiesRaw = Array.isArray(d['enemies']) ? d['enemies'] : []
  if (enemiesRaw.length > MAX_ENTITIES) return null
  const enemies: EnemySpawn[] = []
  for (const e of enemiesRaw) {
    const c = asCell(e, cols, rows); if (!c) return null
    const kindRaw = (e as EnemySpawn)?.kind
    const kind: EnemyKind = ENEMY_KINDS.has(kindRaw as EnemyKind) ? (kindRaw as EnemyKind) : 'goblin'
    enemies.push({ col: c.col, row: c.row, kind, dir: (e as EnemySpawn)?.dir === -1 ? -1 : 1 })
  }

  const mirrorsRaw = Array.isArray(d['mirrors']) ? d['mirrors'] : []
  if (mirrorsRaw.length > MAX_ENTITIES) return null
  const mirrors: Cell[] = []
  for (const m of mirrorsRaw) { const c = asCell(m, cols, rows); if (!c) return null; mirrors.push(c) }

  const tiles = new Array<number>(n)
  for (let i = 0; i < n; i++) { const t = Number(tilesRaw[i]); tiles[i] = Number.isFinite(t) && t >= 0 && t <= 3 ? t : 0 }

  const lifeStart = d['lifeStart']
  return {
    name: typeof d['name'] === 'string' ? d['name'].slice(0, 80) : 'Imported',
    cols, rows, tiles, player, door, enemies, items, mirrors,
    lifeStart: isInt(lifeStart) && lifeStart > 0 ? lifeStart : undefined,
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

export function cloneLevel(l: LevelDef): LevelDef {
  return {
    name: l.name, cols: l.cols, rows: l.rows,
    tiles: l.tiles.slice(),
    player: { ...l.player },
    door: { ...l.door },
    enemies: l.enemies.map(e => ({ ...e })),
    items: l.items.map(it => ({ ...it })),
    mirrors: l.mirrors.map(m => ({ ...m })),
    lifeStart: l.lifeStart,
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
    enemies: [], items: [], mirrors: [], lifeStart: LIFE_FULL,
  }
}

// diamondcoreprocessor.com/games/solomon/levels.ts
//
// Built-in rooms (authored as readable ASCII) + the participant-local store for
// designer-made levels. The built-ins recreate the FEEL and content of the NES
// original's opening rooms across the first three zodiac "shrines" — a safe
// tutorial, the demon-mirror room, a turret/flyer vault, constellation panels
// that open a fairy bonus room, gargoyle climbs, ghost corridors, spark cells,
// a dragon lair, a gauntlet, and Solomon's Gate before the ending. (Tecmo's
// exact block maps are screenshots, not data, so geometry is authored to make
// each room's documented solution work, with faithful item placements.)
//
// Custom levels live in localStorage — participant-local UI data, NOT layer
// state (a level in the layer would skew the lineage signature across peers).

import {
  EMPTY, WALL, BRICK, LIFE_FULL, LIFE_HALF,
  type LevelDef, type Cell, type EnemySpawn, type EnemyKind,
  type ItemSpawn, type ItemKind, type MirrorSpawn,
} from './engine.js'

const STORE_KEY = 'hc:solomon-levels'

// ASCII legend (one char per cell):
//   '#' grey WALL · 'B' orange BRICK · '.'/' ' EMPTY · 'P' player · 'D' door
//   items:  K key · b bell · j jewel(500) · J jewel(5000) · $ treasure(2000) ·
//           f jar · F super-jar · / scroll · t hourglass · u half-hourglass ·
//           + extra life · @ Solomon's Seal · Z constellation panel · W Golden Wings
//   foes:   g goblin · r gargoil · a dragon · s saramandor · h ghost ·
//           l neul · k sparkball · o demonhead · n panel monster
//   mirrors: M demonhead mirror · m saramandor mirror
const CHAR_TILE: Record<string, number> = { '#': WALL, 'B': BRICK }
const CHAR_ENEMY: Record<string, EnemyKind> = {
  g: 'goblin', r: 'gargoil', a: 'dragon', s: 'saramandor', h: 'ghost',
  l: 'neul', k: 'sparkball', o: 'demonhead', n: 'panel',
}
const CHAR_ITEM: Record<string, { kind: ItemKind; value?: number }> = {
  K: { kind: 'key' },
  b: { kind: 'bell' },
  j: { kind: 'jewel', value: 500 },
  J: { kind: 'jewel', value: 5000 },
  $: { kind: 'treasure', value: 2000 },
  f: { kind: 'jar' },
  F: { kind: 'superjar' },
  '/': { kind: 'scroll' },
  t: { kind: 'hourglass' },
  u: { kind: 'hourglassHalf' },
  '+': { kind: 'life' },
  '@': { kind: 'seal' },
  Z: { kind: 'zodiac' },
  W: { kind: 'wings' },
}

interface AsciiOpts { hidden?: ItemSpawn[]; lifeStart?: number }

/** Parse an ASCII room. Entity glyphs leave their cell EMPTY and record a
 *  placement; rows are padded / truncated to `cols`. Enemies face inward. */
export function fromAscii(name: string, art: string[], opts: AsciiOpts = {}): LevelDef {
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  const tiles = new Array<number>(rows * cols).fill(EMPTY)
  let player: Cell = { col: 1, row: rows - 2 }
  let door: Cell = { col: cols - 2, row: rows - 2 }
  const items: ItemSpawn[] = []
  const enemies: EnemySpawn[] = []
  const mirrors: MirrorSpawn[] = []
  const inward = (c: number): 1 | -1 => (c < cols / 2 ? 1 : -1)

  for (let r = 0; r < rows; r++) {
    const line = art[r]
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.'
      const i = r * cols + c
      if (ch === 'P') { player = { col: c, row: r }; continue }
      if (ch === 'D') { door = { col: c, row: r }; continue }
      if (ch === 'M') { mirrors.push({ col: c, row: r, kind: 'demonhead' }); continue }
      if (ch === 'm') { mirrors.push({ col: c, row: r, kind: 'saramandor' }); continue }
      const en = CHAR_ENEMY[ch]
      if (en) { enemies.push({ col: c, row: r, kind: en, dir: inward(c) }); continue }
      const it = CHAR_ITEM[ch]
      if (it) { items.push({ col: c, row: r, kind: it.kind, value: it.value }); continue }
      tiles[i] = CHAR_TILE[ch] ?? EMPTY
    }
  }

  for (const h of opts.hidden ?? []) {
    items.push({ ...h, hidden: true })
    const i = h.row * cols + h.col
    if (tiles[i] === EMPTY) tiles[i] = BRICK
  }

  return { name, cols, rows, tiles, player, door, enemies, items, mirrors, lifeStart: opts.lifeStart }
}

export const BUILTIN_LEVELS: LevelDef[] = [
  // ── Shrine of Aries (rooms 1–4) ──
  // Room 1 — Awakening. Tutorial: a lone goblin, a bell + key up a ledge, a
  // fireball jar hidden in the ledge.
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

  // Room 2 — Hall of Mirrors. Two demon mirrors rain demonheads; shelter low,
  // build up to the bell + key. Super-jar hidden in the mid ledge.
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

  // Room 3 — The Vault. Panel-monster turret, a ghost, a gargoil + goblin. An
  // extra Dana on the top-right ledge; the key mid-right.
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

  // Room 4 — Constellation of Aries. The 4th room holds the ZODIAC PANEL — clear
  // the room holding it to drop into the fairy bonus room.
  fromAscii('Constellation', [
    '####################',
    '#........Z.........#',
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

  // ── Shrine of Taurus (rooms 5–8) ──
  // Room 5 — Gargoyle Climb. Drop gargoils as you build up to the key.
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

  // Room 6 — Ghost Corridor. Ghosts smash bridges; grab the super-jar to sweep.
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

  // Room 7 — Sky Tower. A Neul homes on your height as you climb to the GOLDEN
  // WINGS (clear holding them to warp ahead). A Solomon's Seal waits mid-tower.
  fromAscii('Sky Tower', [
    '####################',
    '#........W.........#',
    '#.......BBB........#',
    '#.l................#',
    '#..................#',
    '#........@.........#',
    '#.......BBB........#',
    '#..................#',
    '#..r...........r...#',
    '#.BBB........BBBB..#',
    '#..................#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 3, row: 10, kind: 'scroll' }] }),

  // Room 8 — Constellation of Taurus. Second ZODIAC PANEL, guarded by ghosts.
  fromAscii('Constellation II', [
    '####################',
    '#........Z.........#',
    '#.......BBB........#',
    '#..h............h..#',
    '#..................#',
    '#........K.........#',
    '#.......BBB........#',
    '#..................#',
    '#..r...........r...#',
    '#.BBB........BBBB..#',
    '#.....g......g.....#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 9, row: 7, kind: 'superjar' }] }),

  // ── Shrine of Gemini (rooms 9–12) ──
  // Room 9 — Spark Cells. Relentless sparkballs ricochet — wall them off or
  // fireball them. A Solomon's Seal hides top-left; a scroll widens your stock.
  fromAscii('Spark Cells', [
    '####################',
    '#..@...............#',
    '#.BBB..............#',
    '#..................#',
    '#....k........k....#',
    '#..................#',
    '#........K.........#',
    '#.......BBB........#',
    '#..................#',
    '#....k........k....#',
    '#..................#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 3, row: 7, kind: 'scroll' }] }),

  // Room 10 — Dragon's Lair. A pink Dragon hunts while Saramandors spit fire.
  fromAscii("Dragon's Lair", [
    '####################',
    '#..................#',
    '#....a.............#',
    '#...BBBB...........#',
    '#..................#',
    '#..........s.......#',
    '#........BBBB......#',
    '#..................#',
    '#..s...........K...#',
    '#.BBBB.......BBBB..#',
    '#..................#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 5, row: 7, kind: 'jar' }, { col: 14, row: 5, kind: 'jar' }] }),

  // Room 11 — The Gauntlet. A saramandor mirror, a panel turret, a ghost, a
  // sparkball and gargoils — and a Solomon's Seal behind the left ledge.
  fromAscii('The Gauntlet', [
    '####################',
    '#.@....m.......h...#',
    '#.BBB..............#',
    '#..................#',
    '#......n...........#',
    '#..................#',
    '#........K.........#',
    '#.......BBB........#',
    '#..r...........r...#',
    '#.BBB........BBBB..#',
    '#.....g.....k......#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 15, row: 6, kind: 'treasure', value: 5000 }] }),

  // Room 12 — Solomon's Gate. The third ZODIAC PANEL crowns a foe-storm: two
  // demon mirrors, ghosts, gargoils and dragons. An hourglass keeps you alive.
  fromAscii("Solomon's Gate", [
    '####################',
    '#........Z.........#',
    '#.......BBB........#',
    '#..h....t....h.....#',
    '#..................#',
    '#....M........M....#',
    '#..................#',
    '#........K.........#',
    '#.......BBB........#',
    '#..r..a.....a..r...#',
    '#.BBBB......BBBBB..#',
    '#.P..............D.#',
    '####################',
  ], { hidden: [{ col: 9, row: 6, kind: 'superjar' }] }),
]

/** The fairy bonus room reached by clearing a room while holding a constellation
 *  panel — no enemies, the door is open from the start, a short timer, and a
 *  glade full of bells, fairies and treasure. */
export const BONUS_ROOM: LevelDef = fromAscii('Fairy Glade', [
  '####################',
  '#..b...b....b...b..#',
  '#..................#',
  '#....j...$....j....#',
  '#..................#',
  '#..b...BBBBBB...b..#',
  '#......BBBBBB......#',
  '#..................#',
  '#...j....b....j....#',
  '#..................#',
  '#..................#',
  '#.P..............D.#',
  '####################',
], { lifeStart: LIFE_HALF })

/** How many Solomon's Seals exist across the built-in game (all 3 needed for the
 *  best ending). */
export const SEAL_TOTAL = BUILTIN_LEVELS.reduce((n, l) => n + l.items.filter(i => i.kind === 'seal').length, 0)

// ── progression: where clearing a room sends you ─────────────

/** How many rooms the Golden Wings skip ahead. */
export const WARP_ROOMS = 3

export interface NextDecision {
  /** 'next' → play room `index`; 'bonus' → the fairy room, then resume `index`;
   *  'ending' → the game is complete. */
  kind: 'next' | 'bonus' | 'ending'
  index: number
}

/** Pure decision: given the just-cleared room + flags, what plays next? Kept
 *  pure (no DOM) so the warp / bonus / ending branches are unit-testable. */
export function decideNext(p: {
  levelIndex: number
  builtinCount: number
  totalCount: number
  zodiacHeld: boolean
  wingsHeld: boolean
  inBonus: boolean
  bonusResumeIndex: number
}): NextDecision {
  // Finishing the fairy bonus room → resume where the zodiac room left off.
  if (p.inBonus) {
    const idx = p.bonusResumeIndex
    if (idx >= p.builtinCount && p.totalCount === p.builtinCount) return { kind: 'ending', index: 0 }
    return { kind: 'next', index: idx % p.totalCount }
  }
  // Cleared holding a constellation panel → detour through the bonus room.
  if (p.zodiacHeld) return { kind: 'bonus', index: p.levelIndex + 1 }
  // Golden Wings warp ahead; otherwise the next room.
  const target = p.wingsHeld ? p.levelIndex + WARP_ROOMS : p.levelIndex + 1
  // Past the last built-in with no custom levels appended → the game is won.
  if (target >= p.builtinCount && p.totalCount === p.builtinCount) return { kind: 'ending', index: 0 }
  return { kind: 'next', index: target % p.totalCount }
}

// ── custom level store (localStorage) ────────────────────────

const MAX_DIM = 120
const MAX_ENTITIES = MAX_DIM * MAX_DIM
const ENEMY_KINDS = new Set<EnemyKind>(['goblin', 'gargoil', 'ghost', 'demonhead', 'dragon', 'panel', 'neul', 'saramandor', 'sparkball'])
const ITEM_KINDS = new Set<ItemKind>(['key', 'jewel', 'treasure', 'bell', 'jar', 'superjar', 'scroll', 'hourglass', 'hourglassHalf', 'fairy', 'life', 'seal', 'zodiac', 'wings'])
const MIRROR_KINDS = new Set(['demonhead', 'saramandor'])

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

function asCell(v: unknown, cols: number, rows: number): Cell | null {
  if (!v || typeof v !== 'object') return null
  const { col, row } = v as Record<string, unknown>
  if (!isInt(col) || !isInt(row) || col < 0 || col >= cols || row < 0 || row >= rows) return null
  return { col, row }
}

/** Validate untrusted level JSON into a CLEAN LevelDef, or null. Accepts BOTH the
 *  current shape (items[]/typed enemies/mirrors) and the legacy shape (key + gems)
 *  so older saved levels still load. Held to the same limits as a pasted level. */
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
  const mirrors: MirrorSpawn[] = []
  for (const m of mirrorsRaw) {
    const c = asCell(m, cols, rows); if (!c) return null
    const k = (m as MirrorSpawn)?.kind
    mirrors.push({ col: c.col, row: c.row, kind: MIRROR_KINDS.has(k as string) ? k : 'demonhead' })
  }

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

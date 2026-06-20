// diamondcoreprocessor.com/games/solomon/designer.ts
//
// Level designer logic. Holds the LevelDef being edited and a paint tool; the
// overlay owns the DOM toolbar + canvas events and calls in here. Kept separate
// from rendering so the same LevelDef can be handed straight to the engine for a
// playtest. Tools cover the full NES vocabulary — grey/orange blocks, the player
// + door singletons, every item pickup (incl. seals / constellation panels /
// wings), every foe kind, and both demon-mirror flavours.

import { EMPTY, WALL, BRICK, type LevelDef, type Cell, type EnemyKind, type ItemKind, type MirrorKind } from './engine.js'
import { cloneLevel, emptyLevel, sanitizeLevel } from './levels.js'

const ITEM_TOOLS = {
  key: 'key', bell: 'bell', jewel: 'jewel', treasure: 'treasure', jar: 'jar', scroll: 'scroll',
  hourglass: 'hourglass', life: 'life', seal: 'seal', zodiac: 'zodiac', wings: 'wings',
  pageTime: 'pageTime', pageSpace: 'pageSpace', princess: 'princess',
} as const
const ENEMY_TOOLS = {
  goblin: 'goblin', gargoil: 'gargoil', dragon: 'dragon', saramandor: 'saramandor', ghost: 'ghost',
  neul: 'neul', sparkball: 'sparkball', demonhead: 'demonhead', panel: 'panel',
} as const

export type Tool =
  | 'erase' | 'wall' | 'brick' | 'player' | 'door' | 'mirror' | 'firemirror'
  | keyof typeof ITEM_TOOLS | keyof typeof ENEMY_TOOLS

export const TOOLS: { tool: Tool; label: string; glyph: string }[] = [
  { tool: 'wall', label: 'Grey wall (permanent)', glyph: '▦' },
  { tool: 'brick', label: 'Orange brick (breakable)', glyph: '▥' },
  { tool: 'player', label: 'Dana start', glyph: 'P' },
  { tool: 'door', label: 'Exit door', glyph: '🚪' },
  { tool: 'key', label: 'Key', glyph: '🔑' },
  { tool: 'bell', label: 'Bell (frees a fairy)', glyph: '🔔' },
  { tool: 'jewel', label: 'Jewel', glyph: '◆' },
  { tool: 'treasure', label: 'Treasure', glyph: '💰' },
  { tool: 'jar', label: 'Fireball jar', glyph: '🔥' },
  { tool: 'scroll', label: 'Scroll (wider fireball stock)', glyph: '📜' },
  { tool: 'hourglass', label: 'Hourglass (refill time)', glyph: '⌛' },
  { tool: 'life', label: 'Extra Dana', glyph: '★' },
  { tool: 'seal', label: "Solomon's Seal", glyph: '✡' },
  { tool: 'zodiac', label: 'Constellation panel (→ bonus room)', glyph: '♈' },
  { tool: 'wings', label: 'Golden Wings (→ warp)', glyph: '🪽' },
  { tool: 'pageTime', label: 'Page of Time', glyph: '🕰' },
  { tool: 'pageSpace', label: 'Page of Space', glyph: '🌌' },
  { tool: 'princess', label: 'Princess (true-ending goal)', glyph: '👸' },
  { tool: 'goblin', label: 'Goblin (chaser)', glyph: '👺' },
  { tool: 'gargoil', label: 'Gargoil (spits fire)', glyph: '🦅' },
  { tool: 'dragon', label: 'Dragon', glyph: '🐉' },
  { tool: 'saramandor', label: 'Saramandor (fire-walker)', glyph: '🦎' },
  { tool: 'ghost', label: 'Ghost (horizontal flyer)', glyph: '👻' },
  { tool: 'neul', label: 'Neul (vertical flyer)', glyph: '🦇' },
  { tool: 'sparkball', label: 'Sparkball (bouncer)', glyph: '⚡' },
  { tool: 'demonhead', label: 'Demonhead', glyph: '💀' },
  { tool: 'panel', label: 'Panel monster (turret)', glyph: '🗿' },
  { tool: 'mirror', label: 'Demon mirror (spawns demonheads)', glyph: '🪞' },
  { tool: 'firemirror', label: 'Fire mirror (spawns saramandors)', glyph: '🌋' },
  { tool: 'erase', label: 'Erase', glyph: '⌫' },
]

export class Designer {
  level: LevelDef
  tool: Tool = 'wall'

  constructor(level?: LevelDef) {
    this.level = level ? cloneLevel(level) : emptyLevel('My Level')
  }

  setLevel(level: LevelDef): void { this.level = cloneLevel(level) }
  setTool(tool: Tool): void { this.tool = tool }
  newLevel(name = 'My Level'): void { this.level = emptyLevel(name) }

  #idx(col: number, row: number): number { return row * this.level.cols + col }
  #inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.level.cols && row >= 0 && row < this.level.rows
  }
  #same(a: Cell, col: number, row: number): boolean { return a.col === col && a.row === row }

  /** Strip every placeable (item / enemy / mirror) sitting on a cell. */
  #clearCell(col: number, row: number): void {
    this.level.items = this.level.items.filter(i => !this.#same(i, col, row))
    this.level.enemies = this.level.enemies.filter(e => !this.#same(e, col, row))
    this.level.mirrors = this.level.mirrors.filter(m => !this.#same(m, col, row))
  }

  /** Paint one cell with the current tool. Returns true if anything changed. */
  paint(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return false
    const L = this.level
    const onPlayer = this.#same(L.player, col, row)
    const onDoor = this.#same(L.door, col, row)
    const tool = this.tool

    if (tool === 'player') { L.tiles[this.#idx(col, row)] = EMPTY; this.#clearCell(col, row); L.player = { col, row }; return true }
    if (tool === 'door') { L.tiles[this.#idx(col, row)] = EMPTY; this.#clearCell(col, row); L.door = { col, row }; return true }

    if (onPlayer || onDoor) return false // required singletons stay put

    if (tool === 'erase') { L.tiles[this.#idx(col, row)] = EMPTY; this.#clearCell(col, row); return true }
    if (tool === 'wall' || tool === 'brick') {
      L.tiles[this.#idx(col, row)] = tool === 'wall' ? WALL : BRICK
      this.#clearCell(col, row)
      return true
    }
    if (tool === 'mirror' || tool === 'firemirror') {
      const kind: MirrorKind = tool === 'firemirror' ? 'saramandor' : 'demonhead'
      const had = L.mirrors.some(m => this.#same(m, col, row) && m.kind === kind)
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!had) L.mirrors.push({ col, row, kind })
      return true
    }
    if (tool in ENEMY_TOOLS) {
      const kind = tool as EnemyKind
      const existing = L.enemies.find(e => this.#same(e, col, row))
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!(existing && existing.kind === kind)) L.enemies.push({ col, row, kind, dir: col < L.cols / 2 ? 1 : -1 })
      return true
    }
    if (tool in ITEM_TOOLS) {
      const kind = tool as ItemKind
      const existing = L.items.find(i => this.#same(i, col, row))
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!(existing && existing.kind === kind)) {
        L.items.push({ col, row, kind, value: kind === 'jewel' ? 500 : kind === 'treasure' ? 2000 : undefined })
      }
      return true
    }
    return false
  }

  /** Rename + return the level ready for the store. */
  named(name: string): LevelDef {
    const l = cloneLevel(this.level)
    l.name = name.trim() || 'Untitled'
    this.level.name = l.name
    return l
  }

  exportJson(): string { return JSON.stringify(this.level, null, 2) }

  importJson(text: string): boolean {
    try {
      const lvl = sanitizeLevel(JSON.parse(text))
      if (!lvl) return false
      this.level = lvl
      return true
    } catch { return false }
  }
}

// diamondcoreprocessor.com/games/solomon/designer.ts
//
// Level designer logic. Holds the LevelDef being edited and a paint tool;
// the overlay owns the DOM toolbar + canvas events and calls in here. Kept
// separate from rendering so the same LevelDef can be handed straight to the
// engine for a playtest.

import { EMPTY, WALL, BRICK, type LevelDef, type Cell } from './engine.js'
import { cloneLevel, emptyLevel, sanitizeLevel } from './levels.js'

export type Tool = 'erase' | 'wall' | 'brick' | 'player' | 'door' | 'key' | 'gem' | 'enemy'

export const TOOLS: { tool: Tool; label: string; glyph: string }[] = [
  { tool: 'wall', label: 'Wall', glyph: '▦' },
  { tool: 'brick', label: 'Brick', glyph: '▥' },
  { tool: 'player', label: 'Start', glyph: 'P' },
  { tool: 'door', label: 'Door', glyph: '🚪' },
  { tool: 'key', label: 'Key', glyph: '🔑' },
  { tool: 'gem', label: 'Gem', glyph: '◆' },
  { tool: 'enemy', label: 'Enemy', glyph: '👹' },
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
  #sameCell(a: Cell, col: number, row: number): boolean { return a.col === col && a.row === row }

  /** Remove any non-singleton entity (gem/enemy/key) sitting on a cell. */
  #clearEntities(col: number, row: number): void {
    this.level.gems = this.level.gems.filter(g => !this.#sameCell(g, col, row))
    this.level.enemies = this.level.enemies.filter(e => !this.#sameCell(e, col, row))
    if (this.level.key && this.#sameCell(this.level.key, col, row)) this.level.key = null
  }

  /** Paint one cell with the current tool. Returns true if anything changed. */
  paint(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return false
    const L = this.level
    const onPlayer = this.#sameCell(L.player, col, row)
    const onDoor = this.#sameCell(L.door, col, row)

    switch (this.tool) {
      case 'erase':
        if (onPlayer || onDoor) return false // required singletons stay put
        L.tiles[this.#idx(col, row)] = EMPTY
        this.#clearEntities(col, row)
        return true
      case 'wall':
      case 'brick':
        if (onPlayer || onDoor) return false
        L.tiles[this.#idx(col, row)] = this.tool === 'wall' ? WALL : BRICK
        this.#clearEntities(col, row)
        return true
      case 'player':
        L.tiles[this.#idx(col, row)] = EMPTY
        this.#clearEntities(col, row)
        L.player = { col, row }
        return true
      case 'door':
        L.tiles[this.#idx(col, row)] = EMPTY
        this.#clearEntities(col, row)
        L.door = { col, row }
        return true
      case 'key':
        if (onPlayer || onDoor) return false
        if (L.key && this.#sameCell(L.key, col, row)) { L.key = null; return true } // toggle off
        L.tiles[this.#idx(col, row)] = EMPTY
        this.#clearEntities(col, row)
        L.key = { col, row }
        return true
      case 'gem': {
        if (onPlayer || onDoor) return false
        const i = L.gems.findIndex(g => this.#sameCell(g, col, row))
        if (i >= 0) { L.gems.splice(i, 1); return true }
        L.tiles[this.#idx(col, row)] = EMPTY
        L.gems.push({ col, row })
        return true
      }
      case 'enemy': {
        if (onPlayer || onDoor) return false
        const i = L.enemies.findIndex(e => this.#sameCell(e, col, row))
        if (i >= 0) { L.enemies.splice(i, 1); return true }
        L.tiles[this.#idx(col, row)] = EMPTY
        L.enemies.push({ col, row, dir: 1 })
        return true
      }
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

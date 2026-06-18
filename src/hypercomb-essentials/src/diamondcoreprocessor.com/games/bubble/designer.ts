// diamondcoreprocessor.com/games/bubble/designer.ts
//
// Level designer logic. Holds the LevelDef being edited and a paint tool; the
// overlay owns the DOM toolbar + canvas events and calls in here. Kept separate
// from rendering so the same LevelDef can be handed straight to the engine for a
// playtest. Sibling of the Solomon designer, adapted to Bubble Bobble's model
// (one-way platforms, enemies, a single player spawn — no door/key/gem).

import { EMPTY, WALL, type LevelDef, type Cell } from './engine.js'
import { cloneLevel, emptyLevel, sanitizeLevel } from './levels.js'

export type Tool = 'wall' | 'enemy' | 'player' | 'erase'

export const TOOLS: { tool: Tool; label: string; glyph: string }[] = [
  { tool: 'wall', label: 'Platform', glyph: '▬' },
  { tool: 'enemy', label: 'Enemy', glyph: '👾' },
  { tool: 'player', label: 'Start', glyph: 'P' },
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

  #clearEnemies(col: number, row: number): void {
    this.level.enemies = this.level.enemies.filter(e => !this.#sameCell(e, col, row))
  }

  /** Paint one cell with the current tool. Returns true if anything changed. */
  paint(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return false
    const L = this.level
    const onPlayer = this.#sameCell(L.player, col, row)

    switch (this.tool) {
      case 'erase':
        if (onPlayer) return false // the spawn must always exist
        L.tiles[this.#idx(col, row)] = EMPTY
        this.#clearEnemies(col, row)
        return true
      case 'wall':
        if (onPlayer) return false
        L.tiles[this.#idx(col, row)] = WALL
        this.#clearEnemies(col, row)
        return true
      case 'player':
        L.tiles[this.#idx(col, row)] = EMPTY
        this.#clearEnemies(col, row)
        L.player = { col, row }
        return true
      case 'enemy': {
        if (onPlayer) return false
        const i = L.enemies.findIndex(e => this.#sameCell(e, col, row))
        if (i >= 0) { L.enemies.splice(i, 1); return true } // toggle off
        L.tiles[this.#idx(col, row)] = EMPTY
        L.enemies.push({ col, row, dir: 1, kind: L.enemies.length % 4 })
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

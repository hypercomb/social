// diamondcoreprocessor.com/games/bubble/designer.ts
//
// Level designer logic. Holds the LevelDef being edited and a paint tool; the
// overlay owns the DOM toolbar + canvas events and calls in here. Kept separate
// from rendering so the same LevelDef can be handed straight to the engine for a
// playtest. Sibling of the Solomon designer, adapted to Bubble Bobble's model
// (one-way platforms, enemies, a single player spawn — no door/key/gem).

import { EMPTY, WALL, DOOR, ENEMY_KIND_COUNT, type LevelDef, type Cell } from './engine.js'
import { cloneLevel, emptyLevel, sanitizeLevel } from './levels.js'

export type Tool = 'wall' | 'door' | 'enemy' | 'player' | 'erase'

export const TOOLS: { tool: Tool; label: string; glyph: string }[] = [
  { tool: 'wall', label: 'Platform', glyph: '▬' },
  { tool: 'door', label: 'Door — tunnel; place in pairs', glyph: '◍' },
  { tool: 'enemy', label: 'Enemy — click again to change species', glyph: '👾' },
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
      case 'door':
        if (onPlayer) return false
        L.tiles[this.#idx(col, row)] = DOOR
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
        if (i >= 0) {
          // click an existing foe to cycle its species; past the last → remove.
          const next = (L.enemies[i].kind ?? 0) + 1
          if (next >= ENEMY_KIND_COUNT) L.enemies.splice(i, 1)
          else L.enemies[i] = { ...L.enemies[i], kind: next }
          return true
        }
        L.tiles[this.#idx(col, row)] = EMPTY
        L.enemies.push({ col, row, dir: 1, kind: 0 })
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

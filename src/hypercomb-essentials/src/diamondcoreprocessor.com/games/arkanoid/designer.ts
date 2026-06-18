// diamondcoreprocessor.com/games/arkanoid/designer.ts
//
// Level designer logic. Holds the brick grid being edited and a paint tool; the
// overlay owns the DOM toolbar + canvas events and calls in here. Kept separate
// from rendering so the same grid can be handed straight to the engine for a
// playtest. Mirrors the Solomon designer in shape.

import { EDIT_COLS, EDIT_ROWS, emptyLevel, type ArkanoidLevel } from './levels.js'

// Tool char is the level tile code: '1'..'4' = brick hit-points (and colour),
// '.' = empty. The engine reads the same chars (see Engine.#build).
export type Tool = 'erase' | '1' | '2' | '3' | '4'

export const TOOLS: { tool: Tool; label: string; color: string }[] = [
  { tool: '1', label: '1', color: '#5ad1c4' },
  { tool: '2', label: '2', color: '#5aa9ff' },
  { tool: '3', label: '3', color: '#b98cff' },
  { tool: '4', label: '◆', color: '#ffd76a' },
  { tool: 'erase', label: '⌫', color: '#7a8198' },
]

/** Normalise rows to exactly EDIT_ROWS × EDIT_COLS of valid chars. */
function toGrid(rows: readonly string[]): string[] {
  const out: string[] = []
  for (let r = 0; r < EDIT_ROWS; r++) {
    const src = rows[r] ?? ''
    let line = ''
    for (let c = 0; c < EDIT_COLS; c++) {
      const ch = src[c] ?? '.'
      line += (ch === '1' || ch === '2' || ch === '3' || ch === '4' || ch === '*') ? (ch === '*' ? '4' : ch) : '.'
    }
    out.push(line)
  }
  return out
}

/** Drop trailing all-empty rows (keep at least one) so saved levels aren't tall. */
function trimGrid(grid: readonly string[]): string[] {
  const rows = grid.map(r => r)
  while (rows.length > 1 && /^\.*$/.test(rows[rows.length - 1])) rows.pop()
  return rows
}

export class Designer {
  name: string
  grid: string[]
  tool: Tool = '1'

  constructor(level?: ArkanoidLevel) {
    const base = level ?? emptyLevel('My Level')
    this.name = base.name
    this.grid = toGrid(base.rows)
  }

  setTool(tool: Tool): void { this.tool = tool }

  setLevel(level: ArkanoidLevel): void {
    this.name = level.name
    this.grid = toGrid(level.rows)
  }

  newLevel(name = 'My Level'): void {
    const e = emptyLevel(name)
    this.name = e.name
    this.grid = toGrid(e.rows)
  }

  /** Paint one cell with the current tool. Returns true if anything changed. */
  paint(col: number, row: number): boolean {
    if (col < 0 || col >= EDIT_COLS || row < 0 || row >= EDIT_ROWS) return false
    const ch = this.tool === 'erase' ? '.' : this.tool
    const line = this.grid[row]
    if (line[col] === ch) return false
    this.grid[row] = line.slice(0, col) + ch + line.slice(col + 1)
    return true
  }

  /** Rename + return the level ready for the store / engine. */
  named(name: string): ArkanoidLevel {
    const nm = name.trim() || 'Untitled'
    this.name = nm
    return { name: nm, rows: trimGrid(this.grid) }
  }

  exportJson(): string {
    return JSON.stringify({ name: this.name, rows: trimGrid(this.grid) }, null, 2)
  }

  importJson(text: string): boolean {
    try {
      const l = JSON.parse(text) as ArkanoidLevel
      if (!Array.isArray(l.rows) || !l.rows.every(r => typeof r === 'string')) return false
      this.name = typeof l.name === 'string' ? l.name : 'Imported'
      this.grid = toGrid(l.rows)
      return true
    } catch { return false }
  }
}

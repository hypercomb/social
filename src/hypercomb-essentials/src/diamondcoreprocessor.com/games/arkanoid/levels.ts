// diamondcoreprocessor.com/games/arkanoid/levels.ts
//
// Built-in brick layouts. Each level is an array of rows; every row is up to
// COLS (11) characters. Chars: '.' / ' ' = empty, '1'..'4' = brick hit-points
// (also picks its colour), '*' = a tough 4-hp brick. Engine.#build reads these.

export interface ArkanoidLevel {
  readonly name: string
  readonly rows: readonly string[]
}

export const LEVELS: readonly ArkanoidLevel[] = [
  {
    name: 'Warmup',
    rows: [
      '11111111111',
      '22222222222',
      '11111111111',
    ],
  },
  {
    name: 'Pyramid',
    rows: [
      '.....1.....',
      '....222....',
      '...33333...',
      '..4444444..',
      '.222222222.',
    ],
  },
  {
    name: 'Fortress',
    rows: [
      '*1111111*',
      '*.......*',
      '*.33333.*',
      '*.3***3.*',
      '*.33333.*',
      '*1111111*',
    ].map(r => r.padEnd(11, '.')),
  },
  {
    name: 'Checkers',
    rows: [
      '1.2.3.2.1.2',
      '.2.3.4.3.2.',
      '3.4.*.4.3.4',
      '.2.3.4.3.2.',
      '1.2.3.2.1.2',
    ],
  },
]

export function cloneLevel(l: ArkanoidLevel): ArkanoidLevel {
  return { name: l.name, rows: [...l.rows] }
}

// ── designer dimensions + custom-level store ────────────────
//
// The designer paints a fixed grid; custom levels live in localStorage — the
// same class of participant-local UI data as screensaver prefs / accent colour,
// NOT layer state (a level in the layer would skew the lineage signature across
// peers, the rule that keeps viewport + clipboard out of history).

export const EDIT_COLS = 11   // matches engine COLS
export const EDIT_ROWS = 12

const STORE_KEY = 'hc:arkanoid-levels'

/** A blank grid (all empty) ready for the designer. */
export function emptyLevel(name: string): ArkanoidLevel {
  return { name, rows: Array.from({ length: EDIT_ROWS }, () => '.'.repeat(EDIT_COLS)) }
}

function isValid(l: unknown): l is ArkanoidLevel {
  if (!l || typeof l !== 'object') return false
  const d = l as Record<string, unknown>
  return typeof d['name'] === 'string'
    && Array.isArray(d['rows'])
    && d['rows'].every(r => typeof r === 'string')
}

export function loadCustomLevels(): ArkanoidLevel[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(isValid).map(cloneLevel) : []
  } catch { return [] }
}

export function saveCustomLevels(levels: ArkanoidLevel[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(levels)) } catch { /* quota / disabled */ }
}

/** Insert or replace a custom level by name. Returns the new list. */
export function upsertCustomLevel(level: ArkanoidLevel): ArkanoidLevel[] {
  const levels = loadCustomLevels()
  const i = levels.findIndex(l => l.name === level.name)
  if (i >= 0) levels[i] = level
  else levels.push(level)
  saveCustomLevels(levels)
  return levels
}

export function deleteCustomLevel(name: string): ArkanoidLevel[] {
  const levels = loadCustomLevels().filter(l => l.name !== name)
  saveCustomLevels(levels)
  return levels
}

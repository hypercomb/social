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

  // ── Creative pack (designed by a level-design workflow, ordered easy→hard).
  //    Play picks levels at random, so this ordering only affects manual nav.
  {
    name: 'Spectrum Bands',
    rows: [
      '.111111111.',
      '.111111111.',
      '.222222222.',
      '.222222222.',
      '.333333333.',
      '.333333333.',
      '.444444444.',
      '.444444444.',
    ],
  },
  {
    name: 'Pillar Tunnels',
    rows: [
      '*.*.*.*.*.*',
      '4.4.4.4.4.4',
      '3.3.3.3.3.3',
      '3.3.3.3.3.3',
      '2.2.2.2.2.2',
      '2.2.2.2.2.2',
      '1.1.1.1.1.1',
      '1.1.1.1.1.1',
    ],
  },
  {
    name: 'Iron Anchor',
    rows: [
      '....3......',
      '...3.3.....',
      '....3......',
      '..33333....',
      '....3......',
      '....3......',
      '....3......',
      '.4..3..4...',
      '.4..3..4...',
      '.44...44...',
      '..44444....',
    ],
  },
  {
    name: 'Northern Star',
    rows: [
      '....4......',
      '....4......',
      '.4444444...',
      '..44444....',
      '...444.....',
      '..44.44....',
      '.44...44...',
    ],
  },
  {
    name: 'Diagonal Drift',
    rows: [
      '1...2...3..',
      '.1...2...3.',
      '..1...2...3',
      '3..1...2...',
      '*3..1...2..',
      '.*3..1...2.',
      '..*3..1...2',
      '...*3..1...',
    ],
  },
  {
    name: 'The Ascent',
    rows: [
      '*..........',
      '44.........',
      '144........',
      '.144.......',
      '..144......',
      '...144.....',
      '....144....',
      '.....144...',
      '......144..',
      '.......144.',
      '........144',
    ],
  },
  {
    name: 'Space Invader',
    rows: [
      '...3...3...',
      '....3.3....',
      '..3333333..',
      '.33.333.33.',
      '33333333333',
      '3.3333333.3',
      '3.3.....3.3',
      '...33.33...',
    ],
  },
  {
    name: 'WIN',
    rows: [
      '1.1.2.2.4.4',
      '1.1.2.2.4.4',
      '1.1.2.2.*.4',
      '1.1.2.2.4*4',
      '1.1.2.2.4.*',
      '1.1.2.2.4.4',
      '*1*.2.2.4.4',
      '.*..2.2.4.4',
    ],
  },
  {
    name: 'Heart Eyes',
    rows: [
      '..4......4.',
      '.4*4....4*4',
      '.4*4....4*4',
      '..4......4.',
      '...........',
      '...........',
      '.2.......2.',
      '.2.......2.',
      '..2.....2..',
      '...22222...',
    ],
  },
  {
    name: 'Plus Equals',
    rows: [
      '....3......',
      '....3......',
      '.333333333.',
      '....3......',
      '....3......',
      '...........',
      '.22222222..',
      '.22222222..',
    ],
  },
  {
    name: 'Letter H',
    rows: [
      '.3......3..',
      '.3......3..',
      '.3......3..',
      '.3......3..',
      '.3*2222*3..',
      '.3*2222*3..',
      '.3......3..',
      '.3......3..',
      '.3......3..',
      '.3......3..',
    ],
  },
  {
    name: 'Koi Drift',
    rows: [
      '...2222....',
      '..222222*..',
      '.22222222.4',
      '22222*2224.',
      '.22222222.4',
      '..222222*..',
      '...2222....',
    ],
  },
  {
    name: 'Crossfire X',
    rows: [
      '4.........4',
      '.4.......4.',
      '..4.....4..',
      '...3...3...',
      '....2.2....',
      '.....*.....',
      '....2.2....',
      '...3...3...',
      '..4.....4..',
      '.4.......4.',
      '4.........4',
    ],
  },
  {
    name: 'Radiant Plus',
    rows: [
      '....4.4....',
      '....414....',
      '....414....',
      '44441.14444',
      '.11111111.1',
      '44441.14444',
      '....414....',
      '....414....',
      '....4.4....',
    ],
  },
  {
    name: 'Bloom',
    rows: [
      '....333....',
      '...32223...',
      '..3322233..',
      '.333*2*333.',
      '..3322233..',
      '...32223...',
      '....333....',
      '....111....',
      '....111....',
      '...11111...',
    ],
  },
  {
    name: 'Old Oak',
    rows: [
      '...13331...',
      '..1333331..',
      '.133313331.',
      '..1333331..',
      '...13331...',
      '....444....',
      '....444....',
      '....444....',
      '...44444...',
      '..4444444..',
    ],
  },
  {
    name: 'Concentric Rhombus',
    rows: [
      '.....4.....',
      '....434....',
      '...43234...',
      '..4321234..',
      '.4321.1234.',
      '4321...1234',
      '.4321.1234.',
      '..4321234..',
      '...43234...',
      '....434....',
      '.....4.....',
    ],
  },
  {
    name: 'Hex Ring Core',
    rows: [
      '...44444...',
      '..4.....4..',
      '.4..333..4.',
      '4..3...3..4',
      '4..3.*.3..4',
      '4..3...3..4',
      '.4..333..4.',
      '..4.....4..',
      '...44444...',
    ],
  },
  {
    name: 'Nested Bastion',
    rows: [
      '.444444444.',
      '.4........4',
      '.4.33333.4.',
      '.4.3...3.4.',
      '.4.3.*.3.4.',
      '.4.3...3.4.',
      '.4.33333.4.',
      '.4........4',
      '.444444444.',
    ],
  },
  {
    name: 'The Moat',
    rows: [
      '***********',
      '*.........*',
      '*.2.2.2.2.*',
      '*.3.....3.*',
      '*.2.444.2.*',
      '*.3.....3.*',
      '*.2.2.2.2.*',
      '*.........*',
      '***********',
    ],
  },
  {
    name: 'Halo Boss',
    rows: [
      '...11111...',
      '..1.....1..',
      '.1..333..1.',
      '.1..3*3..1.',
      '.1..333..1.',
      '.1.......1.',
      '..1.....1..',
      '...11111...',
    ],
  },
  {
    name: 'Woven Loom',
    rows: [
      '2.1.2.1.2.1',
      '1.2.*.2.1.2',
      '2.*.2.2.*.2',
      '1.2.2.2.2.1',
      '2.*.2.2.*.2',
      '1.2.*.2.1.2',
      '2.1.2.1.2.1',
    ],
  },
  {
    name: 'Maze Sliver',
    rows: [
      '*4*4*4*4*4*',
      '*.......*.*',
      '*.*****.*.*',
      '*.*...*.*.*',
      '*.*.*.*.*.*',
      '*.*.*...*.*',
      '*.*.*****.*',
      '*.*.......*',
      '*.*4*4*4*4*',
    ],
  },
  {
    name: 'Summit Range',
    rows: [
      '.....*.....',
      '....3*3....',
      '...33*33...',
      '..3*33*3*..',
      '.3*3333*33.',
      '33334*43333',
      '44444444444',
    ],
  },
  {
    name: 'Buried Core',
    rows: [
      '...*****...',
      '..*333*....',
      '.*33233*...',
      '*3324233*..',
      '*332*233*..',
      '*3324233*..',
      '.*33233*...',
      '..*333*....',
      '...*****...',
    ],
  },
  {
    name: 'The Funnel',
    rows: [
      '***********',
      '*4.......4*',
      '.*3.....3*.',
      '..*2...2*..',
      '...*1.1*...',
      '....*1*....',
      '.....*.....',
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

// toGrid already clamps any imported level to EDIT_ROWS × EDIT_COLS of
// whitelisted chars before it reaches the engine, but cap the raw shape here too
// so a tampered store entry can't sit in memory as a giant array of long strings.
const MAX_RAW_ROWS = 64
const MAX_RAW_LINE = 64

function isValid(l: unknown): l is ArkanoidLevel {
  if (!l || typeof l !== 'object') return false
  const d = l as Record<string, unknown>
  return typeof d['name'] === 'string'
    && Array.isArray(d['rows']) && d['rows'].length <= MAX_RAW_ROWS
    && d['rows'].every(r => typeof r === 'string' && r.length <= MAX_RAW_LINE)
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

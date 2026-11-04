// presentation/tiles/layout-report.spec.ts
//
// THE SEATING PASS SAYS ONE SHORT LINE. The full per-tile listing printed on
// every layout (192 cells, ~3,000 characters, twice per page) buried the one
// thing the diagnosis is for: the tile that misses the first paint. Counts
// always; names only for the misses; the whole grid only under hc:verbose.

import { describe, expect, it } from 'vitest'
import { layoutReport } from './layout-report.js'

const grid = (n: number): string[] => Array.from({ length: n }, (_, i) => `cell-${String(i).padStart(3, '0')}→${i}`)

describe('the layout report', () => {
  it('says the counts in one short line, whatever the grid size', () => {
    const scoreFilled = grid(192)
    const lines = layoutReport({ indexed: [], scoreFilled, pile: scoreFilled.map(e => e.split('→')[0]), maxSlot: 191 })
    expect(lines).toEqual(['[layout] 192 seated: 0 indexed, 192 score-filled'])
    expect(lines[0].length).toBeLessThan(80)
  })

  it('names only the tiles that miss the first paint', () => {
    const lines = layoutReport({
      indexed: ['viewer@0', 'embers@1'],
      scoreFilled: ['late→61', 'fine→2'],
      pile: ['late', 'fine', 'homeless'],
      maxSlot: 60,
    })
    expect(lines).toEqual([
      '[layout] 4 seated: 2 indexed, 2 score-filled',
      '[layout] misses first paint — past slot 60: late→61; no seat (grid full): homeless',
    ])
  })

  it('lists every seat only when asked (hc:verbose)', () => {
    const r = { indexed: ['viewer@0'], scoreFilled: ['a→1', 'b→2'], pile: ['a', 'b'], maxSlot: 60 }
    expect(layoutReport(r)).toHaveLength(1)
    expect(layoutReport({ ...r, verbose: true })).toEqual([
      '[layout] 3 seated: 1 indexed, 2 score-filled',
      '[layout] indexed: viewer@0 | score-filled: a→1, b→2',
    ])
    expect(layoutReport({ indexed: [], scoreFilled: [], pile: [], maxSlot: 60, verbose: true })[1])
      .toBe('[layout] indexed: (none) | score-filled: (none)')
  })
})

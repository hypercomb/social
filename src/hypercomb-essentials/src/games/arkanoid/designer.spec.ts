// games/arkanoid/designer.spec.ts
//
// The level designer's pure logic: painting and erasing bricks, normalising a
// level to the 12 x 11 grid, trimming a saved level, JSON export / import, and
// that what it hands out plays in the engine. The DOM toolbar lives in
// overlay.ts and is not driven here.

import { describe, expect, it } from 'vitest'
import { Designer, TOOLS, type Tool } from './designer.js'
import { EDIT_COLS, EDIT_ROWS, emptyLevel } from './levels.js'
import { Engine } from './engine.js'

const blank = '.'.repeat(EDIT_COLS)

describe('Arkanoid designer', () => {
  it('starts as a blank "My Level" on the full grid with the 1-hp brick tool', () => {
    const d = new Designer()
    expect(d.name).toBe('My Level')
    expect(d.tool).toBe('1')
    expect(d.grid).toHaveLength(EDIT_ROWS)
    expect(d.grid.every(r => r === blank)).toBe(true)
  })

  it('offers six tools: four brick strengths, a barrier and an eraser', () => {
    expect(TOOLS.map(t => t.tool)).toEqual(['1', '2', '3', '4', '#', 'erase'])
    for (const t of TOOLS) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  describe('painting', () => {
    it('paints one cell with the current tool and reports the change', () => {
      const d = new Designer()
      expect(d.paint(3, 2)).toBe(true)
      expect(d.grid[2][3]).toBe('1')
      expect(d.grid[2].length).toBe(EDIT_COLS)
    })

    it('paints each tool\'s own character', () => {
      const d = new Designer()
      const tools: Tool[] = ['1', '2', '3', '4', '#']
      tools.forEach((tool, col) => { d.setTool(tool); d.paint(col, 0) })
      expect(d.grid[0].slice(0, 5)).toBe('1234#')
    })

    it('reports no change when the cell already holds that brick', () => {
      const d = new Designer()
      d.paint(0, 0)
      expect(d.paint(0, 0)).toBe(false)
    })

    it('overwrites a brick with a different tool', () => {
      const d = new Designer()
      d.paint(4, 4)
      d.setTool('3')
      expect(d.paint(4, 4)).toBe(true)
      expect(d.grid[4][4]).toBe('3')
    })

    it('erase removes a brick, and erasing an empty cell changes nothing', () => {
      const d = new Designer()
      d.paint(5, 5)
      d.setTool('erase')
      expect(d.paint(5, 5)).toBe(true)
      expect(d.grid[5][5]).toBe('.')
      expect(d.paint(5, 5)).toBe(false)
    })

    it('ignores cells off the grid', () => {
      const d = new Designer()
      const before = d.grid.slice()
      for (const [c, r] of [[-1, 0], [EDIT_COLS, 0], [0, -1], [0, EDIT_ROWS], [99, 99]]) {
        expect(d.paint(c, r)).toBe(false)
      }
      expect(d.grid).toEqual(before)
    })

    it('paints the last cell of the grid', () => {
      const d = new Designer()
      expect(d.paint(EDIT_COLS - 1, EDIT_ROWS - 1)).toBe(true)
      expect(d.grid[EDIT_ROWS - 1].endsWith('1')).toBe(true)
    })

    it('only touches the one cell', () => {
      const d = new Designer()
      d.setTool('2')
      d.paint(6, 7)
      const painted = d.grid.flatMap((row, r) => [...row].map((ch, c) => ch !== '.' ? `${c},${r}` : '')).filter(Boolean)
      expect(painted).toEqual(['6,7'])
    })
  })

  describe('loading a level', () => {
    it('normalises ragged rows to the full grid, padding with empties', () => {
      const d = new Designer({ name: 'Short', rows: ['11', '2'] })
      expect(d.grid).toHaveLength(EDIT_ROWS)
      expect(d.grid[0]).toBe('11' + '.'.repeat(EDIT_COLS - 2))
      expect(d.grid[1]).toBe('2' + '.'.repeat(EDIT_COLS - 1))
      expect(d.grid[2]).toBe(blank)
    })

    it('truncates rows past the grid width and drops rows past the grid height', () => {
      const d = new Designer({ name: 'Big', rows: Array.from({ length: 20 }, () => '1'.repeat(20)) })
      expect(d.grid).toHaveLength(EDIT_ROWS)
      expect(d.grid.every(r => r === '1'.repeat(EDIT_COLS))).toBe(true)
    })

    it('turns * into a 4-hp brick and unknown characters into empties, keeping barriers', () => {
      const d = new Designer({ name: 'Mixed', rows: ['*x 5#a1'] })
      expect(d.grid[0].slice(0, 7)).toBe('4...#.1')
    })

    it('setLevel swaps in another level', () => {
      const d = new Designer()
      d.paint(0, 0)
      d.setLevel({ name: 'Other', rows: ['..3'] })
      expect(d.name).toBe('Other')
      expect(d.grid[0][2]).toBe('3')
      expect(d.grid[0][0]).toBe('.')
    })

    it('newLevel clears the canvas and takes a name (default "My Level")', () => {
      const d = new Designer()
      d.paint(1, 1)
      d.newLevel('Fresh')
      expect(d.name).toBe('Fresh')
      expect(d.grid.every(r => r === blank)).toBe(true)
      d.newLevel()
      expect(d.name).toBe('My Level')
    })

    it('can be seeded from emptyLevel', () => {
      const d = new Designer(emptyLevel('Seeded'))
      expect(d.name).toBe('Seeded')
      expect(d.grid.every(r => r === blank)).toBe(true)
    })

    it('does not alias the source rows', () => {
      const rows = ['111']
      const d = new Designer({ name: 'A', rows })
      d.setTool('erase'); d.paint(0, 0)
      expect(rows[0]).toBe('111')
    })
  })

  describe('saving a level (named)', () => {
    it('trims trailing empty rows and renames', () => {
      const d = new Designer()
      d.paint(0, 0); d.paint(2, 1)
      const out = d.named('  Pyramid  ')
      expect(out.name).toBe('Pyramid')
      expect(out.rows).toEqual(['1' + '.'.repeat(EDIT_COLS - 1), '..1' + '.'.repeat(EDIT_COLS - 3)])
      expect(d.name).toBe('Pyramid')
    })

    it('keeps interior empty rows', () => {
      const d = new Designer()
      d.paint(0, 0); d.paint(0, 3)
      expect(d.named('Gap').rows).toHaveLength(4)
    })

    it('an empty canvas still saves one row', () => {
      expect(new Designer().named('Void').rows).toEqual([blank])
    })

    it('a blank name becomes Untitled', () => {
      const d = new Designer()
      expect(d.named('   ').name).toBe('Untitled')
      expect(d.named('').name).toBe('Untitled')
    })

    it('does not alter the working grid', () => {
      const d = new Designer()
      d.paint(0, 0)
      d.named('Keep')
      expect(d.grid).toHaveLength(EDIT_ROWS)
    })
  })

  describe('JSON export / import', () => {
    it('round-trips a level', () => {
      const a = new Designer()
      a.paint(0, 0); a.setTool('#'); a.paint(5, 2); a.setTool('4'); a.paint(10, 3)
      a.name = 'Round Trip'
      const b = new Designer()
      expect(b.importJson(a.exportJson())).toBe(true)
      expect(b.name).toBe('Round Trip')
      expect(b.grid).toEqual(a.grid)
    })

    it('exports a trimmed document', () => {
      const d = new Designer()
      d.paint(0, 0)
      const doc = JSON.parse(d.exportJson()) as { name: string; rows: string[] }
      expect(doc.name).toBe('My Level')
      expect(doc.rows).toHaveLength(1)
    })

    it('imports a level without a name as "Imported"', () => {
      const d = new Designer()
      expect(d.importJson(JSON.stringify({ rows: ['1'] }))).toBe(true)
      expect(d.name).toBe('Imported')
    })

    it('rejects text that is not JSON, leaving the canvas untouched', () => {
      const d = new Designer()
      d.paint(0, 0)
      const before = d.grid.slice()
      expect(d.importJson('{nope')).toBe(false)
      expect(d.grid).toEqual(before)
    })

    it('rejects JSON without a rows array of strings', () => {
      const d = new Designer()
      d.paint(0, 0)
      const before = d.grid.slice()
      expect(d.importJson('{"name":"x"}')).toBe(false)
      expect(d.importJson('{"rows":"111"}')).toBe(false)
      expect(d.importJson('{"rows":[1,2,3]}')).toBe(false)
      expect(d.importJson('null')).toBe(false)
      expect(d.grid).toEqual(before)
      expect(d.name).toBe('My Level')
    })

    it('cleans an imported grid the same way as a loaded one', () => {
      const d = new Designer()
      d.importJson(JSON.stringify({ name: 'Dirty', rows: ['*q9' + '1'.repeat(30)] }))
      expect(d.grid[0]).toBe('4..' + '1'.repeat(EDIT_COLS - 3))
    })
  })

  describe('validating a level for play', () => {
    const playable = (d: Designer) => new Engine(d.named('T').rows)

    it('a painted level plays in the engine with the same bricks', () => {
      const d = new Designer()
      d.paint(0, 0); d.setTool('3'); d.paint(10, 1); d.setTool('#'); d.paint(5, 2)
      const g = playable(d)
      expect(g.bricks).toHaveLength(3)
      expect(g.bricksLeft).toBe(2)                           // the barrier never counts
      expect(g.bricks.find(b => b.col === 10)!.hp).toBe(3)
      expect(g.bricks.find(b => b.col === 5)!.unbreakable).toBe(true)
    })

    it('an empty canvas has nothing to clear (so a test play is already cleared)', () => {
      expect(playable(new Designer()).bricksLeft).toBe(0)
    })

    it('a barrier-only canvas also has nothing to clear', () => {
      const d = new Designer()
      d.setTool('#'); d.paint(3, 3)
      expect(playable(d).bricksLeft).toBe(0)
    })
  })
})

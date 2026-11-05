// move-lanes-swap.spec.ts — in lanes a drag only swaps (jwize 2026-11-05:
// "there is not move only swap and if you drop outside it should return
// immediately to its spot … the non tile area should not show as a drop target
// when in lanes").
//
// The lanes grid has one slot per tile, so every spot that is not a tile is off
// the grid. Hovering one used to drop the dragged tile out of the preview, and
// a drop there wrote an order. Now the preview shows every tile home, the drop
// writes nothing and paints home at once, and the free map keeps its moves.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const MOVE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'move.drone.ts'), 'utf8')
const between = (from: string, to: string): string => {
  const start = MOVE.indexOf(from)
  return start < 0 ? '' : MOVE.slice(start, MOVE.indexOf(to, start + from.length))
}

describe('a drag in lanes only swaps', () => {
  it('lands only where every dragged tile meets a tile, and only in lanes', () => {
    const rule = between('  #swapLands(', '\n  }\n')
    expect(rule).toMatch(/if \(!getLaneScrollAxis\(\)\) return true/)
    expect(rule).toMatch(/for \(const label of this\.#movedGroup\.keys\(\)\)/)
    expect(rule).toMatch(/if \(!to \|\| !this\.#occupancy\.has\(axialKey\(to\.q, to\.r\)\)\) return false/)
  })

  it('shows every tile home while the pointer is off a tile — nothing lights up as a landing', () => {
    const hover = between('  updateMove = ', '  setDropIntoActive = ')
    expect(hover).toMatch(/this\.#reorderNames\(this\.#swapLands\(placements\) \? placements : new Map\(\)\)/)
  })

  it('a drop off a tile writes nothing and paints the tiles home at once', () => {
    const drop = between('  commitMoveAt = ', '  commitDropInto = ')
    expect(drop).toMatch(/if \(this\.#swapLands\(placements\)\) didCommit = await this\.#commitPlacements\(placements\)/)
    expect(drop).toMatch(/this\.emitEffect\('move:preview', \{ names: this\.#reorderNames\(new Map\(\)\), movedLabels: new Set\(this\.#movedGroup\.keys\(\)\) \}\)\s*this\.emitEffect\('move:preview', null\)/)
  })
})

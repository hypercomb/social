// Exact regression: /friends/jaime and /team/jaime are two appearances in the
// same name pool. Their selected images are allowed to differ. ShowCellDrone
// cannot be constructed cheaply in a unit test (Pixi + OPFS + IoC), so this
// pins the source seam exactly as the existing cells-key ratchets do.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

const memberBody = (marker: string): string => {
  const lines = SRC.split('\n')
  const start = lines.findIndex(line => line.includes(marker))
  expect(start, `member not found: ${marker}`).toBeGreaterThan(-1)
  let open = start
  while (open < lines.length && !lines[open].trimEnd().endsWith('{')) open++
  const out: string[] = []
  for (let i = open + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

describe('show-cell same name across lineages', () => {
  it('moves every label-derived cache and title glyph to the incoming lineage', () => {
    const body = memberBody('#enterDerivedLocation = (locationKey: string): void =>')
    expect(body).toMatch(/locationKey === this\.#derivedLocationKey/)
    expect(body).toMatch(/this\.#derivedLocationKey = locationKey/)
    expect(body).toMatch(/this\.#invalidateAllLabelDerivedState\(\)/)
    expect(body).toMatch(/this\.atlas\?\.invalidateLabels\(\)/)
  })

  it('resets before the back-navigation cache can reuse a raw jaime key', () => {
    const reset = SRC.indexOf('this.#enterDerivedLocation(locationKey)')
    const backNav = SRC.indexOf('// ── back-nav fast path')
    expect(reset).toBeGreaterThan(-1)
    expect(backNav).toBeGreaterThan(reset)
  })
})

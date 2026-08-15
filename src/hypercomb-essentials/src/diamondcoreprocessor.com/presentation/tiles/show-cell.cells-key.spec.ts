// show-cell.cells-key.spec.ts — the cells key and the atlas generations must stay apart.
//
// THE BUG THIS PINS DOWN. A tile's label glyphs live in an atlas slot; the
// geometry buffer holds the UV rect pointing at that slot. When a slot is
// wiped (retitle → invalidateLabel, locale flip, pivot) or handed to another
// label (ring eviction), every UV baked against it is stale, and the ONLY cure
// is a geometry rebuild — applyGeometry is the one place that re-bakes and
// re-points every cell. The atlas signals this with `evictionGeneration`.
//
// That signal used to be folded into buildCellsKey. But the cells key is
// recomputed WHOLESALE by two in-place fast paths that touch one attribute and
// rebuild nothing — #repaintReadinessInPlace (aShaded flip) and
// #tryInPlaceCellUpdate (one cell on tile:saved). Either one landing between
// the wipe and the repaint stamped the new generation into renderedCellsKey,
// so the pending pass found its key unchanged, took applyGeometry's
// early-return, and the wiped slots were never re-baked. On screen: those
// tiles kept their label BAND with no name inside it — the shader gates the
// band on the UV rect, which is still valid; only the pixels behind it are
// gone. Permanent, for exactly the tiles whose slots were wiped.
//
// So: generations live in #bakedImageAtlasGen / #bakedLabelAtlasGen, written
// ONLY where geometry is actually built, and checked separately. These are
// source-shape ratchets because ShowCellDrone cannot be stood up in a unit
// test (Pixi renderer, IoC, OPFS); they guard the seam, not the pixels.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** The body of one class member, comments stripped. Collection opens at the
 *  member's `{` (a signature may wrap over several lines) and closes at the
 *  next line with a non-space in column 3 — the member's own closing brace,
 *  since members sit at two-space indent and their bodies deeper. */
const memberBody = (marker: string): string => {
  const lines = SRC.split('\n')
  const start = lines.findIndex(l => l.includes(marker))
  expect(start, `member not found: ${marker}`).toBeGreaterThan(-1)
  let open = start
  while (open < lines.length && !lines[open].trimEnd().endsWith('{')) open++
  expect(open, `member body never opens: ${marker}`).toBeLessThan(lines.length)
  const out: string[] = []
  for (let i = open + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break
    out.push(lines[i])
  }
  return stripComments(out.join('\n'))
}

describe('show-cell: cells key vs atlas generations', () => {

  it('buildCellsKey describes cells only — no atlas eviction generation', () => {
    const body = memberBody('private buildCellsKey = (cells: Cell[]): string =>')

    // The in-place fast paths recompute this key wholesale. Anything folded in
    // here is something they can mark as applied without applying it.
    expect(body).not.toMatch(/evictionGeneration/)
  })

  it('applyGeometry gates its early-return on both baked generations', () => {
    const body = memberBody('private readonly applyGeometry = async (cells: Cell[]')

    expect(body).toMatch(/nextImageAtlasGen === this\.#bakedImageAtlasGen/)
    expect(body).toMatch(/nextLabelAtlasGen === this\.#bakedLabelAtlasGen/)
    // Read from the atlases at the same point the key is taken, so a bake that
    // evicts mid-pass leaves the pair behind and the next pass rebuilds.
    expect(body).toMatch(/nextLabelAtlasGen = this\.atlas\?\.evictionGeneration/)
    expect(body).toMatch(/nextImageAtlasGen = this\.imageAtlas\?\.evictionGeneration/)
  })

  it('the in-place fast paths claim no generation they did not bake', () => {
    for (const marker of [
      '#repaintReadinessInPlace = (): boolean =>',
      'readonly #tryInPlaceCellUpdate = async (',
    ]) {
      const body = memberBody(marker)
      // Both legitimately re-state renderedCellsKey — they DID rewrite the
      // attributes it covers. Neither re-bakes a label, so neither may retire
      // a pending rebake.
      expect(body, marker).toMatch(/this\.renderedCellsKey = this\.buildCellsKey\(/)
      expect(body, marker).not.toMatch(/#baked(Image|Label)AtlasGen\s*=/)
    }
  })

  it('a baked generation is written only where geometry is built or discarded', () => {
    // applyGeometry's success path stamps the pair; clearMesh and the
    // atlas-swap invalidation reset it to -1 (never a live generation, so the
    // next pass always rebuilds). Three writers, no more.
    const writers = [...SRC.matchAll(/this\.#bakedLabelAtlasGen = /g)]

    expect(writers).toHaveLength(3)
  })
})

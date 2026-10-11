// show-cell.label-view.spec.ts — a page with more names than label slots
// (SCALE-1), and a page of peer pictures arriving at once (SCALE-3).
//
// SCALE-1. applyGeometry pinned EVERY cell of the layer in the 256-slot label
// atlas before baking. Past 256 names every slot was pinned, the atlas evicted
// a pinned label anyway and announced it, #onLabelAtlasEvicted repainted to
// heal the on-screen victim, and that repaint's bake evicted the next one — a
// 307-name page spent 72 s of 74 s in buildSdfCell, its own new tile took 6.4 s
// to appear and never reached the room. The atlas half (no slot, no eviction
// when every slot is pinned) is pinned by hex-label.atlas.spec.ts. This file
// pins the renderer half: an oversized layer pins only what is in view, bakes
// only that, never claims a slot for an out-of-view cell, and a settled
// gesture repaints when it brings unslotted cells into view. A layer that fits
// is untouched (the view is null and every cell pins and bakes as before).
//
// SCALE-3 (render half). fillFromHost started every missing peer picture's
// fetch at once — each an HTTP probe plus a mesh ask on the one relay socket —
// so arriving on a picture-rich page spent the connection's whole frame budget
// in a second. At most #HOST_FILL_CONCURRENCY fills now run; the rest queue.
//
// Source-shape ratchets, like show-cell.cells-key.spec.ts: ShowCellDrone cannot
// be stood up in a unit test (Pixi renderer, IoC, OPFS). The behaviour is
// proven by the focused-pics drill (307 / 987 peer tiles) — see the lane report.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** The body of one class member, comments stripped (see cells-key spec). */
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

describe('show-cell: an oversized layer pins and bakes only what is in view (SCALE-1)', () => {
  const applyGeometry = memberBody('private readonly applyGeometry = async (cells: Cell[], final = true)')

  it('pins the view, not every cell, before the bake', () => {
    expect(applyGeometry).toMatch(/const view = this\.#labelViewFor\(cells\)/)
    expect(applyGeometry).toMatch(/this\.atlas\.setPinned\(\[\.\.\.\(view \?\? cells\.map\(c => c\.label\)\), PENDING_CELL_LABEL\]\)/)
    // The old line pinned the whole layer unconditionally.
    expect(applyGeometry).not.toMatch(/this\.atlas\.setPinned\(\[\.\.\.cells\.map\(c => c\.label\), PENDING_CELL_LABEL\]\)/)
    const pin = applyGeometry.indexOf('this.atlas.setPinned(')
    const bake = applyGeometry.indexOf('this.atlas.getLabelUV(label)')
    expect(pin).toBeGreaterThan(-1)
    expect(bake).toBeGreaterThan(pin)
  })

  it('skips the bake for an out-of-view cell', () => {
    const loop = applyGeometry.slice(applyGeometry.indexOf('for (const cell of cells)'), applyGeometry.indexOf('this.atlas.getLabelUV(label)'))
    expect(loop).toMatch(/if \(view && !view\.has\(cell\.label\)\) continue/)
  })

  it('a layer that fits keeps today\'s rule — every cell pinned', () => {
    const body = memberBody('#labelViewFor(cells: readonly Cell[]): Set<string> | null')
    expect(body).toMatch(/cells\.length \+ 1 <= atlas\.capacity\) return null/)
  })

  it('an out-of-view cell never claims a slot while the geometry is built', () => {
    const body = memberBody('private buildFillQuadGeometry(')
    expect(body).toMatch(/const unbaked = !foreign && !!this\.#labelView && !this\.#labelView\.has\(c\.label\) && !this\.atlas!\.hasLabel\(atlasLabel\)/)
    expect(body).toMatch(/\|\| unbaked\s*\n?\s*\? \{ u0: 0, v0: 0, u1: 0, v1: 0 \}/)
  })

  it('a settled gesture rebuilds when it brings unslotted cells into view', () => {
    expect(applyGeometry).toMatch(/&& !this\.#labelViewStale\s*\)/)
    expect(applyGeometry).toMatch(/this\.#labelViewStale = false/)
    const refresh = memberBody('#refreshLabelView = (): void =>')
    expect(refresh).toMatch(/if \(!atlas \|\| !pinned\) return/)
    expect(refresh).toMatch(/this\.#labelViewStale = true[\s\S]*this\.#forceNextRender = true[\s\S]*this\.requestRender\(\)/)
    expect(stripComments(SRC)).toMatch(/'viewport:persisted'[\s\S]{0,1500}this\.#refreshLabelView\(\)/)
  })

  it('the eviction repaint only answers for cells the paint pinned', () => {
    const body = memberBody('readonly #onLabelAtlasEvicted = (e?: Event): void =>')
    expect(body).toMatch(/if \(this\.#labelView && !this\.#labelView\.has\(c\.label\)\) continue/)
    expect(applyGeometry).toMatch(/\(!view \|\| view\.has\(c\.label\)\)\s*\n\s*&& !this\.#hidesName/)
  })

  it('an eviction the paint\'s own bake causes asks for no second paint', () => {
    // Witnessed before this guard: zooming into an 800-name page evicted
    // out-of-view labels mid-bake, the handler counted the same pass's
    // not-yet-baked cells as owed, spent the repaint bound and logged 28
    // "repaint bound reached" warnings.
    const body = memberBody('readonly #onLabelAtlasEvicted = (e?: Event): void =>')
    const guard = body.indexOf('if (this.#inPaintBake) return')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(body.indexOf('for (const c of this.renderedCells.values())'))
    const on = applyGeometry.indexOf('this.#inPaintBake = true')
    const bake = applyGeometry.indexOf('this.atlas.getLabelUV(label)')
    const build = applyGeometry.indexOf('this.buildFillQuadGeometry(cells')
    const off = applyGeometry.indexOf('this.#inPaintBake = false')
    expect(on).toBeGreaterThan(-1)
    expect(on).toBeLessThan(bake)
    expect(bake).toBeLessThan(build)
    expect(build).toBeLessThan(off)
    expect(applyGeometry.slice(build, off)).toMatch(/\}\s*finally\s*\{/)
  })

  it('a settled gesture that leaves the pinned view unchanged repaints nothing', () => {
    const refresh = memberBody('#refreshLabelView = (): void =>')
    expect(refresh).toMatch(/if \(!unslotted\) return/)
    expect(refresh).toMatch(/let same = view\.size === pinned\.size/)
    expect(refresh).toMatch(/if \(same\) return/)
  })
})

describe('show-cell: detached host fills run at most eight at a time (SCALE-3 render half)', () => {
  it('caps concurrent fills and queues the rest in arrival order', () => {
    expect(SRC).toMatch(/static readonly #HOST_FILL_CONCURRENCY = 8\b/)
    const loader = stripComments(SRC.slice(SRC.indexOf('private loadCellImages = async ('), SRC.indexOf('const livePropsIndex')))
    expect(loader).toMatch(/if \(this\.#hostFillInFlight\.has\(sig\) \|\| queued\?\.owner === cacheOwner\) return/)
    expect(loader).toMatch(/if \(this\.#hostFillActive >= ShowCellDrone\.#HOST_FILL_CONCURRENCY\) \{\s*this\.#hostFillQueue\.set\(sig, \{ owner: cacheOwner, start: \(\) => fillNow\(sig, label\) \}\)\s*return/)
    expect(loader).toMatch(/this\.#hostFillActive\+\+/)
    expect(loader).toMatch(/finally \{\s*this\.#hostFillInFlight\.delete\(sig\)\s*this\.#hostFillActive--\s*this\.#pumpHostFills\(\)/)
  })

  it('the pump starts queued fills only below the cap', () => {
    const body = memberBody('#pumpHostFills = (): void =>')
    expect(body).toMatch(/while \(this\.#hostFillActive < ShowCellDrone\.#HOST_FILL_CONCURRENCY && this\.#hostFillQueue\.size > 0\)/)
    expect(body).toMatch(/this\.#hostFillQueue\.delete\(sig\)/)
  })

  it('a fill queued by a page the participant has left is dropped at its turn — the page on screen never waits behind it', () => {
    const body = memberBody('#pumpHostFills = (): void =>')
    expect(body).toMatch(/if \(queued\.owner !== this\.#derivedLocationKey\) continue/)
    const loader = stripComments(SRC.slice(SRC.indexOf('private loadCellImages = async ('), SRC.indexOf('const livePropsIndex')))
    // wanted here too: this page takes the queued fill over
    expect(loader).toMatch(/if \(queued\) \{ queued\.owner = cacheOwner; queued\.start = \(\) => fillNow\(sig, label\); return \}/)
  })
})

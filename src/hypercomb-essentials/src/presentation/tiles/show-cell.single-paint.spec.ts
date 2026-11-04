// show-cell.single-paint.spec.ts — one render owner (single-paint.md V2, V3, V4).
//
// Source-shape ratchets, because ShowCellDrone cannot be stood up under vitest
// (Pixi renderer, IoC, OPFS). The ledger's decision is covered by
// show-cell.paint.spec.ts; this guards the seam between the ledger and the
// buffers: nothing writes a slot or pushes a buffer except through the
// ledger's two hands, every slot is written from the one plan, and the only
// page-wide invalidations are a location change and a layout-mode change.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const CODE = stripComments(SRC)

/** The body of one class member, comments stripped (see show-cell.cells-key.spec.ts). */
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

describe('show-cell: one render owner', () => {
  it('buffers are pushed only by the ledger (#pushAttrs) — one push per drain (V4)', () => {
    const calls = [...CODE.matchAll(/this\.#pushBuffer\(/g)]
    expect(calls).toHaveLength(1)
    expect(memberBody('readonly #pushAttrs = (attrs: readonly string[]): void =>')).toMatch(/this\.#pushBuffer\(attr\)/)
  })

  it('a slot is written only from its plan: the builder and the ledger\'s writer (V3)', () => {
    const calls = [...CODE.matchAll(/this\.#writeInto\(/g)]
    expect(calls).toHaveLength(2)
    expect(memberBody('private buildFillQuadGeometry(')).toMatch(/this\.#writeInto\(bufs, i, attr, plan\[attr\]\)/)
    expect(memberBody('readonly #writeAttr = (label: string, attr: string, values: readonly number[]): void =>')).toMatch(/this\.#writeInto\(this\.#buf, i, attr, values\)/)
    // The old per-slice helpers are gone; their strides live in #writeInto alone.
    expect(CODE).not.toMatch(/#writeCell(Scalar|Rgb|Vec4)\(/)
  })

  it('the plan is computed in one place and both writers read it (V1)', () => {
    expect([...CODE.matchAll(/this\.#slotPlanFor\(/g)]).toHaveLength(3)
    expect(memberBody('private buildFillQuadGeometry(')).toMatch(/const plan = this\.#slotPlanFor\(c, i, ctx\)/)
    expect(memberBody('#paintDirty(only?: Iterable<string>): DrainReport | null {')).toMatch(/this\.#slotPlanFor\(cell, i, ctx\)/)
    expect(memberBody('#drainAll(cells: Cell[], ctx: PlanContext): DrainReport {')).toMatch(/this\.#slotPlanFor\(cells\[i\], i, ctx\)/)
  })

  it('a full pass over retained buffers re-plans in place and skips unchanged keys (V3)', () => {
    const body = memberBody('private readonly applyGeometry = async (cells: Cell[]')
    expect(body).toMatch(/this\.#bufShape === this\.#bufShapeFor\(cells, ctx\)/)
    expect(body).toMatch(/this\.#drainAll\(cells, ctx\)/)
    // Converged: the ledger settles instead of a pass.
    expect(body).toMatch(/this\.#paint\.settle\(\)/)
  })

  it('#dirtyAll names only a location or a layout-mode change (V2)', () => {
    const reasons = [...CODE.matchAll(/this\.#dirtyAll\('([^']+)'\)/g)].map(m => m[1])
    expect(reasons.length).toBeGreaterThan(0)
    expect(new Set(reasons)).toEqual(new Set(['layout-mode']))
    // The location change is noted by the pass itself, on the ledger.
    expect(memberBody('private readonly renderFromSynchronize = async (): Promise<void> =>')).toMatch(/if \(locationKey !== this\.renderedLocationKey\) this\.#paint\.dirtyAll\('location'\)/)
    // The signature admits nothing else.
    expect(CODE).toMatch(/#dirtyAll\(reason: 'location' \| 'layout-mode'\): void/)
  })

  it('the named handlers dirty their cell and never wipe the page key', () => {
    for (const effect of ['tile:saved', 'title:indexed', 'reference:indexed', 'tags:changed', 'tile:root-default-changed', 'swarm:resource-arrived', 'substrate:rerolled', 'substrate:applied']) {
      const at = CODE.indexOf(`'${effect}', (`)
      expect(at, effect).toBeGreaterThan(-1)
      const handler = CODE.slice(at, CODE.indexOf('\n    })\n', at))
      expect(handler, effect).toMatch(/this\.#dirty(Fresh)?\(/)
      expect(handler, effect).not.toMatch(/renderedCellsKey = ''/)
      expect(handler, effect).not.toMatch(/#forceNextRender = true/)
      expect(handler, effect).not.toMatch(/requestRender\(\)/)
    }
  })

  it('an arrival dirties the cells holding its signature and nothing else (V5)', () => {
    const at = CODE.indexOf(`'swarm:resource-arrived', (`)
    const handler = CODE.slice(at, CODE.indexOf('\n    })\n', at))
    expect(handler).toMatch(/if \(cached === sig\) labels\.push\(label\)/)
    expect(handler).toMatch(/if \(labels\.length > 0\) this\.#dirty\(labels, 'swarm:resource-arrived'\)/)
    expect(handler).not.toMatch(/#layerCellsCache/)
  })

  it('the heat fade and the shade fade drain their cells once per frame (V4)', () => {
    expect(memberBody('#startNewCellFade = (label: string): void =>')).toMatch(/this\.#paintFrame\(frame\)/)
    expect(memberBody('#pumpShadeFade = (): void =>')).toMatch(/this\.#paintFrame\(frame\)/)
    expect(CODE).not.toMatch(/#updateCellHeat/)
  })

  it('the drain defers to a running pass — one writer at a time', () => {
    const body = memberBody('async #drainDirty(): Promise<void> {')
    expect(body).toMatch(/if \(this\.rendering \|\| this\.#renderScheduled \|\| this\.renderQueued \|\| this\.streamActive \|\| this\.#activeRenderTarget\) return/)
    expect(memberBody('private readonly requestRender = (): void =>')).toMatch(/if \(this\.#paint\.pending\) this\.#scheduleDrain\(\)/)
  })
})

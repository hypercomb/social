import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const VIEW_BEE = readFileSync(join(here, 'view.bee.ts'), 'utf8')

// A PUBLISHED LEAF OPENS AS ITS PAGE.
//
// The failure this pins, observed live on replication.hypercomb.com
// (2026-09-01): a publication whose branch root carries a page but NO child
// tiles rendered as a black screen. Nothing was broken — the visitor shell
// booted fully, the closure was complete on the host, every byte served 200.
// It was standing on a leaf with no hexagons to draw and no tile to click to
// reach the page, and the arrival arbiter had no mark telling it to open one.
// `axial yielded 0 cells` was the honest answer to the wrong question.
//
// The shape of the fix matters as much as the fix: it is a FALLBACK, not a
// rule. It fires only where there is no mark at all, only on a childless
// layer, and only in the published visitor shell.
describe('the arrival face of a published leaf', () => {
  it('falls back to the website view when a published leaf carries no mark', () => {
    expect(VIEW_BEE).toMatch(/const leafPublication =\s*!resolved && isPublishedVisitorShell\(\) && !hasChildren\(layer\)/)
    expect(VIEW_BEE).toMatch(/leafPublication \? WEBSITE_VIEW : ''/)
  })

  it('never overrides a mark — its own, an inherited one, or an explicit opt-out', () => {
    // `resolved` already carries the cascade (own mark, else nearest
    // ancestor). Gating on `!resolved` means a marked layer is untouched, and
    // `optedOut` (an explicit `hexagons` mark) still wins outright.
    expect(VIEW_BEE).toMatch(/optedOut \? '' : \(resolved \|\| \(leafPublication/)
  })

  it('is scoped to the visitor shell, never an authoring hive', () => {
    // Walking into a childless page tile in your own hive must keep opening
    // as hexagons: having it take the whole screen is a navigation change
    // nobody asked for. Publishing is what makes the page the point.
    expect(VIEW_BEE).toMatch(/isPublishedVisitorShell/)
    expect(VIEW_BEE).toMatch(/import \{[^}]*isPublishedVisitorShell[^}]*\} from '\.\.\/sharing\/behavior-enablement\.js'/)
  })

  it('reads children as real signatures, not merely a present key', () => {
    // An empty array, or a slot holding something that is not a sig, is not
    // "has children" — both would suppress the fallback and restore the
    // black screen.
    expect(VIEW_BEE).toMatch(/const hasChildren =[\s\S]{0,200}?SIG_RE\.test\(s\)/)
  })
})

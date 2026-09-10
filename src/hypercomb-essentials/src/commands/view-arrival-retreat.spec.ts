import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const VIEW_BEE = readFileSync(join(here, 'view.bee.ts'), 'utf8')

// BACKING OUT LETS THE PARENT DECIDE.
//
// The failure this pins (2026-09-10): standing in the square tile view and
// navigating back, the parent — which does not open as that view — still
// showed it. The view rode along because the toggle still reached the parent
// (branch scope) or because the participant had opened it themselves. Walking
// in, a surface rides along; walking back out, the destination's own face
// (its mark, the cascade, or hexagons) wins.
describe('the arrival face on a retreat', () => {
  it('recognises landing on an ancestor of the place just decided', () => {
    expect(VIEW_BEE).toMatch(/const retreat = prevKey !== null && prevKey !== key\s*&& \(key === '' \|\| prevKey\.startsWith\(key \+ SEGMENT_SEPARATOR\)\)/)
  })

  it('opens the ancestor\'s own face over whatever surface is up', () => {
    expect(VIEW_BEE).toMatch(/available && \(vm\.mode === DEFAULT_SURFACE \|\| vm\.mode === prevArrival \|\| retreat\)/)
  })

  it('releases any view to hexagons when the ancestor has no face', () => {
    expect(VIEW_BEE).toMatch(/!available && retreat && vm\.mode !== DEFAULT_SURFACE\) \{\s*(\/\/.*\s*)*this\.#releaseWhenPainted\(vm, vm\.mode\)/)
  })
})

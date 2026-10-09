// commands/view-default.spec.ts — the default-view toggle's one rule (`decideDefaultToggle`).
import { describe, it, expect, vi } from 'vitest'

vi.mock('./decoration-manifest.js', () => ({
  listDecorations: vi.fn(async () => []),
  removeDecorationAndWait: vi.fn(async () => undefined),
  replaceDecoration: vi.fn(async () => ''),
}))

const { decideDefaultToggle } = await import('./view-default.js')

// decideDefaultToggle(own mark, nearest ancestor's mark, view, has no children)
describe('decideDefaultToggle — one ctrl+click on a tile\'s view icon', () => {
  it('turns the view on when the tile opens as hexagons', () => {
    expect(decideDefaultToggle('', '', 'website', true)).toEqual({ write: 'website' })
  })

  it('turns it off by clearing when the tile has children and nothing above covers it', () => {
    expect(decideDefaultToggle('website', '', 'website', false)).toEqual({ clear: true })
  })

  it('writes the hexagons opt-out for a childless page, so visitors see hexagons too', () => {
    expect(decideDefaultToggle('website', '', 'website', true)).toEqual({ write: 'hexagons' })
  })

  it('writes the opt-out when an ancestor default would cascade back over it', () => {
    expect(decideDefaultToggle('website', 'slides', 'website', false)).toEqual({ write: 'hexagons' })
  })

  it('clears when the ancestor above already says hexagons', () => {
    expect(decideDefaultToggle('website', 'hexagons', 'website', false)).toEqual({ clear: true })
  })

  it('turns off a default the tile only inherits by writing the opt-out', () => {
    expect(decideDefaultToggle('', 'website', 'website', false)).toEqual({ write: 'hexagons' })
  })

  it('turns the view back on over an explicit hexagons opt-out', () => {
    expect(decideDefaultToggle('hexagons', 'website', 'website', false)).toEqual({ write: 'website' })
  })

  it('switches to a different view in one gesture', () => {
    expect(decideDefaultToggle('slides', '', 'website', false)).toEqual({ write: 'website' })
  })
})

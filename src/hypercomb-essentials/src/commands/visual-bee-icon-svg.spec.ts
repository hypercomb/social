import { describe, expect, it } from 'vitest'
import { visualBeeIconSvg } from './visual-bee-icon-svg.js'

const DECLARED_VIEW_ICONS = [
  ['living-brief', 'description'],
  ['lightbox', 'photo_library'],
  ['slides', 'slideshow'],
  ['evidence-atlas', 'hub'],
  ['knowledge-studio', 'view_carousel'],
  ['website', 'web'],
  ['tutor', 'school'],
  ['tree', 'account_tree'],
  ['workflow', 'conversion_path'],
] as const

describe('visual bee tile icons', () => {
  it('renders a distinct SVG for every declared behavior icon', () => {
    const icons = DECLARED_VIEW_ICONS.map(([view, toggleIcon]) =>
      visualBeeIconSvg(toggleIcon, view))
    expect(new Set(icons).size).toBe(DECLARED_VIEW_ICONS.length)
    expect(icons.every(icon => icon.includes('xmlns="http://www.w3.org/2000/svg"'))).toBe(true)
  })

  it('gives uncatalogued behaviors stable, distinct fallback marks', () => {
    expect(visualBeeIconSvg('future_mark', 'alpha'))
      .toBe(visualBeeIconSvg('future_mark', 'alpha'))
    expect(visualBeeIconSvg('future_mark', 'alpha'))
      .not.toBe(visualBeeIconSvg('future_mark', 'beta'))
  })
})

// editor/tile-look-overlay.spec.ts — the look layer draws ANY model's geometry.
//
// The fixtures are a circle and a square: no hexagon anywhere, so the layer is
// proven shape-agnostic. Every path it draws must be the geometry's own.

import { describe, expect, it } from 'vitest'
import { TILE_LOOK } from '../presentation/grid/tile-look.js'
import { EMPTY_TILE_GROUND, TileLookOverlay, type TileLook } from './tile-look-overlay.js'
import type { ModelGeometry } from './models/tile-model.js'

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`

const circleGeometry = (over: Partial<ModelGeometry> = {}): ModelGeometry => ({
  size: 400,
  variant: 'round',
  c: { x: 200, y: 200 },
  unit: 150,
  reach: 150,
  outline: circle(200, 200, 150),
  mask: circle(200, 200, 150),
  fade: true,
  box: { x: 50, y: 50, w: 300, h: 300, cx: 200, cy: 200 },
  extent: { min: 50, max: 350 },
  rimWidth: 3,
  glowInset: 4,
  glowWidth: 9,
  band: { x: 50, y: 180, w: 300, h: 40 },
  nameBox: { cx: 200, cy: 200, w: 220, h: 30 },
  nameFont: 18,
  capture: '300 x 300',
  inside: p => Math.hypot(p.x - 200, p.y - 200) <= 150,
  insideMask: p => Math.hypot(p.x - 200, p.y - 200) <= 150,
  edgeDistance: p => Math.abs(Math.hypot(p.x - 200, p.y - 200) - 150),
  offset: by => circle(200, 200, 150 + by),
  ghostPath: null,
  ghostInside: () => false,
  ghostEdgeDistance: () => Infinity,
  groundShows: () => true,
  groundPath: () => '',
  ...over,
})

const look = (over: Partial<TileLook> = {}): TileLook => ({
  border: '#33aa77', name: 'Pond', showName: true, hasPicture: true, dragging: false, ...over,
})

const q = (o: TileLookOverlay, cls: string): SVGElement => o.svg.querySelector(`.${cls}`) as SVGElement

describe('TileLookOverlay', () => {
  it('draws every path from the geometry, whatever the shape', () => {
    const o = new TileLookOverlay()
    const g = circleGeometry()
    o.update(g, look())
    expect(o.svg.getAttribute('viewBox')).toBe('0 0 400 400')
    expect(o.svg.querySelector('clipPath path')!.getAttribute('d')).toBe(g.outline)
    expect(q(o, 'te-look-rim').getAttribute('d')).toBe(g.outline)
    expect(q(o, 'te-look-rim').getAttribute('stroke-width')).toBe('3')
    expect(q(o, 'te-look-glow').getAttribute('d')).toBe(g.offset(-4))
    expect(q(o, 'te-look-glow').getAttribute('stroke-width')).toBe('9')
    expect(q(o, 'te-look-outside').getAttribute('d')).toContain(g.outline)
    expect(q(o, 'te-look-vignette').getAttribute('r')).toBe('150')
    expect(o.svg.innerHTML).not.toMatch(/polygon/)
  })

  it('insets the bevel by half its reach, the reach coming from the shader numbers', () => {
    const o = new TileLookOverlay()
    const g = circleGeometry()
    o.update(g, look())
    const aa = Math.max(150 * 0.04, 1.5)
    const reach = TILE_LOOK.bevel.reachAa * aa
    expect(q(o, 'te-look-bevel').getAttribute('stroke-width')).toBe(String(reach))
    expect(q(o, 'te-look-bevel').getAttribute('d')).toBe(g.offset(-reach / 2))
  })

  it('fades the outside only when the geometry says so', () => {
    const o = new TileLookOverlay()
    o.update(circleGeometry({ fade: true }), look())
    expect(q(o, 'te-look-outside').style.display).toBe('')
    o.update(circleGeometry({ fade: false }), look())
    expect(q(o, 'te-look-outside').style.display).toBe('none')
  })

  it('places the band from the geometry and drops it when there is none', () => {
    const o = new TileLookOverlay()
    o.update(circleGeometry(), look())
    const band = q(o, 'te-look-band')
    expect([band.getAttribute('x'), band.getAttribute('y'), band.getAttribute('width'), band.getAttribute('height')]).toEqual(['50', '180', '300', '40'])
    expect(band.style.display).toBe('')
    o.update(circleGeometry({ band: null }), look())
    expect(band.style.display).toBe('none')
    o.update(circleGeometry(), look({ showName: false }))
    expect(band.style.display).toBe('none')
    o.update(circleGeometry(), look({ hasPicture: false }))
    expect(band.style.display).toBe('none')
  })

  it('shows the empty ground only without a picture, and the vignette only with one', () => {
    const o = new TileLookOverlay()
    o.update(circleGeometry(), look({ hasPicture: false }))
    expect(q(o, 'te-look-empty').style.display).toBe('')
    expect(q(o, 'te-look-empty').getAttribute('d')).toBe(circleGeometry().outline)
    expect(q(o, 'te-look-vignette').style.display).toBe('none')
    expect(o.name.getAttribute('data-hc-ground')).toBe(EMPTY_TILE_GROUND)
    o.update(circleGeometry(), look())
    expect(q(o, 'te-look-empty').style.display).toBe('none')
    expect(q(o, 'te-look-vignette').style.display).toBe('')
  })

  it('sets the name from the geometry box and font, hidden without a box', () => {
    const o = new TileLookOverlay()
    o.update(circleGeometry({ nameBox: { cx: 120, cy: 90, w: 100, h: 20 }, nameFont: 14 }), look())
    expect(o.name.textContent).toBe('Pond')
    expect(o.name.style.left).toBe('120px')
    expect(o.name.style.top).toBe('90px')
    expect(o.name.style.maxWidth).toBe('100px')
    expect(o.name.style.fontSize).toBe('14px')
    expect(o.name.style.display).toBe('')
    o.update(circleGeometry({ nameBox: null }), look())
    expect(o.name.style.display).toBe('none')
  })

  it('steps the look back while a picture is dragged, and the rim stays', () => {
    const o = new TileLookOverlay()
    o.update(circleGeometry(), look({ dragging: true }))
    expect(o.svg.dataset['dragging']).toBe('true')
    expect(q(o, 'te-look-glow').style.opacity).toBe('0.25')
    expect(q(o, 'te-look-rim').style.opacity).toBe('')
    o.update(circleGeometry(), look({ dragging: false }))
    expect(o.svg.dataset['dragging']).toBe('false')
  })

  it('does nothing for a stage with no size', () => {
    const o = new TileLookOverlay()
    o.update(circleGeometry({ size: 0 }), look())
    expect(o.svg.getAttribute('viewBox')).toBeNull()
  })

  it('draws a square as readily as a circle', () => {
    const o = new TileLookOverlay()
    const square = 'M60 60H340V340H60Z'
    o.update(circleGeometry({
      outline: square,
      mask: square,
      offset: by => `M${60 - by} ${60 - by}H${340 + by}V${340 + by}H${60 - by}Z`,
    }), look())
    expect(o.svg.querySelector('clipPath path')!.getAttribute('d')).toBe(square)
    expect(q(o, 'te-look-glow').getAttribute('d')).toBe('M64 64H336V336H64Z')
  })
})

describe('the fill behind a picture that leaves the tile bare', () => {
  const picture = { x: 100, y: 100, w: 200, h: 200 }
  const geometry = (shows: boolean): ModelGeometry => circleGeometry({
    groundShows: () => shows,
    groundPath: pic => circle(200, 200, 150) + (pic ? `M${pic.x} ${pic.y}h${pic.w}v${pic.h}h-${pic.w}Z` : ''),
  })
  const fillOf = (o: TileLookOverlay): SVGElement => q(o, 'te-look-fill')

  it('paints the colour on the ground path, inside the clip, as a plain fill', () => {
    const o = new TileLookOverlay()
    o.update(geometry(true), look({ fill: '#33aa77', picture }))
    expect(fillOf(o).style.display).toBe('')
    expect(fillOf(o).getAttribute('fill')).toBe('#33aa77')
    expect(fillOf(o).getAttribute('d')).toBe(geometry(true).groundPath(picture))
    expect(fillOf(o).getAttribute('fill-rule')).toBe('evenodd')
    expect(fillOf(o).closest('[clip-path]')).not.toBeNull()
    expect(o.svg.innerHTML).not.toMatch(/filter/)
  })

  it('paints nothing when the picture covers the tile, no colour is set, or there is no picture', () => {
    const o = new TileLookOverlay()
    o.update(geometry(false), look({ fill: '#33aa77', picture }))
    expect(fillOf(o).style.display).toBe('none')
    o.update(geometry(true), look({ fill: '', picture }))
    expect(fillOf(o).style.display).toBe('none')
    o.update(geometry(true), look({ fill: '#33aa77', picture, hasPicture: false }))
    expect(fillOf(o).style.display).toBe('none')
  })
})

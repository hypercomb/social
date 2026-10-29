// editor/crop-stage.spec.ts — the stage's pointer rules and its shape-blindness.
//
// A circle stands in for the model (no hexagon anywhere): the stage must draw
// whatever geometry it is given and never compute one. The pointer rules are
// the pointer-coexistence ones of the tile editor redesign: nothing is
// captured at the press, a press inside the slop is a tap, past it the
// pointer is captured and a gesture begins, and the click after a drag is
// swallowed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CropStage, DEFAULT_SLOP, type StageOptions } from './crop-stage.js'
import type { ImageEditorService } from './image-editor.service.js'
import type { ModelGeometry } from './models/tile-model.js'

const circle = (r: number): string =>
  `M${200 - r} 200A${r} ${r} 0 1 0 ${200 + r} 200A${r} ${r} 0 1 0 ${200 - r} 200Z`

const circleGeometry = (over: Partial<ModelGeometry> = {}): ModelGeometry => ({
  size: 400,
  variant: 'round',
  c: { x: 200, y: 200 },
  unit: 150,
  reach: 150,
  outline: circle(150),
  mask: circle(150),
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
  offset: by => circle(150 + by),
  ghostPath: null,
  ghostInside: () => false,
  ghostEdgeDistance: () => Infinity,
  groundShows: () => true,
  groundPath: () => '',
  ...over,
})

type Framing = { x: number; y: number; scale: number }

const fakeModel = (hasImage = true) => {
  let framing: Framing = { x: 0, y: 0, scale: 1 }
  const model = {
    hasImage,
    natural: hasImage ? { width: 800, height: 800 } : null,
    side: 200,
    url: 'blob:fake',
    orientation: 'point-top',
    loading: false,
    mode: 'fill',
    boxFor: () => ({ width: 346, height: 400 }),
    framingFor: () => framing,
    setFraming: (f: Framing) => { framing = f },
    resetFraming: () => { framing = { x: 0, y: 0, scale: 1 } },
    setMode: () => {},
    get framing() { return framing },
  }
  return model as unknown as ImageEditorService & { framing: Framing }
}

const ptr = (type: string, init: { id?: number; x: number; y: number; pointerType?: string; primary?: boolean; button?: number }): PointerEvent => {
  const e = new MouseEvent(type, { clientX: init.x, clientY: init.y, button: init.button ?? 0, bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pointerId', { value: init.id ?? 1 })
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' })
  Object.defineProperty(e, 'isPrimary', { value: init.primary ?? true })
  return e as unknown as PointerEvent
}

type Harness = {
  stage: CropStage
  model: ReturnType<typeof fakeModel>
  captured: number[]
  taps: PointerEvent[]
  gestures: boolean[]
  renders: { n: number }
  commits: { n: number }
  geometry: ModelGeometry
}

let host: HTMLElement
const make = (opts: Partial<StageOptions> = {}, hasImage = true, geometry = circleGeometry()): Harness => {
  const model = fakeModel(hasImage)
  const h = { captured: [] as number[], taps: [] as PointerEvent[], gestures: [] as boolean[], renders: { n: 0 }, commits: { n: 0 } }
  const stage = new CropStage(model, {
    geometry: () => geometry,
    onCommit: () => { h.commits.n++ },
    onRender: () => { h.renders.n++ },
    onTap: e => { h.taps.push(e) },
    onGesture: on => { h.gestures.push(on) },
    ...opts,
  })
  Object.defineProperty(stage.el, 'clientWidth', { value: 400, configurable: true })
  stage.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
  stage.el.setPointerCapture = (id: number) => { h.captured.push(id) }
  host.append(stage.el)
  return { stage, model, geometry, ...h }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  // Reduced motion: a release commits at once instead of settling over frames.
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
})
afterEach(() => { host.remove(); vi.unstubAllGlobals() })

describe('CropStage: shape-blind', () => {
  it('draws the geometry it is asked for and fires onRender after every render', () => {
    const h = make()
    h.stage.render()
    expect(h.renders.n).toBe(1)
    expect(h.stage.overlay.svg.querySelector('clipPath path')!.getAttribute('d')).toBe(h.geometry.outline)
    h.stage.setLook({ border: '#fff', name: 'x', showName: true })
    expect(h.renders.n).toBe(2)
  })

  it('asks geometry() afresh on each render', () => {
    let g = circleGeometry()
    const h = make({ geometry: () => g })
    h.stage.render()
    g = circleGeometry({ outline: 'M0 0H10V10Z' })
    h.stage.render()
    expect(h.stage.overlay.svg.querySelector('clipPath path')!.getAttribute('d')).toBe('M0 0H10V10Z')
  })

  it('cuts the picture by the mask only when the model hard-clips it', () => {
    const clipper = (h: Harness) => h.stage.el.querySelector('.te-stage-clip') as HTMLElement
    let g = circleGeometry({ fade: false, mask: 'M0 0H100V100Z' })
    const h = make({ geometry: () => g })
    h.stage.render()
    expect(clipper(h).getAttribute('style')).toContain('M0 0H100V100Z')
    g = circleGeometry({ fade: true })
    h.stage.render()
    expect(clipper(h).getAttribute('style')).not.toContain('M0 0H100V100Z')
  })

  it('keeps the wheel marker and holds the picture inside the stage', () => {
    const h = make()
    expect(h.stage.el.hasAttribute('data-consumes-wheel')).toBe(true)
    expect(h.stage.el.querySelector('img')).not.toBeNull()
  })
})

describe('CropStage: tap, drag, capture', () => {
  it('does not capture at the press, and a release inside the slop is a tap', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 100, y: 100 }))
    expect(h.captured).toEqual([])
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 103, y: 102 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 103, y: 102 }))
    expect(h.captured).toEqual([])
    expect(h.taps).toHaveLength(1)
    expect(h.gestures).toEqual([])
    expect(h.stage.el.dataset['gesture'] ?? '').toBe('')
    expect(h.model.framing).toEqual({ x: 0, y: 0, scale: 1 })
  })

  it('past the slop the pointer is captured, the gesture is flagged, and no tap follows', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 100, y: 100 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 130, y: 100 }))
    expect(h.captured).toEqual([1])
    expect(h.stage.el.dataset['gesture']).toBe('pan')
    expect(h.gestures).toEqual([true])
    expect(h.stage.gesturing).toBe(true)
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 130, y: 100 }))
    expect(h.gestures).toEqual([true, false])
    expect(h.stage.el.dataset['gesture']).toBe('')
    expect(h.taps).toHaveLength(0)
    expect(h.commits.n).toBe(1)
    expect(h.stage.gesturing).toBe(false)
  })

  it('does not jump by the slop when the pan begins', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 100, y: 100 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 110, y: 100 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 110, y: 100 }))
    expect(h.model.framing.x).toBeCloseTo(0, 5)
  })

  it('uses 6px for a mouse and 10px for touch by default', () => {
    expect(DEFAULT_SLOP).toEqual({ mouse: 6, touch: 10 })
    const mouse = make()
    mouse.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    mouse.stage.el.dispatchEvent(ptr('pointermove', { x: 5, y: 0 }))
    expect(mouse.captured).toEqual([])
    mouse.stage.el.dispatchEvent(ptr('pointermove', { x: 6, y: 0 }))
    expect(mouse.captured).toEqual([1])

    const touch = make()
    touch.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0, pointerType: 'touch' }))
    touch.stage.el.dispatchEvent(ptr('pointermove', { x: 9, y: 0, pointerType: 'touch' }))
    expect(touch.captured).toEqual([])
    touch.stage.el.dispatchEvent(ptr('pointermove', { x: 10, y: 0, pointerType: 'touch' }))
    expect(touch.captured).toEqual([1])
  })

  it('takes a custom slop', () => {
    const h = make({ slop: { mouse: 2, touch: 3 } })
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 2, y: 0 }))
    expect(h.captured).toEqual([1])
  })

  it('a cancelled press is not a tap', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 5, y: 5 }))
    h.stage.el.dispatchEvent(ptr('pointercancel', { x: 5, y: 5 }))
    expect(h.taps).toHaveLength(0)
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 5, y: 5 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 5, y: 5 }))
    expect(h.taps).toHaveLength(1)
  })

  it('ignores a secondary mouse button', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 5, y: 5, button: 2 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 5, y: 5, button: 2 }))
    expect(h.taps).toHaveLength(0)
  })

  it('a second finger is a pinch at once: both captured, no tap', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { id: 1, x: 100, y: 100, pointerType: 'touch' }))
    h.stage.el.dispatchEvent(ptr('pointerdown', { id: 2, x: 200, y: 100, pointerType: 'touch', primary: false }))
    expect([...h.captured].sort()).toEqual([1, 2])
    expect(h.stage.el.dataset['gesture']).toBe('pinch')
    expect(h.gestures).toEqual([true])
    h.stage.el.dispatchEvent(ptr('pointermove', { id: 2, x: 260, y: 100, pointerType: 'touch', primary: false }))
    h.stage.el.dispatchEvent(ptr('pointerup', { id: 2, x: 260, y: 100, pointerType: 'touch', primary: false }))
    // handed over to a pan: still the one gesture
    expect(h.stage.el.dataset['gesture']).toBe('pan')
    expect(h.gestures).toEqual([true])
    h.stage.el.dispatchEvent(ptr('pointerup', { id: 1, x: 100, y: 100, pointerType: 'touch' }))
    expect(h.gestures).toEqual([true, false])
    expect(h.taps).toHaveLength(0)
  })

  it('without a picture a press is still a tap on a part and never a gesture', () => {
    const h = make({}, false)
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 100, y: 100 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 160, y: 100 }))
    expect(h.captured).toEqual([])
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 160, y: 100 }))
    expect(h.taps).toHaveLength(1)
    expect(h.gestures).toEqual([])
  })

  it('a lost capture ends the gesture once', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 50, y: 0 }))
    h.stage.el.dispatchEvent(ptr('lostpointercapture', { x: 50, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 50, y: 0 }))
    expect(h.gestures).toEqual([true, false])
  })

  it('a fresh primary press after a lost release starts clean', () => {
    const h = make()
    h.stage.el.dispatchEvent(ptr('pointerdown', { id: 1, x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { id: 1, x: 50, y: 0 }))
    // id 1 never ended
    h.stage.el.dispatchEvent(ptr('pointerdown', { id: 7, x: 10, y: 10 }))
    expect(h.gestures).toEqual([true, false])
    h.stage.el.dispatchEvent(ptr('pointerup', { id: 7, x: 10, y: 10 }))
    expect(h.taps).toHaveLength(1)
  })
})

describe('CropStage: the click after a drag', () => {
  const withPart = (h: Harness): { reached: number } => {
    const seen = { reached: 0 }
    const part = document.createElement('button')
    h.stage.el.append(part)
    part.addEventListener('click', () => { seen.reached++ })
    return seen
  }
  const click = (h: Harness): void => {
    h.stage.el.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }

  it('is swallowed before it reaches a part', () => {
    const h = make()
    const seen = withPart(h)
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 40, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 40, y: 0 }))
    click(h)
    expect(seen.reached).toBe(0)
  })

  it('a tap leaves its click alone for the part under it', () => {
    const h = make()
    const seen = withPart(h)
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 0, y: 0 }))
    click(h)
    expect(seen.reached).toBe(1)
  })

  it('the next press clears a swallow that never met its click', () => {
    const h = make()
    const seen = withPart(h)
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointermove', { x: 40, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 40, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointerdown', { x: 0, y: 0 }))
    h.stage.el.dispatchEvent(ptr('pointerup', { x: 0, y: 0 }))
    click(h)
    expect(seen.reached).toBe(1)
  })
})

describe('CropStage: unchanged behaviour', () => {
  it('keys still frame the picture', () => {
    const h = make()
    h.stage.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(h.model.framing.x).toBe(1)
  })

  it('dispose detaches the stage', () => {
    const h = make()
    h.stage.dispose()
    expect(h.stage.el.isConnected).toBe(false)
  })
})

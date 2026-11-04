// quick-menu.layer.spec.ts — the Pixi layer's two housekeeping duties since the
// honey: a slot's drawing is freed when it is replaced (a Graphics keeps its whole
// body, lip and drips until it is destroyed), and the flower's wake cues never
// flash under prefers-reduced-motion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const destroyed: unknown[] = []

vi.mock('pixi.js', () => {
  class Node {
    children: Node[] = []
    parent: Node | null = null
    position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y } }
    scale = { set: () => undefined }
    anchor = { set: () => undefined }
    visible = true
    eventMode = ''
    zIndex = 0
    sortableChildren = false
    width = 10
    addChild(child: Node): Node { child.parent = this; this.children.push(child); return child }
    removeChildren(): Node[] { const out = this.children; this.children = []; return out }
    destroy(): void { destroyed.push(this) }
  }
  class Container extends Node {}
  class Graphics extends Node {
    clear() { return this }
    rect() { return this }
    fill() { return this }
    stroke() { return this }
    poly() { return this }
    moveTo() { return this }
    lineTo() { return this }
    closePath() { return this }
    circle() { return this }
    roundRect() { return this }
    ellipse() { return this }
  }
  class Text extends Node {
    style: Record<string, unknown>
    constructor(o: { style?: Record<string, unknown> }) { super(); this.style = o?.style ?? {} }
  }
  class TextStyle { constructor(o: Record<string, unknown>) { Object.assign(this, o) } }
  class Point { x = 0; y = 0 }
  return { Container, Graphics, Text, TextStyle, Point }
})

// the honey drawing itself is covered by quick-menu.honey-graphics.spec.ts; the
// crafted backgrounds' frames are named stand-ins, so a test can see which one
// a sprite wears
const drawn = vi.hoisted(() => ({ honey: 0, rim: 0 }))
vi.mock('./quick-menu.honey-graphics.js', async () => {
  const { Container } = await import('pixi.js')
  return {
    drawHoney: () => { drawn.honey++ },
    drawHoneyRim: () => { drawn.rim++ },
    drawHexMask: () => undefined,
    honeyArtFrames: (art: { ready: boolean[] }) => ({
      rest: art.ready.map((ok, i) => (ok ? `rest-${i}` : null)),
      lit: art.ready.map((ok, i) => (ok ? `lit-${i}` : null)),
    }),
    honeyArtSprite: (texture: string) => Object.assign(new Container(), { texture, mask: null as unknown }),
  }
})

const { QuickMenuLayer } = await import('./quick-menu.layer.js')
const { QuickMenuRegistry } = await import('./quick-menu-registry.service.js')
const { Container } = await import('pixi.js')

const registry = new QuickMenuRegistry()
const ROOT = registry.byName('root')!
const labelOf = (slot: { label: string }): string => slot.label

let reduced = false

beforeEach(() => {
  EffectBus.clear()
  destroyed.length = 0
  reduced = false
  vi.useFakeTimers()
  ;(globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({ matches: reduced && query.includes('reduce') })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function layer(subject: string | null = null) {
  const l = new QuickMenuLayer()
  EffectBus.emit('render:host-ready', { container: new Container() })
  l.setSubject(subject)
  l.place(0, 0)
  l.show(ROOT, labelOf, null, 'back')
  return l
}

/** The cells of every render:flower the layer emits from here on. */
function watchFlower(): { lit: (string | undefined)[][] } {
  const seen = { lit: [] as (string | undefined)[][] }
  const emit = vi.spyOn(EffectBus, 'emit')
  emit.mockImplementation(((effect: string, payload: unknown) => {
    if (effect === 'render:flower') {
      const cells = (payload as { cells: { label: string; lit?: boolean }[] | null }).cells
      seen.lit.push((cells ?? []).filter(c => c.lit).map(c => c.label))
    }
  }) as never)
  return seen
}

describe('the slots are freed, not merely removed', () => {
  it('destroys every slot it replaces, with its children', () => {
    const l = layer()
    const first = destroyed.length
    l.highlight('east')                // restyle only: nothing replaced
    expect(destroyed.length).toBe(first)
    EffectBus.emit('render:geometry-changed', { circumRadiusPx: 40, spacing: 46 })
    // a Graphics and a Text per option, all destroyed on the redraw
    expect(destroyed.length).toBeGreaterThanOrEqual(first + 2)
    expect(destroyed.every(d => d !== null && typeof d === 'object')).toBe(true)
  })

  it('destroys them when the menu is taken down, and leaves nothing to restyle', () => {
    const l = layer()
    const before = destroyed.length
    l.hide()
    expect(destroyed.length).toBeGreaterThan(before)
    // a highlight that arrives after hide() must not draw on a destroyed Graphics
    expect(() => l.highlight('east')).not.toThrow()
  })
})

describe('the crafted backgrounds', () => {
  type Cell = { label: string; honey?: boolean; back?: boolean; subject?: boolean; art?: number }
  function cellsOf(run: () => void): Cell[] {
    let cells: Cell[] = []
    const emit = vi.spyOn(EffectBus, 'emit')
    emit.mockImplementation(((effect: string, payload: unknown) => {
      if (effect === 'render:flower') cells = (payload as { cells: Cell[] | null }).cells ?? []
    }) as never)
    run()
    emit.mockRestore()
    return cells
  }

  it('names a different background on every option of the flower, and none on the subject', () => {
    const l = layer('sunrise')
    const cells = cellsOf(() => l.bloom())
    const options = cells.filter(c => c.honey)
    expect(options.length).toBeGreaterThan(3)
    const worn = options.map(c => c.art)
    expect(worn.every(a => Number.isInteger(a) && a! >= 0 && a! < 10)).toBe(true)
    expect(new Set(worn).size).toBe(worn.length)
    expect(cells.find(c => c.subject)?.art).toBeUndefined()
  })

  it('leaves the way back in its crystallised honey', () => {
    const l = new QuickMenuLayer()
    EffectBus.emit('render:host-ready', { container: new Container() })
    l.setSubject('sunrise')
    l.place(0, 0)
    l.show(registry.byName('selection:organize')!, labelOf, 'northeast', 'back')
    const cells = cellsOf(() => l.bloom())
    const back = cells.find(c => c.back)
    expect(back).toBeTruthy()
    expect(back!.art).toBeUndefined()
  })

  type Sprite = { texture: string; mask: unknown }
  const spritesOf = (root: { children: unknown[] }): Sprite[] =>
    root.children.filter((c): c is Sprite => typeof (c as Sprite).texture === 'string')

  it('the Pixi ring wears the pictures as masked sprites, and lit swaps the frame', () => {
    const container = new Container()
    const l = new QuickMenuLayer()
    EffectBus.emit('render:host-ready', { container })
    l.place(0, 0)
    EffectBus.emit('quickmenu:honey-art', { ready: Array.from({ length: 10 }, () => true) })
    drawn.honey = 0
    drawn.rim = 0
    l.show(ROOT, labelOf, null, 'back')
    const root = (container as unknown as { children: { children: unknown[] }[] }).children.at(-1)!
    const sprites = spritesOf(root)
    expect(sprites).toHaveLength(6)
    expect(new Set(sprites.map(s => s.texture)).size).toBe(6)
    for (const s of sprites) {
      expect(s.texture).toMatch(/^rest-\d$/)
      expect(s.mask).toBeTruthy()
    }
    // the body is the picture: the Graphics carries only the rim
    expect(drawn.honey).toBe(0)
    expect(drawn.rim).toBe(6)
    l.highlight('east')
    expect(spritesOf(root).filter(s => s.texture.startsWith('lit-'))).toHaveLength(1)
    l.highlight(null)
    expect(spritesOf(root).every(s => s.texture.startsWith('rest-'))).toBe(true)
  })
})

describe('the flower cues under reduced motion', () => {
  function flower() {
    const l = layer('sunrise')
    const seen = watchFlower()
    l.bloom()
    seen.lit.length = 0
    return { l, seen }
  }

  it('with motion, the middle blinks and the wake sweeps the options one by one', () => {
    const { l, seen } = flower()
    l.disarm()
    vi.advanceTimersByTime(420 * 2)
    expect(seen.lit.length).toBeGreaterThan(2)
    l.rearm()
    const before = seen.lit.length
    vi.advanceTimersByTime(55 * 8)
    expect(seen.lit.length - before).toBeGreaterThan(3)
  })

  it('with reduced motion, the middle stays lit and nothing blinks', () => {
    reduced = true
    const { l, seen } = flower()
    l.disarm()
    expect(seen.lit).toEqual([['sunrise']])
    vi.advanceTimersByTime(420 * 5)
    expect(seen.lit).toHaveLength(1)
  })

  it('with reduced motion, waking is one repaint with every option awake, no sweep', () => {
    reduced = true
    const { l, seen } = flower()
    l.disarm()
    seen.lit.length = 0
    l.rearm()
    expect(seen.lit).toEqual([[]])
    vi.advanceTimersByTime(55 * 20)
    expect(seen.lit).toHaveLength(1)
    // and the layer is awake: a second rearm has nothing left to do
    l.rearm()
    expect(seen.lit).toHaveLength(1)
  })

  it('a rearm with no disarm before it does nothing', () => {
    const { l, seen } = flower()
    l.rearm()
    vi.advanceTimersByTime(55 * 20)
    expect(seen.lit).toHaveLength(0)
  })
})

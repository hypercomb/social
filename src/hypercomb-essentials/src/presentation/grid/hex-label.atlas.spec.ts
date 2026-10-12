// hex-label.atlas.spec.ts — the atlas's flush bookkeeping.
//
// What these pin down is the seam that made every name on a page disappear
// while its label BAND stayed drawn: the shader gates the band on the UV rect
// baked into the geometry, not on the pixels behind it. So any flush that
// empties a slot must be visible to show-cell's cells-key — which reads
// `evictionGeneration` — or applyGeometry takes its "nothing changed"
// early-return and the wiped slots are never re-baked.
//
// The second contract here is BLAST RADIUS. A retitle flushes ONE label; the
// navigation walk emits its title event once per titled cell, so a whole-atlas
// wipe per event took every other tile's glyphs with it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.hoisted(() => {
  // The module self-registers a factory in IoC at import.
  const w = (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {}
  w['ioc'] = { register: () => {} }
  ;(globalThis as unknown as { window: unknown }).window = w
  // jsdom has no canvas backend and logs a "not implemented" error per call.
  // Returning null is what it resolves to anyway, and the atlas skips the bake
  // on a null context — the slot bookkeeping under test runs either way.
  const canvasProto = (globalThis as unknown as { HTMLCanvasElement?: { prototype: { getContext: unknown } } }).HTMLCanvasElement
  if (canvasProto) canvasProto.prototype.getContext = () => null
})

// Pixi needs a GPU; the bookkeeping under test does not. These doubles are
// inert — a bake with no 2D context is skipped inside the atlas anyway, and
// the map/slot/generation writes happen either way.
vi.mock('pixi.js', () => ({
  Container: class {},
  Graphics: class {
    blendMode = ''
    rect(): this { return this }
    fill(): this { return this }
    destroy(): void {}
  },
  Sprite: class {
    width = 0
    height = 0
    position = { set: (): void => {} }
    constructor(public texture?: unknown) {}
  },
  Texture: { from: () => ({ source: { update: (): void => {} } }) },
  RenderTexture: {
    create: (o: { width: number; height: number; resolution: number }) => ({
      width: o.width,
      height: o.height,
      source: { resolution: o.resolution },
    }),
  },
}))

const { HexLabelAtlas } = await import('./hex-label.atlas.js')

/** No `gl` on purpose: #clearSlot then takes its WebGPU fallback, which is
 *  the path that exercises the Graphics double. */
function makeAtlas() {
  const renderer = { render: vi.fn() }
  return new HexLabelAtlas(renderer, 8, 2, 2) // 4 slots
}

describe('HexLabelAtlas flushes', () => {
  let atlas: ReturnType<typeof makeAtlas>

  beforeEach(() => {
    atlas = makeAtlas()
    atlas.getLabelUV('alpha')
    atlas.getLabelUV('beta')
  })

  it('holds both labels once baked', () => {
    expect(atlas.hasLabel('alpha')).toBe(true)
    expect(atlas.hasLabel('beta')).toBe(true)
  })

  it('flushing one label leaves the others baked', () => {
    const before = atlas.evictionGeneration

    expect(atlas.invalidateLabel('alpha')).toBe(true)

    expect(atlas.hasLabel('alpha')).toBe(false)
    expect(atlas.hasLabel('beta')).toBe(true)
    // The geometry still holds alpha's old rect — the cells-key must move or
    // applyGeometry will not rebuild and the tile keeps a band with no name.
    expect(atlas.evictionGeneration).toBeGreaterThan(before)
  })

  it('flushing an absent label is inert', () => {
    const before = atlas.evictionGeneration

    expect(atlas.invalidateLabel('never-baked')).toBe(false)

    // No generation churn: an unrelated label must not force every visible
    // tile through a geometry rebuild.
    expect(atlas.evictionGeneration).toBe(before)
    expect(atlas.hasLabel('beta')).toBe(true)
  })

  it('a flushed label re-bakes on the next request', () => {
    atlas.invalidateLabel('alpha')

    const uv = atlas.getLabelUV('alpha')

    expect(atlas.hasLabel('alpha')).toBe(true)
    // A real rect — the shader reads a zero far corner as "this tile has no
    // name" and drops the band with it.
    expect(Math.max(uv.u1, uv.v1)).toBeGreaterThan(0)
  })

  it('a full wipe bumps the generation', () => {
    const before = atlas.evictionGeneration

    atlas.invalidateLabels()

    expect(atlas.hasLabel('alpha')).toBe(false)
    expect(atlas.hasLabel('beta')).toBe(false)
    expect(atlas.evictionGeneration).toBeGreaterThan(before)
  })

  it('a pivot flip bumps the generation', () => {
    const before = atlas.evictionGeneration

    atlas.setPivot(true)

    expect(atlas.hasLabel('alpha')).toBe(false)
    expect(atlas.evictionGeneration).toBeGreaterThan(before)
  })
})

// SCALE-1 — a page with more names than slots. The renderer pins every name on
// screen; when that is more names than the atlas holds, the old allocator
// evicted a PINNED label anyway and announced it, the renderer repainted to
// heal the on-screen victim, and the repaint's bake evicted the next one: a
// 307-name page spent 72 s of 74 s re-baking labels and never converged.
describe('HexLabelAtlas with every slot pinned', () => {
  const ON_SCREEN = ['a', 'b', 'c', 'd', 'e']
  let atlas: ReturnType<typeof makeAtlas>
  let evicted: string[]
  const onEvicted = (e: Event): void => { evicted.push((e as CustomEvent<{ label: string }>).detail.label) }
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    atlas = makeAtlas() // 4 slots
    for (const l of ['a', 'b', 'c', 'd']) atlas.getLabelUV(l)
    atlas.setPinned(ON_SCREEN) // five on screen, four slots
    evicted = []
    window.addEventListener('hex-label-atlas:evicted', onEvicted)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    window.removeEventListener('hex-label-atlas:evicted', onEvicted)
    warn.mockRestore()
  })

  it('gives the extra label no slot and evicts nothing', () => {
    const before = atlas.evictionGeneration

    const uv = atlas.getLabelUV('e')

    // The degenerate rect is the shader's "no label": no glyphs, no band.
    expect(uv).toEqual({ u0: 0, v0: 0, u1: 0, v1: 0 })
    expect(atlas.hasLabel('e')).toBe(false)
    for (const l of ['a', 'b', 'c', 'd']) expect(atlas.hasLabel(l)).toBe(true)
    expect(evicted).toEqual([])
    expect(atlas.evictionGeneration).toBe(before)
  })

  it('stays quiet however often the renderer asks', () => {
    for (let pass = 0; pass < 50; pass++) {
      for (const l of ON_SCREEN) atlas.getLabelUV(l)
      atlas.setPinned(ON_SCREEN) // every paint re-pins the same page
    }
    atlas.seed(['e', 'f'])
    // A zoom in (a view that fits) and back out re-enters the overflow.
    atlas.setPinned(['a', 'b'])
    atlas.setPinned(ON_SCREEN)
    atlas.getLabelUV('e')

    expect(evicted).toEqual([])
    expect(atlas.hasLabel('e')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('takes a slot as soon as one leaves the screen', () => {
    atlas.getLabelUV('e')

    atlas.setPinned(['b', 'c', 'd', 'e']) // 'a' scrolled away

    const uv = atlas.getLabelUV('e')
    expect(Math.max(uv.u1, uv.v1)).toBeGreaterThan(0)
    expect(atlas.hasLabel('e')).toBe(true)
    // 'a' was off screen, so its displacement is an ordinary eviction.
    expect(atlas.hasLabel('a')).toBe(false)
    expect(evicted).toEqual(['a'])
  })

  it('takes a slot a flush frees without the pinned set changing', () => {
    atlas.getLabelUV('e') // full — remembered

    atlas.invalidateLabel('b')

    expect(Math.max(atlas.getLabelUV('e').u1, atlas.getLabelUV('e').v1)).toBeGreaterThan(0)
    expect(atlas.hasLabel('e')).toBe(true)
    expect(evicted).toEqual([])
  })
})

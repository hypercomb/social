// tile-fill-geometry.spec.ts — THE TILES AS THE GPU DRAWS THEM, on their own.
// One quad per tile at its axial position; a name hidden only behind a
// picture (and never for the hovered tile); a peer's hue on its border, a
// stack's depth on yours; shade and launcher silhouettes as the look says;
// a dive reads nothing location-scoped; and the key moves exactly when a
// baked geometry would be wrong.
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => ({
  Geometry: class {
    attributes: Record<string, { data: Float32Array; size: number }> = {}
    index: Uint32Array | null = null
    addAttribute(name: string, data: Float32Array, size: number) { this.attributes[name] = { data, size } }
    addIndex(index: Uint32Array) { this.index = index }
  },
}))

import { axialToPixel, buildFillQuad, fillKey, labelToRgb, type FillCell, type TileLook } from './tile-fill-geometry.js'

const UV = { u0: 0.1, v0: 0.2, u1: 0.3, v1: 0.4 }
const look = (over: Partial<TileLook> = {}): TileLook => ({
  flat: () => false, pivot: () => false, onLauncherPage: () => false, revealLabel: () => null,
  hasImage: () => true, imageUV: () => ({ u0: 0.5, v0: 0.5, u1: 0.6, v1: 0.6 }),
  labelUV: () => UV, hidesName: (hideText, hasImage) => !!hideText && hasImage,
  isHiddenItem: () => false, isDormant: () => false, peerPubkey: () => undefined, spotlight: () => null,
  stackDepth: () => 1, shadeValue: () => 0, isShaded: () => false, isPortal: () => false, shapeOf: () => '',
  ...over,
})
const attr = (built: ReturnType<typeof buildFillQuad>, name: string) => (built.geometry as any).attributes[name].data as Float32Array
const cells: FillCell[] = [
  { q: 0, r: 0, label: 'garden', imageSig: 'a' },
  { q: 1, r: 0, label: 'kitchen', hideText: true, imageSig: 'b', hasBranch: true },
]

describe('the fill geometry', () => {
  it('lays one quad per tile at its axial position, indexed in order', () => {
    const built = buildFillQuad(cells, 10, 2, 5, 5, look())
    const pos = attr(built, 'aPosition')
    const { x, y } = axialToPixel(1, 0, 12)
    expect([...pos.slice(8, 10)]).toEqual([x - 5, y - 5].map(v => Math.fround(v)))
    expect([...(built.geometry as any).index]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    expect([...attr(built, 'aCellIndex')]).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    expect([...attr(built, 'aHasBranch').slice(4)]).toEqual([1, 1, 1, 1])
  })

  it('hides a name only behind a picture, and gives it back to the hovered tile', () => {
    const hidden = buildFillQuad(cells, 10, 2, 5, 5, look())
    expect([...attr(hidden, 'aLabelUV').slice(16, 20)]).toEqual([0, 0, 0, 0])
    expect([...attr(hidden, 'aLabelUV').slice(0, 4)].map(v => +v.toFixed(2))).toEqual([0.1, 0.2, 0.3, 0.4])
    const hovered = buildFillQuad(cells, 10, 2, 5, 5, look({ revealLabel: () => 'kitchen' }))
    expect([...attr(hovered, 'aLabelUV').slice(16, 20)].map(v => +v.toFixed(2))).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('wears a peer\'s hue on the border, dimmed while another peer is in the spotlight', () => {
    const [pr] = labelToRgb('npub-alice')
    const plain = buildFillQuad(cells, 10, 2, 5, 5, look({ peerPubkey: l => l === 'garden' ? 'npub-alice' : undefined }))
    expect(attr(plain, 'aBorderColor')[0]).toBeCloseTo(pr * 0.85)
    const other = buildFillQuad(cells, 10, 2, 5, 5, look({ peerPubkey: l => l === 'garden' ? 'npub-alice' : undefined, spotlight: () => 'npub-bob' }))
    expect(attr(other, 'aBorderColor')[0]).toBeCloseTo(pr * 0.45)
  })

  it('reports the tiles it baked shaded and each tile\'s launcher silhouette', () => {
    const built = buildFillQuad(cells, 10, 2, 5, 5, look({
      isShaded: c => c.label === 'kitchen', shadeValue: c => c.label === 'kitchen' ? 0.7 : 0,
      onLauncherPage: () => true, shapeOf: l => l === 'garden' ? 'space-invader' : '',
    }))
    expect(built.shadedLabels).toEqual(['kitchen'])
    expect(attr(built, 'aShaded')[4]).toBeCloseTo(0.7)
    expect(built.shapeModes).toEqual([['garden', 2], ['kitchen', 0]])
  })

  it('a dive reads nothing of the page: no shade, no peers, portals from the caller', () => {
    const page = look({ isShaded: () => true, shadeValue: () => 1, peerPubkey: () => 'npub-alice', isPortal: () => true, onLauncherPage: () => true, shapeOf: () => 'space-invader' })
    const dive = buildFillQuad(cells, 10, 2, 5, 5, page, { portals: new Set(['kitchen']), reveal: null })
    expect(dive.shadedLabels).toEqual([])
    expect([...attr(dive, 'aShaded')].every(v => v === 0)).toBe(true)
    expect([...attr(dive, 'aIsPortal')]).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    expect(dive.shapeModes).toEqual([['garden', 0], ['kitchen', 0]])
  })
})

describe('the key of a baked geometry', () => {
  it('moves when a picture becomes resident, a shade flips or a launcher sleeps — and not otherwise', () => {
    const base = fillKey(cells, look())
    expect(fillKey(cells, look())).toBe(base)
    expect(fillKey(cells, look({ hasImage: s => s !== 'a' }))).not.toBe(base)
    expect(fillKey(cells, look({ isShaded: c => c.label === 'garden' }))).not.toBe(base)
    expect(fillKey(cells, look({ isDormant: l => l === 'kitchen' }))).not.toBe(base)
    expect(fillKey(cells, look({ flat: () => true }))).not.toBe(base)
  })
})

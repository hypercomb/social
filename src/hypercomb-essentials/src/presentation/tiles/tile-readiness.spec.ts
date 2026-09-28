// tile-readiness.spec.ts — IS THE INSIDE OF THIS TILE READY, on its own. A
// branch brightens only once its click target is proven: children's bytes
// local, the destination prepared, names and images resident. A return seeds
// bright from the memo; a displaced asset revokes exactly that proof and
// queues its repair; missing bytes go through the warm queue, never a blast.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HEX = (c: string) => c.repeat(64)
const CHILD = HEX('b'), GRANDKID = HEX('c'), PROPS = HEX('d'), IMAGE = HEX('e'), HEAD = HEX('f'), PARENT = HEX('a')
const local = new Set<string>()

vi.mock('../../editor/tile-properties.js', () => ({
  cellLocationSig: async (segments: readonly string[], name: string) => [...segments, name].join('/'),
  isSignature: (s: string) => /^[0-9a-f]{64}$/.test(s),
  readTilePropsIndex: () => ({ 'home/kitchen/oven': PROPS }),
  recoverableTileImageSig: (props: { image?: string }) => props.image,
}))
vi.mock('./local-resource-reference.js', () => ({
  resolveLocalResourceReference: async (_store: unknown, sig: string) =>
    local.has(sig) ? { text: async () => JSON.stringify({ image: IMAGE }) } as unknown as Blob : null,
}))

import { TileReadiness, type ReadinessHost } from './tile-readiness.js'

const store = {
  getResourceLocal: async () => null,
  getResource: vi.fn(async (sig: string) => { local.add(sig); return new Blob(['x']) }),
  readChildrenManifest: async (sig: string) => sig === PARENT ? [{ sig: CHILD, layer: { name: 'kitchen', children: [GRANDKID] } }] : null,
}
const history = {
  getLayerBySig: async (sig: string) => sig === GRANDKID ? { name: 'oven' } : null,
  latestMarkerSigFor: async (loc: string) => loc === 'home/kitchen' ? HEAD : undefined,
}

const hostWith = (over: Partial<ReadinessHost> = {}) => {
  const images = new Set<string>(), labels = new Set<string>()
  const calls = { released: [] as string[], revoked: [] as string[], repaints: 0 }
  const host: ReadinessHost & { images: Set<string>; labels: Set<string>; calls: typeof calls } = {
    images, labels, calls,
    imageAtlas: () => ({ hasImage: s => images.has(s), hasFailed: () => false, loadImage: async s => { images.add(s) }, capacity: 256 }),
    labelAtlas: () => ({ hasLabel: l => labels.has(l), seed: ls => { for (const l of ls) labels.add(l) }, capacity: 256 }),
    flat: () => false,
    fillMissed: new Set(),
    hostFillInFlight: new Set(),
    preparedNames: head => head === HEAD ? ['oven'] : undefined,
    preparedCells: key => key === '/home/kitchen' ? [{ imageSig: IMAGE }] : undefined,
    prepareView: async () => true,
    decode: async sig => local.has(sig) ? new Blob(['px']) : null,
    renderedCells: () => [{ imageSig: IMAGE }],
    paintShade: () => {},
    released: label => { calls.released.push(label) },
    revoked: label => { calls.revoked.push(label) },
    emitReadiness: () => {},
    scheduleRepaint: () => { calls.repaints++ },
    ...over,
  }
  return host
}

const kitchen = [{ label: 'kitchen', hasBranch: true }]
const tick = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  local.clear()
  store.getResource.mockClear()
  ;(window as any).ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? store : key === '@diamondcoreprocessor.com/HistoryService' ? history : undefined }
  ;(window as any).requestIdleCallback = (cb: () => void) => { setTimeout(cb, 0); return 0 }
})
afterEach(() => { delete (window as any).ioc; delete (window as any).requestIdleCallback })

describe('the verdict', () => {
  it('brightens a branch once its click target is local, prepared and resident', async () => {
    local.add(PROPS); local.add(IMAGE)
    const host = hostWith()
    host.labels.add('oven'); host.images.add(IMAGE)
    const r = new TileReadiness(host)
    r.stamp('home', PARENT, ['home'])
    await r.compute(kitchen, ['home'])
    expect(r.isReady('kitchen')).toBe(true)
    expect(host.calls.released).toEqual(['kitchen'])
    r.dispose()
  })

  it('stays shaded while the destination cannot be prepared', async () => {
    local.add(PROPS); local.add(IMAGE)
    const host = hostWith({ prepareView: async () => false })
    host.labels.add('oven'); host.images.add(IMAGE)
    const r = new TileReadiness(host)
    r.stamp('home', PARENT, ['home'])
    await r.compute(kitchen, ['home'])
    expect(r.isReady('kitchen')).toBe(false)
    r.dispose()
  })

  it('fetches a missing child image through the warm queue, then asks for a repaint', async () => {
    local.add(PROPS)
    const host = hostWith()
    const r = new TileReadiness(host)
    r.stamp('home', PARENT, ['home'])
    await r.compute(kitchen, ['home'])
    expect(r.isReady('kitchen')).toBe(false)
    await tick()
    expect(store.getResource).toHaveBeenCalledWith(IMAGE)
    expect(host.fillMissed.has(IMAGE)).toBe(false)
    expect(host.calls.repaints).toBeGreaterThan(0)
    r.dispose()
  })

  it('refuses cells that are not the stamped address, and leaves a retry behind', async () => {
    const host = hostWith()
    const r = new TileReadiness(host)
    r.stamp('home', PARENT, ['home'])
    await r.compute(kitchen, ['elsewhere'])
    expect(r.isReady('kitchen')).toBe(false)
    r.dispose()
  })
})

describe('the memo and its repair', () => {
  const proven = async () => {
    local.add(PROPS); local.add(IMAGE)
    const host = hostWith()
    host.labels.add('oven'); host.images.add(IMAGE)
    const r = new TileReadiness(host)
    r.stamp('home', PARENT, ['home'])
    await r.compute(kitchen, ['home'])
    return { host, r }
  }

  it('a return to a proven location seeds bright on its first frame', async () => {
    const { r } = await proven()
    r.stamp('garden', HEX('9'), ['garden'])
    expect(r.isReady('kitchen')).toBe(false)
    r.stamp('home', PARENT, ['home'])
    expect(r.isReady('kitchen')).toBe(true)
    r.dispose()
  })

  it('an eviction of the target\'s own image revokes that proof and re-bakes it; an unrelated one does nothing', async () => {
    const { host, r } = await proven()
    r.imageEvicted(HEX('7'))
    expect(r.isReady('kitchen')).toBe(true)
    host.images.delete(IMAGE)
    r.imageEvicted(IMAGE)
    expect(r.isReady('kitchen')).toBe(false)
    expect(host.calls.revoked).toEqual(['kitchen'])
    // The repair bake decodes the image back into the atlas and re-earns the proof.
    for (let i = 0; i < 5 && !r.isReady('kitchen'); i++) await tick()
    expect(host.images.has(IMAGE)).toBe(true)
    expect(r.isReady('kitchen')).toBe(true)
    r.dispose()
  })

  it('an eviction of one of the target\'s names revokes it too', async () => {
    const { host, r } = await proven()
    host.labels.delete('oven')
    r.labelEvicted('oven')
    expect(r.isReady('kitchen')).toBe(false)
    for (let i = 0; i < 5 && !r.isReady('kitchen'); i++) await tick()
    expect(host.labels.has('oven')).toBe(true)
    expect(r.isReady('kitchen')).toBe(true)
    r.dispose()
  })

  it('brightness is the renderer\'s to mark and to dim', () => {
    const r = new TileReadiness(hostWith())
    r.markBright('kitchen')
    expect(r.isBright('kitchen')).toBe(true)
    r.dim('kitchen')
    expect(r.isBright('kitchen')).toBe(false)
  })
})

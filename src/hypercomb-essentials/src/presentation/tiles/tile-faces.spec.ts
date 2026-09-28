// tile-faces.spec.ts — WHAT EACH TILE SHOWS, on its own. A tile's properties
// become its picture and its facts, cached by label for the location in
// view; a local miss paints label-only now and fetches detached; a peer's
// tile shows what its publisher projected; leaving a location sets its
// projection aside and a return restores it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HEX = (c: string) => c.repeat(64)
const PROPS = HEX('a'), IMAGE = HEX('b'), PEER_PROPS = HEX('c'), PEER_IMAGE = HEX('d')
const local = new Map<string, string>()
const PROPERTIES: Record<string, unknown> = { image: IMAGE, border: { color: '#ff0000' }, tags: ['warm'], link: 'https://example.com', hideText: true }

vi.mock('../../editor/tile-properties.js', () => ({
  cellLocationSig: async (segments: readonly string[], name: string) => [...segments, name].join('/'),
  isSignature: (s: string) => /^[0-9a-f]{64}$/.test(s),
  readCellProperties: async () => ({}),
  readTilePropertiesAt: async () => ({ ...PROPERTIES }),
  readTilePropsIndex: () => ({ 'home/kitchen': PROPS }),
  readTilePropsSigAt: async () => undefined,
  recoverableTileImageSig: (props: { image?: string }) => props.image,
  seedLayerKeyedEntries: () => {},
  writeTilePropsIndex: () => {},
}))
vi.mock('../../commands/decoration-kind-index.js', () => ({ referenceFaceForLabel: () => undefined }))
vi.mock('./local-resource-reference.js', () => ({
  resolveLocalResourceReference: async (_store: unknown, sig: string) => {
    const text = local.get(sig)
    // The test DOM's Blob has no text(); a local resource is read through it.
    return text === undefined ? null : { size: text.length, type: '', text: async () => text } as unknown as Blob
  },
}))
vi.mock('./participant-variant.js', () => ({
  participantVariantVisual: (props: { image?: string; tags?: string[] }) => ({
    imageSig: props.image, borderColor: [0, 0, 1], hasLink: false, hasSubstrate: false, hideText: false, tags: props.tags ?? [],
  }),
}))

import { TileFaces, type FaceCell, type FacesHost } from './tile-faces.js'
import { adoptPackedVisual } from './packed-visuals.js'

const store = { getResource: vi.fn(async (_sig: string): Promise<Blob | null> => null), getResourceLocal: async () => null }

const hostWith = (over: Partial<FacesHost> = {}) => {
  const loaded = new Set<string>()
  const calls = { repaints: 0, missed: [] as string[][], cleared: 0, emitted: [] as [string, unknown][] }
  const host: FacesHost & { loaded: Set<string>; calls: typeof calls } = {
    loaded, calls,
    imageAtlas: () => ({ hasImage: s => loaded.has(s), hasFailed: () => false, clearFailure: () => {}, loadImage: async s => { loaded.add(s) }, setPinned: () => {} }),
    flat: () => false,
    hostFillInFlight: new Set(),
    fillMissed: new Set(),
    armMissWindow: sigs => { calls.missed.push(sigs) },
    repaint: () => { calls.repaints++ },
    parentOf: () => null,
    cursorPropsOverride: () => null,
    registryProperties: () => undefined,
    registryImage: () => undefined,
    renderedCells: () => [],
    previewSigs: () => [],
    emit: (effect, payload) => { calls.emitted.push([effect, payload]) },
    onCleared: () => { calls.cleared++ },
    ...over,
  }
  return host
}
const cell = (label: string, external = false): FaceCell => ({ label, external })
const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  local.clear()
  store.getResource.mockReset()
  store.getResource.mockResolvedValue(null)
  ;(window as any).ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? store : key === '@hypercomb.social/Lineage' ? { explorerSegments: () => ['home'] } : undefined }
})
afterEach(() => { delete (window as any).ioc })

describe('a tile\'s face', () => {
  it('reads its properties into a picture and facts, and caches them by label', async () => {
    local.set(PROPS, JSON.stringify(PROPERTIES)); local.set(IMAGE, 'pixels')
    const host = hostWith()
    const faces = new TileFaces(host)
    const c = cell('kitchen')
    expect(await faces.load([c], null)).toEqual(['home'])
    expect(c).toMatchObject({ imageSig: IMAGE, borderColor: [1, 0, 0], hasLink: true, hideText: true, pendingProps: false })
    expect(host.loaded.has(IMAGE)).toBe(true)
    expect(faces.images.get('kitchen')).toBe(IMAGE)
    expect(faces.tags.get('kitchen')).toEqual(['warm'])
    expect(faces.hiddenText.get('kitchen')).toBe(true)
  })

  it('a local miss paints label-only now, fetches detached, and concludes it when the host has nothing', async () => {
    local.set(PROPS, JSON.stringify(PROPERTIES))
    const host = hostWith()
    const faces = new TileFaces(host)
    const c = cell('kitchen')
    await faces.load([c], null)
    expect(host.loaded.has(IMAGE)).toBe(false)
    await settle()
    expect(store.getResource).toHaveBeenCalledWith(IMAGE)
    expect(host.fillMissed.has(IMAGE)).toBe(true)
    expect(host.calls.missed).toEqual([[IMAGE]])
    expect(host.calls.repaints).toBe(1)
  })

  it('a peer\'s tile shows what its publisher projected', async () => {
    local.set(PEER_PROPS, JSON.stringify({ image: PEER_IMAGE })); local.set(PEER_IMAGE, 'pixels')
    const host = hostWith({ registryProperties: label => label === 'visitor' ? { image: PEER_PROPS, tags: ['guest'] } : undefined })
    const faces = new TileFaces(host)
    const c = cell('visitor', true)
    await faces.load([c], null)
    expect(c).toMatchObject({ imageSig: PEER_IMAGE, borderColor: [0, 0, 1] })
    expect(faces.external.has('visitor')).toBe(true)
    expect(faces.peerSources.get('visitor')).toBe(PEER_PROPS)
    expect(faces.tags.get('visitor')).toEqual(['guest'])
  })

  it('a tile turned local drops everything a peer painted before reading its own', async () => {
    local.set(PROPS, JSON.stringify(PROPERTIES)); local.set(IMAGE, 'pixels')
    const faces = new TileFaces(hostWith())
    faces.external.add('kitchen'); faces.borders.set('kitchen', [0, 0, 1]); faces.images.set('kitchen', PEER_IMAGE)
    const c = cell('kitchen')
    await faces.load([c], null)
    expect(faces.external.has('kitchen')).toBe(false)
    expect(c.imageSig).toBe(IMAGE)
    expect(faces.borders.get('kitchen')).toEqual([1, 0, 0])
  })
})

describe('the projection across locations', () => {
  it('leaving sets it aside; a return restores it only while that location\'s cells are cached', () => {
    const host = hostWith()
    const faces = new TileFaces(host)
    faces.enter('/home', false)
    faces.images.set('kitchen', IMAGE)
    faces.enter('/garden', false)
    expect(faces.images.size).toBe(0)
    faces.enter('/home', true)
    expect(faces.images.get('kitchen')).toBe(IMAGE)
    faces.enter('/garden', false)
    faces.enter('/home', false)
    expect(faces.images.size).toBe(0)
    expect(host.calls.cleared).toBeGreaterThan(0)
  })

  it('a root default reaches every saved appearance of the label', () => {
    const faces = new TileFaces(hostWith())
    faces.enter('/home', false)
    faces.images.set('kitchen', IMAGE)
    faces.enter('/garden', false)
    faces.images.set('kitchen', IMAGE)
    faces.invalidateEverywhere('kitchen')
    expect(faces.images.has('kitchen')).toBe(false)
    faces.enter('/home', true)
    expect(faces.images.has('kitchen')).toBe(false)
  })
})

describe('decoding', () => {
  it('takes a packed rendition before any read, and asks for an optimized copy of a heavy raw one', async () => {
    const host = hostWith()
    const faces = new TileFaces(host)
    adoptPackedVisual({ visual: { sig: HEX('e'), webp: btoa('webp'), type: 'image/webp' } })
    expect((await faces.decode(HEX('e')))?.type).toBe('image/webp')
    local.set(HEX('f'), 'x'.repeat(30_000))
    await faces.decode(HEX('f'))
    expect(host.calls.emitted).toEqual([['visual:wanted', { sig: HEX('f') }]])
  })
})

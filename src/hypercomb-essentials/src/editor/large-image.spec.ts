// editor/large-image.spec.ts — A DROPPED PHOTO'S LARGE COPY IS NEVER THE RAW
// FILE (owner decision D3; BCL-8's most common trigger, CC-3).
//
// A phone photo is 5–15 MB. Stored raw as the tile's `large.image`, it was over
// a host's 8 MB atom limit — relay.js answers 413, host-sync drops it for good,
// and the tile that wears it can never be taken — and it fills a phone one
// picture at a time. The large is now a WebP whose long edge is at most
// 2560 px, and a framing saved against the original's pixels follows the
// shrink. A failed drop now says so instead of vanishing.
//
// jsdom has no image decoder or canvas, so the decoder and canvas are stood in
// for: a 6000×4000 photo decodes, and the canvas encodes what is drawn.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
const writes = vi.hoisted(() => [] as { segments: readonly string[]; cell: string; props: Record<string, unknown> }[])

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = (key: string) => services.get(key)
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
    whenReady: () => {},
  }
})

vi.mock('./tile-editor.view.js', () => ({
  TileEditorElement: class extends HTMLElement {},
  tileEditorViewFacade: { dismissInner: () => false },
}))
vi.mock('./tile-properties.js', () => ({
  TILE_PROPERTIES_FILE: '0000',
  readTilePropertiesAt: vi.fn(async () => ({})),
  writeTilePropertiesAt: vi.fn(async (segments: readonly string[], cell: string, props: Record<string, unknown>) => {
    writes.push({ segments, cell, props })
  }),
  cellLocationSig: vi.fn(),
  readTilePropsIndex: vi.fn(() => ({})),
  lookupTilePropsSig: vi.fn(),
  readCellProperties: vi.fn(),
  readOwnTilePropertiesAt: vi.fn(async () => ({})),
  propertyLayers: vi.fn(),
  editorWrites: vi.fn(),
  ownAfterInherit: vi.fn(),
}))
vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceTargetForLabel: vi.fn(() => null),
  referenceEditsRootDefaultForLabel: vi.fn(() => false),
}))

import { EffectBus } from '@hypercomb/core'
import { storeImageResources } from './arm-resource.js'
import './tile-editor.drone.js'
import type { TileEditorService } from './tile-editor.service.js'

const MB = 1024 * 1024
const PHOTO = { width: 6000, height: 4000 }

/** A blob of a given size and type (jsdom's Blob has no arrayBuffer()). */
const blobOf = (size: number, type: string): Blob =>
  ({ size, type, arrayBuffer: async () => new ArrayBuffer(size) }) as unknown as Blob

/** What the canvas drew last, and at what size. */
const drawn: { width: number; height: number }[] = []

beforeEach(() => {
  drawn.length = 0
  writes.length = 0
  ;(globalThis as Record<string, unknown>)['createImageBitmap'] = vi.fn(async () => ({ ...PHOTO, close: () => {} }))
  ;(globalThis as Record<string, unknown>)['OffscreenCanvas'] = class {
    constructor(public width: number, public height: number) {}
    getContext() {
      return { drawImage: () => { drawn.push({ width: this.width, height: this.height }) }, fillRect: () => {} }
    }
    // A WebP of the drawn pixels: well under a megabyte per 5 megapixels.
    async convertToBlob(options: { type?: string } = {}) {
      return blobOf(Math.round(this.width * this.height * 0.15), options.type ?? 'image/png')
    }
  }
  ;(URL as unknown as Record<string, unknown>)['createObjectURL'] = () => 'blob:preview'
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['createImageBitmap']
  delete (globalThis as Record<string, unknown>)['OffscreenCanvas']
})

describe('the large copy of a dropped photo', () => {
  it('is a WebP with a long edge of at most 2560 px — a 12 MB photo stores ≤ 2 MB, never the raw file', async () => {
    const put: Blob[] = []
    services.set('@hypercomb.social/Store', { putResource: async (blob: Blob) => { put.push(blob); return String(put.length).padStart(64, '0') } })
    const raw = blobOf(12 * MB, 'image/jpeg')
    const stored = await storeImageResources(raw)
    expect(stored).not.toBeNull()
    const large = put[0]
    expect(large).not.toBe(raw)
    expect(large.type).toBe('image/webp')
    expect(large.size).toBeLessThanOrEqual(2 * MB)
    expect(drawn).toContainEqual({ width: 2560, height: 1707 })
  })

  it('a photo already within the edge is still re-encoded — its EXIF (the GPS of where it was taken) never reaches a host', async () => {
    ;(globalThis as Record<string, unknown>)['createImageBitmap'] = vi.fn(async () => ({ width: 2000, height: 1500, close: () => {} }))
    const put: Blob[] = []
    services.set('@hypercomb.social/Store', { putResource: async (blob: Blob) => { put.push(blob); return String(put.length).padStart(64, '0') } })
    // A desktop-resized JPEG at quality ~80: smaller than its WebP re-encode.
    const raw = blobOf(200 * 1024, 'image/jpeg')
    await storeImageResources(raw)
    expect(put[0]).not.toBe(raw)
    expect(put[0]!.type).toBe('image/webp')
    expect(put[0]!.size).toBeGreaterThan(raw.size)   // larger — and still never the original bytes
  })
})

describe('the tile editor saving a NEW picture', () => {
  it('stores the large copy and scales the framing to it — the crop on screen is the crop saved', async () => {
    const put: Blob[] = []
    services.set('@hypercomb.social/Store', {
      getResource: async () => null,
      putResource: async (blob: Blob) => { put.push(blob); return String(put.length).padStart(64, '0') },
    })
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => [] })
    const raw = blobOf(12 * MB, 'image/jpeg')
    // The framing is in frame units per ORIGINAL pixel (crop-math.ts).
    const framing = { x: 12, y: -7, scale: 0.1 }
    services.set('@diamondcoreprocessor.com/ImageEditorService', {
      ready: Promise.resolve(),
      pictureChanged: true,
      removed: false,
      hasImage: true,
      source: raw,
      capture: async () => blobOf(20_000, 'image/webp'),
      framingFor: () => framing,
      destroy: () => {},
    })
    const service = services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
    service.open('pic', {}, null, ['pic'], 'dock')
    const drone = services.get('@diamondcoreprocessor.com/TileEditorDrone') as { saveAndComplete(): Promise<void> }
    await drone.saveAndComplete()

    expect(writes).toHaveLength(1)
    const props = writes[0].props as {
      large: { image: string; x: number; y: number; scale: number }
      flat: { large: { x: number; y: number; scale: number } }
    }
    const large = put[0]
    expect(large).not.toBe(raw)
    expect(large.type).toBe('image/webp')
    const ratio = 2560 / PHOTO.width
    expect(props.large.x).toBe(framing.x)
    expect(props.large.y).toBe(framing.y)
    expect(props.large.scale).toBeCloseTo(framing.scale / ratio, 9)
    expect(props.flat.large.scale).toBeCloseTo(framing.scale / ratio, 9)
  })
})

describe('a dropped picture that cannot be stored', () => {
  it('says so — no more silent unhandled rejection', async () => {
    await import('./image-drop.drone.js')
    services.set('@hypercomb.social/Store', { putResource: async () => { throw new Error('disk said no') } })
    const toasts: string[] = []
    const off = EffectBus.on<{ message?: string }>('toast:show', t => { if (t?.message) toasts.push(t.message) })
    const file = Object.assign(blobOf(3 * MB, 'image/jpeg'), { name: 'photo.jpg' })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: Object.assign([file], { item: (i: number) => [file][i] }), getData: () => '' },
    })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    document.body.dispatchEvent(drop)
    await vi.waitFor(() => expect(toasts.some(t => /picture could not be added/i.test(t))).toBe(true))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    off()
  })

  it('leaves a full device to the store\'s one "out of space" notice', async () => {
    await import('./image-drop.drone.js')
    services.set('@hypercomb.social/Store', {
      putResource: async () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') },
    })
    const toasts: string[] = []
    const off = EffectBus.on<{ message?: string }>('toast:show', t => { if (t?.message) toasts.push(t.message) })
    toasts.length = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const file = Object.assign(blobOf(3 * MB, 'image/jpeg'), { name: 'photo.jpg' })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: Object.assign([file], { item: (i: number) => [file][i] }), getData: () => '' },
    })
    document.body.dispatchEvent(drop)
    await vi.waitFor(() => expect(warn.mock.calls.some(c => String(c[0]).includes('[image-drop]'))).toBe(true))
    expect(toasts.filter(t => /picture could not be added/i.test(t))).toEqual([])
    warn.mockRestore()
    off()
  })
})

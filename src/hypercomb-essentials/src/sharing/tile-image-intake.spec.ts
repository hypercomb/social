import { beforeEach, describe, expect, it, vi } from 'vitest'

const gallery = vi.hoisted(() => ({
  lists: [] as string[][],
  held: [] as { address: readonly string[]; bytes: readonly string[] }[],
  props: {} as Record<string, unknown>,
  stored: [] as string[],
  writes: [] as { segments: readonly string[]; cell: string; updates: Record<string, unknown> }[],
}))

vi.mock('../commands/lightbox-kind.js', () => ({
  galleryImageSigsAt: vi.fn(async () => gallery.lists.shift() ?? []),
  holdPictures: vi.fn(async (address: readonly string[], bytes: readonly string[]) => {
    gallery.held.push({ address, bytes })
    return bytes
  }),
}))

vi.mock('../editor/tile-properties.js', () => ({
  readTilePropertiesAt: vi.fn(async () => gallery.props),
  writeTilePropertiesAt: vi.fn(async (
    segments: readonly string[],
    cell: string,
    updates: Record<string, unknown>,
  ) => {
    gallery.writes.push({ segments, cell, updates })
    const next = { ...gallery.props }
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    gallery.props = next
  }),
}))

vi.mock('../presentation/tiles/artifact-content.js', () => ({
  terminalContentSig: vi.fn(async (_store: unknown, sig: string) => sig),
}))

vi.mock('../editor/arm-resource.js', () => ({
  largeImage: vi.fn(async (blob: Blob) => ({ blob, ratio: 1 })),
}))

vi.mock('../editor/resource-thumbnail.js', () => ({
  generateHexThumbnails: vi.fn(async () => ({
    pointBlob: new Blob(['point'], { type: 'image/webp' }),
    flatBlob: new Blob(['flat'], { type: 'image/webp' }),
  })),
}))

import { EffectBus } from '@hypercomb/core'
import { generateHexThumbnails } from '../editor/resource-thumbnail.js'
import { imageWallHasChoice, imagesButtonVisible, offeredPictureCount } from './image-collection.js'
import {
  announceHeldImages,
  announceReplacedPicture,
  announceSwappedImages,
  clipboardImage,
  holdImagesOnTile,
  replaceWornPicture,
  swapImagesOnTile,
} from './tile-image-intake.js'

const hex = (ch: string): string => ch.repeat(64)
const blob = (): Blob => new Blob(['picture'], { type: 'image/png' })

describe('images button and wall', () => {
  it('hides the button when the only picture is the one the tile wears', () => {
    const worn = hex('a')
    expect(imagesButtonVisible({ held: [worn], worn, extra: 0 })).toBe(false)
    expect(imagesButtonVisible({ held: [], worn: '', extra: 0 })).toBe(false)
  })

  it('shows the button for a picture the tile is not wearing, and for any real choice', () => {
    expect(imagesButtonVisible({ held: [hex('b')], worn: '', extra: 0 })).toBe(true)
    expect(imagesButtonVisible({ held: [hex('a'), hex('b')], worn: hex('a'), extra: 0 })).toBe(true)
    expect(imagesButtonVisible({ held: [], worn: '', extra: 1 })).toBe(true)
    expect(imagesButtonVisible({ held: [], worn: '', extra: 2 })).toBe(true)
  })

  it('counts a swarm picture once, and not when the tile already wears it', () => {
    const worn = hex('a')
    const other = hex('b')
    const held = new Set([worn])
    expect(offeredPictureCount(worn, held, [worn, worn, other, other])).toBe(1)
    expect(offeredPictureCount(worn, held, [worn])).toBe(0)
    expect(offeredPictureCount('', undefined, ['', other])).toBe(1)
  })

  it('opens the wall for a single picture that is not the one worn', () => {
    expect(imageWallHasChoice([{ mine: true }])).toBe(false)
    expect(imageWallHasChoice([])).toBe(false)
    expect(imageWallHasChoice([{ mine: false }])).toBe(true)
    expect(imageWallHasChoice([{ mine: true }, { mine: false }])).toBe(true)
  })
})

describe('holding pictures on a tile', () => {
  beforeEach(() => {
    gallery.lists = []
    gallery.held = []
    gallery.props = {}
    gallery.stored = []
    gallery.writes = []
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: (key: string) => key === '@hypercomb.social/Store'
        ? { putResource: async (b: Blob) => { gallery.stored.push(b.type); return hex('b') }, getResourceLocal: async () => null }
        : undefined,
    }
  })

  it('keeps the picture the tile wears and adds the dropped one', async () => {
    gallery.props = { large: { image: hex('a') } }
    gallery.lists = [[hex('a')], [hex('a'), hex('b')]]
    const saved: { cell: string; segments: readonly string[] }[] = []
    const off = EffectBus.on<{ cell: string; segments: readonly string[] }>('tile:saved', payload => { saved.push(payload) })
    saved.length = 0

    const result = await holdImagesOnTile(['page'], 'garden', [blob()])

    expect(result).toEqual({ added: 1, total: 2 })
    expect(gallery.held).toEqual([{ address: ['page', 'garden'], bytes: [hex('a'), hex('b')] }])
    expect(saved).toEqual([{ cell: 'garden', segments: ['page'] }])
    off()
  })

  it('adds a picture to a tile that was not wearing one', async () => {
    gallery.lists = [[], [hex('b')]]
    const result = await holdImagesOnTile(['page'], 'garden', [blob()])
    expect(result.added).toBe(1)
    expect(gallery.held[0]?.bytes).toEqual([hex('b')])
  })

  it('does not announce a new revision when the picture was already held', async () => {
    gallery.lists = [[hex('b')], [hex('b')]]
    const saved: unknown[] = []
    const off = EffectBus.on('tile:saved', payload => { saved.push(payload) })
    saved.length = 0
    const result = await holdImagesOnTile([], 'garden', [blob()])
    expect(result).toEqual({ added: 0, total: 1 })
    expect(saved).toEqual([])
    off()
  })

  it('says how many pictures landed', () => {
    const messages: string[] = []
    const off = EffectBus.on<{ message?: string }>('toast:show', payload => { if (payload.message) messages.push(payload.message) })
    messages.length = 0
    announceHeldImages('garden', 1)
    announceHeldImages('garden', 3)
    announceHeldImages('garden', 0)
    expect(messages).toEqual([
      'Added a picture to "garden"',
      'Added 3 pictures to "garden"',
      'Already held on "garden"',
    ])
    off()
  })
})

describe('replacing the picture a selected tile wears', () => {
  beforeEach(() => {
    gallery.lists = []
    gallery.held = []
    gallery.props = {}
    gallery.stored = []
    gallery.writes = []
    vi.mocked(generateHexThumbnails).mockClear()
    let stored = 0
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: (key: string) => key === '@hypercomb.social/Store'
        ? {
            putResource: async (b: Blob) => {
              gallery.stored.push(b.type)
              const id = 'bcdefgh'[stored] ?? 'z'
              stored += 1
              return hex(id)
            },
            getResourceLocal: async () => null,
          }
        : undefined,
    }
  })

  it('wears the new picture, framed like a dropped one, and keeps the old one', async () => {
    gallery.props = {
      large: { image: hex('a') },
      link: `/@resource/${hex('a')}`,
      small: { image: hex('e') },
      flat: { large: { x: 4, y: 5, scale: 2 }, small: { image: hex('e') } },
    }
    const saved: { cell: string; segments: readonly string[] }[] = []
    const off = EffectBus.on<{ cell: string; segments: readonly string[] }>('tile:saved', payload => { saved.push(payload) })
    saved.length = 0

    const replaced = await replaceWornPicture(['page'], 'garden', blob())

    expect(replaced).toBe(true)
    expect(gallery.writes).toEqual([{
      segments: ['page'],
      cell: 'garden',
      updates: {
        large: { image: hex('b') },
        small: { image: hex('c') },
        flat: { small: { image: hex('d') } },
        point: undefined,
        imageSig: undefined,
        substrate: undefined,
        link: `/@resource/${hex('b')}`,
      },
    }])
    expect(generateHexThumbnails).toHaveBeenCalledOnce()
    expect(gallery.held).toEqual([{ address: ['page', 'garden'], bytes: [hex('a'), hex('b')] }])
    expect(saved).toEqual([{ cell: 'garden', segments: ['page'] }])
    off()
  })

  it('leaves a custom link alone', async () => {
    gallery.props = { large: { image: hex('a') }, link: 'https://example.com/garden' }
    await replaceWornPicture(['page'], 'garden', blob())
    expect(gallery.writes[0]?.updates).not.toHaveProperty('link')
  })

  it('does nothing when the tile already wears that picture', async () => {
    gallery.props = { large: { image: hex('b') } }
    const saved: unknown[] = []
    const off = EffectBus.on('tile:saved', payload => { saved.push(payload) })
    saved.length = 0

    const replaced = await replaceWornPicture(['page'], 'garden', blob())

    expect(replaced).toBe(false)
    expect(gallery.writes).toEqual([])
    expect(gallery.held).toEqual([])
    expect(saved).toEqual([])
    expect(generateHexThumbnails).not.toHaveBeenCalled()
    off()
  })

  it('says whether the picture changed', () => {
    const messages: string[] = []
    const off = EffectBus.on<{ message?: string }>('toast:show', payload => { if (payload.message) messages.push(payload.message) })
    messages.length = 0
    announceReplacedPicture('garden', true)
    announceReplacedPicture('garden', false)
    expect(messages).toEqual([
      'Replaced the picture on "garden"',
      '"garden" already wears that picture',
    ])
    off()
  })
})

describe('dropping pictures onto a tile', () => {
  beforeEach(() => {
    gallery.lists = []
    gallery.held = []
    gallery.props = {}
    gallery.stored = []
    gallery.writes = []
    vi.mocked(generateHexThumbnails).mockClear()
    let stored = 0
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: (key: string) => key === '@hypercomb.social/Store'
        ? {
            putResource: async (b: Blob) => {
              gallery.stored.push(b.type)
              const id = 'bcdefgh'[stored] ?? 'z'
              stored += 1
              return hex(id)
            },
            getResourceLocal: async () => null,
          }
        : undefined,
    }
  })

  it('wears the dropped picture and keeps the one the tile wore for the selector', async () => {
    gallery.props = { large: { image: hex('a') } }
    const result = await swapImagesOnTile(['page'], 'garden', [blob()])
    expect(result).toEqual({ replaced: true, held: 0 })
    expect(gallery.writes[0]?.updates['large']).toEqual({ image: hex('b') })
    expect(gallery.held).toEqual([{ address: ['page', 'garden'], bytes: [hex('a'), hex('b')] }])
  })

  it('wears the first of several and holds the rest beside the one the tile wore', async () => {
    gallery.props = { large: { image: hex('a') } }
    gallery.lists = [[hex('a'), hex('b')], [hex('a'), hex('b'), hex('e')]]
    const result = await swapImagesOnTile(['page'], 'garden', [blob(), blob()])
    expect(result).toEqual({ replaced: true, held: 1 })
    expect(gallery.writes[0]?.updates['large']).toEqual({ image: hex('b') })
    expect(gallery.held[0]?.bytes).toEqual([hex('a'), hex('b')])
    expect(gallery.held[1]?.bytes).toEqual([hex('b'), hex('e')])
  })

  it('says the picture was replaced, or that the extras joined, or that nothing changed', () => {
    const messages: string[] = []
    const off = EffectBus.on<{ message?: string }>('toast:show', payload => { if (payload.message) messages.push(payload.message) })
    messages.length = 0
    announceSwappedImages('garden', { replaced: true, held: 2 })
    announceSwappedImages('garden', { replaced: false, held: 2 })
    announceSwappedImages('garden', { replaced: false, held: 0 })
    expect(messages).toEqual([
      'Replaced the picture on "garden"',
      'Added 2 pictures to "garden"',
      '"garden" already wears that picture',
    ])
    off()
  })
})

describe('clipboard image', () => {
  it('returns the first image and ignores a clipboard with none', async () => {
    const picture = new Blob(['png'], { type: 'image/png' })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => [{ types: ['text/plain', 'image/png'], getType: async (mime: string) => mime === 'image/png' ? picture : new Blob() }],
      },
    })
    expect(await clipboardImage()).toBe(picture)

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['text/plain'], getType: async () => new Blob() }] },
    })
    expect(await clipboardImage()).toBeNull()

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => { throw new Error('denied') } },
    })
    expect(await clipboardImage()).toBeNull()
  })
})

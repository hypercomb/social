import { describe, expect, it, vi } from 'vitest'
import {
  droppedTileLinkUpdates,
  linkDropDestination,
  persistDroppedTileLink,
} from './link-drop-destination.js'

describe('droppedTileLinkUpdates', () => {
  const image = { largeSig: 'large', smallPointSig: 'point', smallFlatSig: 'flat' }

  it('writes the link alone when the drop carried no picture', () => {
    expect(droppedTileLinkUpdates('https://youtu.be/dQw4w9WgXcQ', null)).toEqual({
      link: 'https://youtu.be/dQw4w9WgXcQ',
    })
  })

  it('writes the link and both hex orientations when a picture came with it', () => {
    expect(droppedTileLinkUpdates('https://youtu.be/dQw4w9WgXcQ', image)).toEqual({
      link: 'https://youtu.be/dQw4w9WgXcQ',
      large: { image: 'large', x: 0, y: 0, scale: 1 },
      small: { image: 'point' },
      flat: { large: { x: 0, y: 0, scale: 1 }, small: { image: 'flat' } },
    })
  })

  it('keeps flat-orientation keys the tile already carried — the merge is shallow', () => {
    const updates = droppedTileLinkUpdates('https://youtu.be/dQw4w9WgXcQ', image, {
      flat: { offset: 7 },
    })

    expect((updates['flat'] as Record<string, unknown>)['offset']).toBe(7)
  })
})

describe('linkDropDestination', () => {
  it('fills the editor that already owns the drop', () => {
    expect(linkDropDestination('editing', 'tile-under-panel')).toEqual({ kind: 'editor' })
  })

  it('targets the occupied tile under the release point', () => {
    expect(linkDropDestination('idle', 'video tile')).toEqual({
      kind: 'tile',
      label: 'video tile',
    })
  })

  it('keeps an empty-canvas drop on the create-and-attach path', () => {
    expect(linkDropDestination('idle', null)).toEqual({ kind: 'canvas' })
  })
})

describe('persistDroppedTileLink', () => {
  it('writes the dropped URL to canonical tile properties and refreshes the local index', async () => {
    const index: Record<string, string> = {}
    const writeProperties = vi.fn(async () => {})
    const writeIndex = vi.fn()

    await persistDroppedTileLink(
      ['videos'],
      'demo',
      'https://youtu.be/dQw4w9WgXcQ',
      {
        writeProperties,
        readPropertiesSig: vi.fn(async () => 'props-sig'),
        locationSig: vi.fn(async () => 'location-sig'),
        readIndex: () => index,
        writeIndex,
      },
    )

    expect(writeProperties).toHaveBeenCalledWith(
      ['videos'],
      'demo',
      { link: 'https://youtu.be/dQw4w9WgXcQ' },
    )
    expect(index).toEqual({ 'location-sig': 'props-sig' })
    expect(writeIndex).toHaveBeenCalledWith(index)
  })

  it('carries the dropped picture into the same canonical write as the link', async () => {
    const writeProperties = vi.fn(
      async (_segments: readonly string[], _cell: string, _updates: Record<string, unknown>) => {},
    )

    await persistDroppedTileLink(
      ['videos'],
      'demo',
      'https://youtu.be/dQw4w9WgXcQ',
      {
        writeProperties,
        readPropertiesSig: vi.fn(async () => 'props-sig'),
        locationSig: vi.fn(async () => 'location-sig'),
        readIndex: () => ({}),
        writeIndex: vi.fn(),
      },
      { largeSig: 'large', smallPointSig: 'point', smallFlatSig: 'flat' },
    )

    expect(writeProperties.mock.calls[0]?.[2]).toEqual({
      link: 'https://youtu.be/dQw4w9WgXcQ',
      large: { image: 'large', x: 0, y: 0, scale: 1 },
      small: { image: 'point' },
      flat: { large: { x: 0, y: 0, scale: 1 }, small: { image: 'flat' } },
    })
  })

  it('still completes the canonical write when no cache signature is readable', async () => {
    const writeProperties = vi.fn(async () => {})
    const writeIndex = vi.fn()

    await persistDroppedTileLink([], 'demo', 'https://youtube.com/watch?v=dQw4w9WgXcQ', {
      writeProperties,
      readPropertiesSig: vi.fn(async () => undefined),
      locationSig: vi.fn(async () => ''),
      readIndex: () => ({}),
      writeIndex,
    })

    expect(writeProperties).toHaveBeenCalledOnce()
    expect(writeIndex).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { linkDropDestination, persistDroppedTileLink } from './link-drop-destination.js'

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

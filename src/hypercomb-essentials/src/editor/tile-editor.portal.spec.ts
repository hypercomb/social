import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
const tileProperties = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  cellSig: vi.fn(),
  readIndex: vi.fn(() => ({})),
  lookup: vi.fn(),
  readLegacy: vi.fn(),
}))
const referenceTarget = vi.hoisted(() => vi.fn())
const editsRootDefault = vi.hoisted(() => vi.fn())

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
  }
})

vi.mock('./format-painter.view.js', () => ({}))
vi.mock('./tile-properties.js', () => ({
  TILE_PROPERTIES_FILE: '0000',
  readTilePropertiesAt: tileProperties.read,
  writeTilePropertiesAt: tileProperties.write,
  cellLocationSig: tileProperties.cellSig,
  readTilePropsIndex: tileProperties.readIndex,
  lookupTilePropsSig: tileProperties.lookup,
  readCellProperties: tileProperties.readLegacy,
}))
vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceTargetForLabel: referenceTarget,
  referenceEditsRootDefaultForLabel: editsRootDefault,
}))

import { EffectBus } from '@hypercomb/core'
import './tile-editor.drone.js'

describe('TileEditorDrone Portal defaults', () => {
  beforeEach(() => {
    for (const key of [...services.keys()]) {
      if (key !== '@diamondcoreprocessor.com/TileEditorDrone') services.delete(key)
    }
    vi.clearAllMocks()
    services.set('@hypercomb.social/Lineage', {
      explorerSegments: () => ['sets', 'family'],
    })
    services.set('@hypercomb.social/Store', {
      getResource: vi.fn(),
      putResource: vi.fn(),
    })
  })

  it('opens a Portal item from the original canonical-root details', async () => {
    const open = vi.fn()
    services.set('@diamondcoreprocessor.com/TileEditorService', { open })
    referenceTarget.mockReturnValue(['people'])
    editsRootDefault.mockReturnValue(true)
    tileProperties.read.mockResolvedValue({ border: { color: '#336699' } })

    EffectBus.emit('tile:action', {
      action: 'edit', label: 'people', q: 0, r: 0, index: 0,
    })

    await vi.waitFor(() => expect(open).toHaveBeenCalled())
    expect(tileProperties.read).toHaveBeenCalledWith([], 'people')
    expect(open).toHaveBeenCalledWith(
      'people',
      { border: { color: '#336699' } },
      null,
      ['people'],
    )
  })

  it('keeps an ordinary same-name activation on its own lineage variant', async () => {
    const open = vi.fn()
    services.set('@diamondcoreprocessor.com/TileEditorService', { open })
    referenceTarget.mockReturnValue(['people'])
    editsRootDefault.mockReturnValue(false)
    tileProperties.read.mockResolvedValue({ small: { image: 'a'.repeat(64) } })

    EffectBus.emit('tile:action', {
      action: 'edit', label: 'people', q: 0, r: 0, index: 0,
    })

    await vi.waitFor(() => expect(open).toHaveBeenCalled())
    expect(tileProperties.read).toHaveBeenCalledWith(['sets', 'family'], 'people')
    expect(open).toHaveBeenCalledWith(
      'people',
      { small: { image: 'a'.repeat(64) } },
      null,
      ['sets', 'family', 'people'],
    )
  })

  it('saves Portal overrides to the root default, not the reference leaf', async () => {
    const close = vi.fn()
    services.set('@diamondcoreprocessor.com/TileEditorService', {
      mode: 'editing',
      cell: 'people',
      targetSegments: ['people'],
      properties: { background: { color: '#102030' }, hideText: true },
      largeBlob: null,
      close,
    })
    const destroy = vi.fn()
    services.set('@diamondcoreprocessor.com/ImageEditorService', {
      hasImage: false,
      orientation: 'point-top',
      destroy,
    })
    services.set('@diamondcoreprocessor.com/Settings', {
      editorSize: 400,
      hexWidth: vi.fn(),
      hexHeight: vi.fn(),
    })
    tileProperties.write.mockResolvedValue(undefined)

    const drone = services.get('@diamondcoreprocessor.com/TileEditorDrone') as {
      saveAndComplete(): Promise<void>
    }
    await drone.saveAndComplete()

    expect(tileProperties.write).toHaveBeenCalledWith([], 'people', {
      background: { color: '#102030' },
      hideText: true,
    })
    expect(destroy).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})

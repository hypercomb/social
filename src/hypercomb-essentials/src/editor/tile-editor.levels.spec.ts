// The tile list reaches a tile on ANY level. The editor moves there first —
// the appearance a tile edits, its title, its portal and its notes are all
// read from the page it sits on — and when it closes it puts the participant
// back where they were, as the notes desk does.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
const here = vi.hoisted(() => ({ segments: [] as string[] }))
const stored = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const tileProperties = vi.hoisted(() => ({
  read: vi.fn(async (parent: readonly string[], cell: string) => ({ ...(stored.get([...parent, cell].join('/')) ?? {}) })),
  write: vi.fn(async () => {}),
}))
const indexed = vi.hoisted(() => vi.fn(async () => {}))

vi.hoisted(() => {
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
vi.mock('./tile-properties.js', async importOriginal => ({
  ...await importOriginal<typeof import('./tile-properties.js')>(),
  readTilePropertiesAt: tileProperties.read,
  readOwnTilePropertiesAt: vi.fn(async () => ({})),
  writeTilePropertiesAt: tileProperties.write,
}))
vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceTargetForLabel: () => null,
  referenceEditsRootDefaultForLabel: () => false,
  ensureDecorationsIndexed: indexed,
}))

import { EffectBus } from '@hypercomb/core'
import './tile-editor.drone.js'
import type { TileEditorService } from './tile-editor.service.js'

type Drone = {
  openTile: { label: string; parent: readonly string[] } | null
  saveAndComplete(): Promise<void>
  cancelEditing(): void
  switchTo(label: string, options?: { save?: boolean; parent?: readonly string[] }): Promise<boolean>
}
const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const drone = (): Drone => services.get('@diamondcoreprocessor.com/TileEditorDrone') as Drone

const selection = {
  selected: new Set<string>(),
  isSelected(label: string) { return this.selected.has(label) },
  add(label: string) { this.selected.add(label); this.notify() },
  toggle(label: string) { if (!this.selected.delete(label)) this.selected.add(label); this.notify() },
  clear() { if (!this.selected.size) return; this.selected.clear(); this.notify() },
  notify() { EffectBus.emit('selection:changed', { selected: [...this.selected], active: null }) },
}

const goRaw = vi.fn((segments: readonly string[]) => {
  here.segments = [...segments]
  // Walking clears the selection, as the real SelectionService does on navigate.
  selection.clear()
})

const open = async (label: string): Promise<void> => {
  EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 })
  await vi.waitFor(() => expect(service().cell).toBe(label))
}

describe('tile editor — tiles on other levels', () => {
  beforeEach(() => {
    if (service().mode === 'editing') service().close()
    vi.clearAllMocks()
    stored.clear()
    stored.set('top', { border: { color: '#111111' } })
    stored.set('deep/inner', { border: { color: '#222222' } })
    stored.set('deep/other', { hideText: true })
    selection.selected = new Set()
    here.segments = []
    services.set('@diamondcoreprocessor.com/SelectionService', selection)
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => here.segments })
    services.set('@hypercomb.social/Navigation', { goRaw })
    services.set('@hypercomb.social/Store', { getResource: vi.fn(async () => null), putResource: vi.fn() })
  })

  it('says which tile it is on, and nothing once closed', async () => {
    expect(drone().openTile).toBeNull()
    await open('top')
    expect(drone().openTile).toEqual({ label: 'top', parent: [] })
    drone().cancelEditing()
    expect(drone().openTile).toBeNull()
  })

  it('walks to the tile’s page, lets the page be read, then opens it from there', async () => {
    await open('top')

    const moved = await drone().switchTo('inner', { parent: ['deep'] })

    expect(moved).toBe(true)
    expect(goRaw).toHaveBeenCalledWith(['deep'])
    expect(indexed).toHaveBeenCalledWith(['inner'], ['deep'])
    expect(service().cell).toBe('inner')
    expect(drone().openTile).toEqual({ label: 'inner', parent: ['deep'] })
    // the properties were read from the page the tile sits on
    expect(tileProperties.read).toHaveBeenLastCalledWith(['deep'], 'inner')
    expect(service().properties['border']).toEqual({ color: '#222222' })
  })

  it('does not walk when the tile is on the page the participant is already on', async () => {
    here.segments = ['deep']
    await open('inner')
    await drone().switchTo('other', { parent: ['deep'] })
    expect(goRaw).not.toHaveBeenCalled()
    expect(service().cell).toBe('other')
  })

  it('a walk does not reopen the group being left on a page that lacks it', async () => {
    selection.selected = new Set(['top', 'sibling'])
    await open('top')
    expect(service().grouped).toBe(true)

    await drone().switchTo('inner', { parent: ['deep'] })

    expect(service().grouped).toBe(false)
    expect(service().cell).toBe('inner')
    expect(drone().openTile?.label).toBe('inner')
  })

  it('closing puts the participant back where the editor was opened', async () => {
    await open('top')
    await drone().switchTo('inner', { parent: ['deep'] })
    goRaw.mockClear()

    drone().cancelEditing()

    expect(goRaw).toHaveBeenCalledTimes(1)
    expect(goRaw).toHaveBeenCalledWith([])
    expect(here.segments).toEqual([])
  })

  it('saving closes and returns the same way', async () => {
    await open('top')
    await drone().switchTo('inner', { parent: ['deep'] })
    service().setBorderColor('#abcdef')
    goRaw.mockClear()

    await drone().saveAndComplete()

    expect(tileProperties.write).toHaveBeenCalledWith(['deep'], 'inner', expect.anything())
    expect(goRaw).toHaveBeenCalledWith([])
  })

  it('goes nowhere on close when the participant never left', async () => {
    await open('top')
    drone().cancelEditing()
    expect(goRaw).not.toHaveBeenCalled()
  })

  it('remembers the FIRST page across several moves', async () => {
    await open('top')
    await drone().switchTo('inner', { parent: ['deep'] })
    await drone().switchTo('top', { parent: [] })
    await drone().switchTo('other', { parent: ['deep'] })
    goRaw.mockClear()
    drone().cancelEditing()
    expect(goRaw).toHaveBeenCalledWith([])
  })

  it('aborts when the location never lands on the tile�s page: nothing phantom opens, the walk is undone', async () => {
    await open('top')
    // The navigation is slow: the first walk is heard but the location never moves.
    goRaw.mockImplementationOnce(() => undefined)

    const moved = await drone().switchTo('inner', { parent: ['deep'] })

    expect(moved).toBe(false)
    expect(goRaw).toHaveBeenNthCalledWith(1, ['deep'])
    expect(goRaw).toHaveBeenNthCalledWith(2, [])
    expect(indexed).not.toHaveBeenCalled()
    expect(service().cell).toBe('top')
    expect(drone().openTile).toEqual({ label: 'top', parent: [] })
    expect(here.segments).toEqual([])
  }, 10_000)

  it('restores the origin location when indexing throws after the walk', async () => {
    await open('top')
    indexed.mockRejectedValueOnce(new Error('index failed'))

    const moved = await drone().switchTo('inner', { parent: ['deep'] })

    expect(moved).toBe(false)
    expect(goRaw).toHaveBeenNthCalledWith(1, ['deep'])
    expect(goRaw).toHaveBeenNthCalledWith(2, [])
    expect(here.segments).toEqual([])
    expect(service().cell).toBe('top')
    expect(drone().openTile).toEqual({ label: 'top', parent: [] })
  })
})

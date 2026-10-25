// Editing a group of tiles: while a tile is open, the hive's selection — when
// it holds the open tile — is the group. A ctrl+click beside the docked editor
// puts a tile in or out. A group's save writes each tile only the fields given
// a value; a tile that already has the value is left alone.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
const stored = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const tileProperties = vi.hoisted(() => ({
  read: vi.fn(async (_parent: readonly string[], cell: string) => ({ ...(stored.get(cell) ?? {}) })),
  write: vi.fn(async () => {}),
}))

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
}))

import { EffectBus } from '@hypercomb/core'
import './tile-editor.drone.js'
import type { TileEditorService } from './tile-editor.service.js'

const service = (): TileEditorService =>
  services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const drone = (): { saveAndComplete(): Promise<void>; cancelEditing(): void } =>
  services.get('@diamondcoreprocessor.com/TileEditorDrone') as { saveAndComplete(): Promise<void>; cancelEditing(): void }

/** A selection with the SelectionService's shape that announces like it. */
const selection = {
  selected: new Set<string>(),
  isSelected(label: string) { return this.selected.has(label) },
  add(label: string) { this.selected.add(label); this.notify() },
  toggle(label: string) { if (!this.selected.delete(label)) this.selected.add(label); this.notify() },
  clear() { this.selected.clear(); this.notify() },
  set(labels: string[]) { this.selected = new Set(labels); this.notify() },
  notify() { EffectBus.emit('selection:changed', { selected: [...this.selected], active: null }) },
}

const open = async (label: string): Promise<void> => {
  EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 })
  await vi.waitFor(() => expect(service().cell).toBe(label))
}

describe('tile editor — a group of tiles', () => {
  beforeEach(() => {
    if (service().mode === 'editing') service().close()
    vi.clearAllMocks()
    stored.clear()
    stored.set('alpha', { border: { color: '#111111' }, link: 'https://alpha.example', large: { image: 'a'.repeat(64) } })
    stored.set('beta', { border: { color: '#ff0000', width: 2 } })
    stored.set('gamma', { hideText: true })
    selection.selected = new Set()
    services.set('@diamondcoreprocessor.com/SelectionService', selection)
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['page'] })
    services.set('@hypercomb.social/Store', { getResource: vi.fn(async () => null), putResource: vi.fn() })
  })

  it('a ctrl+click beside the open tile makes a group from it, starting empty', async () => {
    await open('alpha')
    expect(service().grouped).toBe(false)

    EffectBus.emitTransient('editor:group-toggle', { label: 'beta' })

    expect(service().grouped).toBe(true)
    expect(service().group).toEqual(['alpha', 'beta'])
    // Nothing of alpha's own look is the group's.
    expect(service().properties).toEqual({})
    expect(service().dirty).toBe(false)
  })

  it('starts the group from the open tile when the selection was left over from before', async () => {
    selection.set(['delta', 'epsilon'])
    await open('alpha')
    expect(service().grouped).toBe(false)

    EffectBus.emitTransient('editor:group-toggle', { label: 'beta' })

    expect([...selection.selected]).toEqual(['alpha', 'beta'])
    expect(service().group).toEqual(['alpha', 'beta'])
  })

  it('opens as a group on a tile of a multi-selection', async () => {
    selection.set(['beta', 'alpha', 'gamma'])
    await open('alpha')
    expect(service().group).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('saves only the fields given a value, and only where the value is new', async () => {
    selection.set(['alpha', 'beta', 'gamma'])
    await open('alpha')
    service().setBorderColor('#ff0000')

    await drone().saveAndComplete()

    expect(tileProperties.write).toHaveBeenCalledTimes(2)
    expect(tileProperties.write).toHaveBeenCalledWith(['page'], 'alpha', { border: { color: '#ff0000' } })
    expect(tileProperties.write).toHaveBeenCalledWith(['page'], 'gamma', { border: { color: '#ff0000' } })
    // beta already wears that rim: no write, and its link, name and picture
    // were never part of the save.
    expect(tileProperties.write).not.toHaveBeenCalledWith(['page'], 'beta', expect.anything())
    expect(service().mode).toBe('idle')
  })

  it('shows the name on a tile that hides it, and leaves the others', async () => {
    selection.set(['alpha', 'gamma'])
    await open('alpha')
    service().setHideText(false)
    expect(service().properties['hideText']).toBe(false)

    await drone().saveAndComplete()

    expect(tileProperties.write).toHaveBeenCalledTimes(1)
    expect(tileProperties.write).toHaveBeenCalledWith(['page'], 'gamma', { hideText: undefined })
  })

  it('writes nothing when nothing was given a value', async () => {
    selection.set(['alpha', 'beta'])
    await open('alpha')
    await drone().saveAndComplete()
    expect(tileProperties.write).not.toHaveBeenCalled()
  })

  it('goes back to the open tile alone, keeping what the group was given', async () => {
    selection.set(['alpha', 'beta'])
    await open('alpha')
    service().setBackgroundColor('#00ff00')

    selection.toggle('beta')

    await vi.waitFor(() => expect(service().grouped).toBe(false))
    await vi.waitFor(() => expect(service().backgroundColor).toBe('#00ff00'))
    // alpha's own look is back under it.
    expect(service().link).toBe('https://alpha.example')
  })

  it('carries a change made alone into the group', async () => {
    await open('alpha')
    service().setLink('https://changed.example')

    EffectBus.emitTransient('editor:group-toggle', { label: 'beta' })

    expect(service().properties).toEqual({ link: 'https://changed.example' })
  })
})

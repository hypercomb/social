// Several tiles at once, one after another: the editor keeps a draft for every
// tile it is moved away from (the pad), puts each back when the editor returns,
// and saves them one at a time or all together. A draft is written from what it
// holds — the editor does not have to go there.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
const stored = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const tileProperties = vi.hoisted(() => ({
  read: vi.fn(async (_parent: readonly string[], cell: string) => ({ ...(stored.get(cell) ?? {}) })),
  write: vi.fn(async (..._args: unknown[]) => {}),
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

type Drone = {
  switchTo(label: string, options?: { save?: boolean }): Promise<boolean>
  saveAndComplete(options?: { all?: boolean }): Promise<void>
  cancelEditing(): void
}

const service = (): TileEditorService =>
  services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const drone = (): Drone => services.get('@diamondcoreprocessor.com/TileEditorDrone') as Drone

const open = async (label: string): Promise<void> => {
  EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 })
  await vi.waitFor(() => expect(service().cell).toBe(label))
}

const waiting = (): string[] => service().drafts.map(draft => draft.cell)

describe('tile editor — a pad of drafts', () => {
  let saved: { cell: string; segments: readonly string[] }[]
  let offSaved: () => void

  beforeEach(() => {
    if (service().mode === 'editing') service().close()
    for (const draft of service().drafts) service().dropStash(draft.cell, draft.segments)
    vi.clearAllMocks()
    stored.clear()
    stored.set('alpha', { link: 'https://alpha.example' })
    stored.set('beta', { border: { color: '#ff0000', width: 2 } })
    stored.set('gamma', { hideText: true })
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['page'] })
    services.set('@hypercomb.social/Store', { getResource: vi.fn(async () => null), putResource: vi.fn() })
    services.delete('@diamondcoreprocessor.com/SelectionService')
    saved = []
    offSaved?.()
    offSaved = EffectBus.on<{ cell: string; segments: readonly string[] }>('tile:saved', payload => { if (payload) saved.push(payload) })
    // the bus replays the last save to a new subscriber: that one is an old test's
    saved.length = 0
  })

  it('keeps a draft for each tile it is moved away from, and none for a tile left as it was', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    expect(await drone().switchTo('beta')).toBe(true)
    service().setBorderColor('#00ff00')
    expect(await drone().switchTo('gamma')).toBe(true)

    // gamma was never changed; the open tile is never in the pad
    expect(waiting()).toEqual(['alpha', 'beta'])
    expect(service().cell).toBe('gamma')
    expect(service().dirty).toBe(false)
    expect(service().stashFor('alpha', ['page', 'alpha'])?.properties['link']).toBe('https://changed.example')
  })

  it('puts a tile\'s draft back when the editor returns to it, as it was left', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')
    service().setBorderColor('#00ff00')

    await drone().switchTo('alpha')

    expect(service().cell).toBe('alpha')
    expect(service().link).toBe('https://changed.example')
    expect(service().dirty).toBe(true)
    // alpha's draft is the open session again; beta's stays in the pad
    expect(waiting()).toEqual(['beta'])
    expect(service().resuming).toBe(false)

    await drone().switchTo('beta')
    expect(service().borderColor).toBe('#00ff00')
    expect(waiting()).toEqual(['alpha'])
  })

  it('save writes the open tile only, and stays open while another tile waits', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')
    service().setBorderColor('#00ff00')

    await drone().saveAndComplete()

    expect(tileProperties.write).toHaveBeenCalledTimes(1)
    expect(tileProperties.write).toHaveBeenCalledWith(['page'], 'beta', { border: { color: '#00ff00', width: 2 } })
    expect(saved).toEqual([{ cell: 'beta', segments: ['page'] }])
    // still editing beta, now as saved; alpha still waits
    expect(service().mode).toBe('editing')
    expect(service().cell).toBe('beta')
    expect(service().dirty).toBe(false)
    expect(waiting()).toEqual(['alpha'])
  })

  it('the last save closes the desk', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')
    service().setBorderColor('#00ff00')

    await drone().saveAndComplete()
    await drone().switchTo('alpha')
    await drone().saveAndComplete()

    expect(tileProperties.write).toHaveBeenCalledTimes(2)
    expect(tileProperties.write).toHaveBeenLastCalledWith(['page'], 'alpha', { link: 'https://changed.example' })
    expect(service().mode).toBe('idle')
    expect(waiting()).toEqual([])
  })

  it('done on an unchanged tile closes the desk and keeps the others\' drafts', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')

    await drone().saveAndComplete()

    expect(tileProperties.write).not.toHaveBeenCalled()
    expect(service().mode).toBe('idle')
    // they are offered back when the tile is opened again
    expect(waiting()).toEqual(['alpha'])
    await open('alpha')
    expect(service().stashFor('alpha', service().targetSegments)).not.toBeNull()
  })

  it('save all writes every waiting tile and the open one, then closes', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')
    service().setBorderColor('#00ff00')
    await drone().switchTo('gamma')
    service().setHideText(false)
    // gamma opened with hideText true; showing the name is the flag's absence
    expect(service().dirty).toBe(true)

    await drone().saveAndComplete({ all: true })

    const written = tileProperties.write.mock.calls.map(call => call[1])
    expect(written.sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(tileProperties.write).toHaveBeenCalledWith(['page'], 'alpha', { link: 'https://changed.example' })
    expect(tileProperties.write).toHaveBeenCalledWith(['page'], 'beta', { border: { color: '#00ff00', width: 2 } })
    expect(saved.map(tile => tile.cell).sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(service().mode).toBe('idle')
    expect(waiting()).toEqual([])
  })

  it('a draft that cannot be written stops save all, keeps itself and the rest, and leaves the open tile alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')
    service().setBorderColor('#00ff00')
    await drone().switchTo('gamma')
    service().setHideText(false)
    tileProperties.write.mockRejectedValueOnce(new Error('disk full'))

    await drone().saveAndComplete({ all: true })

    // alpha (the oldest) failed first: nothing was written, everything is kept
    expect(service().mode).toBe('editing')
    expect(service().cell).toBe('gamma')
    expect(service().dirty).toBe(true)
    expect(waiting()).toEqual(['alpha', 'beta'])
    expect(service().error).not.toBe('')
    expect(saved).toEqual([])

    // a second try finishes the job
    await drone().saveAndComplete({ all: true })
    expect(service().mode).toBe('idle')
    expect(waiting()).toEqual([])
    warn.mockRestore()
  })

  it('a draft written from the pad leaves nothing of its picture behind when it has none', async () => {
    await open('alpha')
    service().setLink('https://changed.example')
    await drone().switchTo('beta')
    await drone().saveAndComplete({ all: true })
    // no picture on either tile: the write is the property diff and nothing else
    expect(tileProperties.write).toHaveBeenCalledTimes(1)
    expect(Object.keys(tileProperties.write.mock.calls[0]![2] as object)).toEqual(['link'])
  })
})

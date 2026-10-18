// link/link-open.worker.spec.ts — only a tap made while the worker listens
// opens a link. The bus replays the last `tile:action` to a new subscriber;
// an `open` replayed when the worker starts listening raises nothing.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  ;(globalThis as unknown as { get: (k: string) => unknown }).get = () => undefined
})

vi.mock('./photo.js', () => ({ fetchImageBlob: vi.fn(async () => null), isImageUrl: () => false }))
vi.mock('./photo.view.js', () => ({ PhotoView: class {} }))
vi.mock('../editor/tile-properties.js', () => ({
  readTilePropertiesAt: vi.fn(async () => ({ link: 'https://example.com/page' })),
  readCellProperties: vi.fn(async () => ({})),
  readTilePropsIndex: vi.fn(() => ({})),
  cellLocationSig: vi.fn(async () => ''),
  lookupTilePropsSig: vi.fn(() => null),
}))

const { LinkOpenWorker } = await import('./link-open.worker.js')

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('link open — the replay is not a tap', () => {
  it('ignores the open replayed at subscribe time and answers a live one', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    EffectBus.emit('tile:action', { action: 'open', label: 'old-link', q: 0, r: 0, index: 0 })

    const worker = new LinkOpenWorker()
    await (worker as unknown as { act: () => Promise<void> }).act()
    await settle()
    expect(open).not.toHaveBeenCalled()

    EffectBus.emit('tile:action', { action: 'open', label: 'new-link', q: 0, r: 0, index: 0 })
    await settle()
    expect(open).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })
})

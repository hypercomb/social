import { beforeAll, describe, expect, it, vi } from 'vitest'

const registry = new Map<string, unknown>()

beforeAll(() => {
  Object.defineProperty(window, 'ioc', {
    configurable: true,
    value: {
      get: (key: string) => registry.get(key),
      register: (key: string, value: unknown) => registry.set(key, value),
    },
  })
})

describe('portable tile domain resolution', () => {
  it('uses a local layer without dialing a domain', async () => {
    const { resolvePortableLayer } = await import('./portable-tile-drop.drone.js')
    const layer = { name: 'local' }
    const history = { getLayerBySig: vi.fn(async () => layer) }
    const store = { fetchLayerFromHost: vi.fn() }
    await expect(resolvePortableLayer('a'.repeat(64), history as never, store as never)).resolves.toBe(layer)
    expect(store.fetchLayerFromHost).not.toHaveBeenCalled()
  })

  it('awaits the verified domain fetch and resolves the newly local layer', async () => {
    const { resolvePortableLayer } = await import('./portable-tile-drop.drone.js')
    const layer = { name: 'from-domain' }
    const history = { getLayerBySig: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(layer) }
    const store = { fetchLayerFromHost: vi.fn(async () => new Uint8Array([1])) }
    await expect(resolvePortableLayer('b'.repeat(64), history as never, store as never)).resolves.toBe(layer)
    expect(store.fetchLayerFromHost).toHaveBeenCalledWith('b'.repeat(64), { bypassMissWindow: true })
    expect(history.getLayerBySig).toHaveBeenCalledTimes(2)
  })
})

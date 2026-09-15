import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

const services = new Map<string, unknown>()
window.ioc = { get: (key: string) => services.get(key), register: () => {}, whenReady: () => {} } as any
let Store: typeof import('./store.js').Store
beforeAll(async () => {
  vi.stubGlobal('register', () => {})
  ;({ Store } = await import('./store.js'))
})
afterEach(() => { services.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('image retry after publisher host discovery', () => {
  it('honors broker backoff, then retries immediately when discovery clears it', async () => {
    const store = new Store()
    vi.spyOn(store, 'getResourceLocal').mockResolvedValue(null)
    vi.spyOn(store, 'putResource').mockResolvedValue('a'.repeat(64))
    let until = Date.now() + 60_000
    const fetchBySig = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(new Uint8Array([1, 2, 3]))
    services.set('@ContentBrokerDrone', { fetchBySig, missUntil: () => until })
    // Allow the initial request to record both caches' miss windows.
    until = 0
    expect(await store.getResource('a'.repeat(64))).toBeNull()
    until = Date.now() + 60_000
    expect(await store.getResource('a'.repeat(64))).toBeNull()
    expect(fetchBySig).toHaveBeenCalledTimes(1)
    until = 0
    expect(await store.getResource('a'.repeat(64))).not.toBeNull()
    expect(fetchBySig).toHaveBeenCalledTimes(2)
  })
})

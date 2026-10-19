import { describe, expect, it, vi } from 'vitest'
import { installReadonlyNetwork } from './readonly-network'

describe('visitor network gate', () => {
  it('allows same-origin reads and refuses mutation and cross-origin', async () => {
    const nativeFetch = vi.fn(async () => new Response('ok'))
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: nativeFetch })

    installReadonlyNetwork()

    await expect(fetch('/content/' + 'a'.repeat(64))).resolves.toBeInstanceOf(Response)
    // Refusals REJECT (like any failed fetch) instead of throwing synchronously:
    // callers handle a rejected promise everywhere, and a synchronous throw
    // escapes paths that only wrapped the await.
    await expect(fetch('/upload', { method: 'PUT' })).rejects.toBeInstanceOf(TypeError)
    await expect(fetch('https://outside.example/object')).rejects.toBeInstanceOf(TypeError)
    expect(nativeFetch).toHaveBeenCalledTimes(1)
  })

  it('admits the one write a reader makes — their own pool member at this origin — and nothing like it elsewhere', async () => {
    const nativeFetch = vi.fn(async () => new Response('member'))
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: nativeFetch })
    installReadonlyNetwork()

    const pool = 'a'.repeat(64), member = 'b'.repeat(64)
    // Joining a meeting from its page: PUT /<pool>/<member>, both signatures.
    await expect(fetch(`/${pool}/${member}`, { method: 'PUT', body: '{}' })).resolves.toBeInstanceOf(Response)
    // Not a bare atom, not a listing, not another origin, not another verb.
    await expect(fetch(`/${pool}`, { method: 'PUT', body: '{}' })).rejects.toBeInstanceOf(TypeError)
    await expect(fetch(`/${pool}/`, { method: 'PUT', body: '{}' })).rejects.toBeInstanceOf(TypeError)
    await expect(fetch(`https://outside.example/${pool}/${member}`, { method: 'PUT', body: '{}' })).rejects.toBeInstanceOf(TypeError)
    await expect(fetch(`/${pool}/${member}`, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(TypeError)
    await expect(fetch(`/${pool}/${member}`, { method: 'DELETE' })).rejects.toBeInstanceOf(TypeError)
    expect(nativeFetch).toHaveBeenCalledTimes(1)
  })

  it('makes a blocked socket fail like an unreachable one, never at construction', async () => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: vi.fn(async () => new Response('ok')) })
    installReadonlyNetwork()

    // Constructing must NOT throw. A constructor throw reads as a programming
    // error, so reconnect loops retry immediately instead of backing off —
    // that spun the main thread flat out and the published page never painted.
    const socket = new WebSocket('wss://outside.example')
    expect(socket.readyState).toBe(0)

    const closed = await new Promise<CloseEvent>(resolve => {
      socket.addEventListener('close', event => resolve(event as CloseEvent))
    })
    expect(closed.wasClean).toBe(false)
    expect(socket.readyState).toBe(3)
    expect(() => socket.send('anything')).not.toThrow()
  })
})

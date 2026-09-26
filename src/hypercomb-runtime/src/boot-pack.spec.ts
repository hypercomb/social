// @vitest-environment node
//
// boot-pack.spec.ts — THE BOOT PACK is a derived cache over individually
// managed files: a boot with no pack reads each file and asks for a pack of
// what it used; the next boot takes every one of those from the pack.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const ROOT = 'f'.repeat(64)
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const fakeCaches = () => {
  const store = new Map<string, Map<string, Response>>()
  return {
    open: async (name: string) => {
      const cache = store.get(name) ?? new Map<string, Response>()
      store.set(name, cache)
      return {
        match: async (key: string) => cache.get(key)?.clone(),
        put: async (key: string, response: Response) => { cache.set(key, response) },
        keys: async () => [...cache.keys()].map(key => new Request(`http://host${key}`)),
        delete: async (request: Request) => cache.delete(new URL(request.url).pathname),
      }
    },
  }
}

const source = {
  getBeeBytes: async (sig: string) => (sig === A ? bytes('bee a') : null),
  getDependencyBytes: async (sig: string) => (sig === B ? bytes('dep b') : null),
}

const boot = async () => {
  vi.resetModules()
  return import('./boot-pack')
}

describe('the boot pack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as any).caches = fakeCaches()
    ;(globalThis as any).localStorage = { getItem: () => ROOT }
    EffectBus.clear()
  })

  it('misses on the first boot, then serves every file that boot used', async () => {
    const first = await boot()
    expect(await first.packedBytes(A, 'bee', source)).toBeNull()
    expect(await first.packedBytes(B, 'dependency', source)).toBeNull()
    EffectBus.emit('loader:bees-done', {})
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(1000)

    EffectBus.clear()
    const second = await boot()
    expect(new TextDecoder().decode((await second.packedBytes(A, 'bee', source))!)).toBe('bee a')
    expect(new TextDecoder().decode((await second.packedBytes(B, 'dependency', source))!)).toBe('dep b')
  })

  it('lets the bytes go once the bees are in', async () => {
    const first = await boot()
    await first.packedBytes(A, 'bee', source)
    EffectBus.emit('loader:bees-done', {})
    await vi.advanceTimersByTimeAsync(4000)
    expect(await first.packedBytes(A, 'bee', source)).toBeNull()
  })
})

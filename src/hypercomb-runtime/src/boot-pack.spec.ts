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

let reads = 0
const readA = async () => { reads++; return bytes('bee a') }
const readB = async () => { reads++; return bytes('dep b') }

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

  it('reads each file on the first boot, then serves every one from the pack', async () => {
    reads = 0
    const first = await boot()
    expect(new TextDecoder().decode((await first.packedBytes(A, readA))!)).toBe('bee a')
    expect(new TextDecoder().decode((await first.packedBytes(B, readB))!)).toBe('dep b')
    expect(reads).toBe(2)
    EffectBus.emit('loader:bees-done', {})
    await vi.advanceTimersByTimeAsync(3000)

    EffectBus.clear()
    reads = 0
    const second = await boot()
    expect(new TextDecoder().decode((await second.packedBytes(A, readA))!)).toBe('bee a')
    expect(new TextDecoder().decode((await second.packedBytes(B, readB))!)).toBe('dep b')
    expect(reads).toBe(0)
  })

  it('reads on its own once the bees are in', async () => {
    reads = 0
    const first = await boot()
    await first.packedBytes(A, readA)
    EffectBus.emit('loader:bees-done', {})
    await vi.advanceTimersByTimeAsync(3000)
    await first.packedBytes(A, readA)
    expect(reads).toBe(2)
  })
})

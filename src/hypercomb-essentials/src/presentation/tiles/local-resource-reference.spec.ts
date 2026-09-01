import { describe, expect, it, vi } from 'vitest'

import { resolveLocalResourceReference } from './local-resource-reference.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

const blob = (text: string, type: string): Blob => ({
  size: text.length,
  type,
  text: async () => text,
} as Blob)

const meta = (resource: string): Blob => blob(
  JSON.stringify({ meta: 1, resource, relation: 'properties' }),
  'application/json',
)

describe('resolveLocalResourceReference', () => {
  it('delegates ordinary property reads to Store local incidence resolution', async () => {
    const properties = blob('{"index":4}', 'application/json')
    const getResourceResolvedLocal = vi.fn(async () => properties)
    const getResourceLocal = vi.fn(async () => null)

    await expect(resolveLocalResourceReference({ getResourceLocal, getResourceResolvedLocal }, A)).resolves.toBe(properties)
    expect(getResourceResolvedLocal).toHaveBeenCalledWith(A)
    expect(getResourceLocal).not.toHaveBeenCalled()
  })

  it('follows a Life Primitive image incidence to shared bytes', async () => {
    const pixels = blob('pixels', 'image/png')
    const getResourceLocal = vi.fn(async (sig: string) => sig === A ? meta(B) : sig === B ? pixels : null)

    await expect(resolveLocalResourceReference({ getResourceLocal }, A, { optimized: true })).resolves.toBe(pixels)
    expect(getResourceLocal.mock.calls.map(([sig]) => sig)).toEqual([A, B])
  })

  it('uses an optimization keyed by the terminal resource sig', async () => {
    const optimized = blob('optimized', 'image/webp')
    const getResourceLocal = vi.fn(async (sig: string) => sig === A ? meta(B) : null)
    const getOptimizedVisual = vi.fn(async (sig: string) => sig === B ? optimized : null)

    await expect(resolveLocalResourceReference({ getResourceLocal, getOptimizedVisual }, A, { optimized: true })).resolves.toBe(optimized)
  })

  it('rejects cyclic incidence chains', async () => {
    const resources = new Map([[A, meta(B)], [B, meta(C)], [C, meta(A)]])
    const getResourceLocal = vi.fn(async (sig: string) => resources.get(sig) ?? null)

    await expect(resolveLocalResourceReference({ getResourceLocal }, A, { optimized: true })).resolves.toBeNull()
  })
})

// history/inflate.spec.ts
//
// Proves the lens is additive: with no `options.lens`, `inflate` is
// byte-for-byte what it always was; with one, a shadow is substituted
// verbatim and never recursed into, a miss fires exactly once per
// shadow-less sig, and cycle / missing markers are unaffected either way.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inflate, type InflateLens } from './inflate.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

type LayerLike = Record<string, unknown>

const layers = new Map<string, LayerLike>()
const resources = new Map<string, unknown>()

const history = {
  getLayerBySig: async (s: string): Promise<LayerLike | null> => layers.get(s) ?? null,
}

const store = {
  // Store.resolve returns the input UNCHANGED when the value isn't a
  // resolvable resource — resolveOne reads that as "not JSON here" and
  // falls through to getResource. Modelled the same way here.
  resolve: async <T,>(value: unknown): Promise<T> =>
    (typeof value === 'string' && resources.has(value) ? resources.get(value) as T : value as T),
  getResource: async (): Promise<Blob | null> => null,
}

const installIoc = (): void => {
  (window as unknown as { ioc: unknown }).ioc = {
    get: (key: string): unknown => {
      if (key === '@diamondcoreprocessor.com/HistoryService') return history
      if (key === '@hypercomb.social/Store') return store
      return undefined
    },
  }
}

const ROOT = sig(1)
const CHILD = sig(2)
const RESOURCE = sig(3)
const MISSING = sig(4)

beforeEach(() => {
  layers.clear()
  resources.clear()
  layers.set(ROOT, { name: 'root', notes: [CHILD], loop: ROOT })
  layers.set(CHILD, { name: 'child', ghost: MISSING })
  resources.set(RESOURCE, { hello: 'world' })
  installIoc()
})

describe('inflate with no lens', () => {
  it('resolves layers, resources, cycles and missing markers exactly as before', async () => {
    const result = await inflate(ROOT) as Record<string, unknown>
    expect(result.name).toBe('root')
    expect(result.loop).toEqual({ $cycle: ROOT })
    const notes = result.notes as Record<string, unknown>[]
    expect(notes[0].name).toBe('child')
    expect(notes[0].ghost).toEqual({ $sig: MISSING, $missing: true })
  })

  it('resolves a plain resource sig via Store.resolve', async () => {
    expect(await inflate(RESOURCE)).toEqual({ hello: 'world' })
  })
})

describe('inflate with a lens', () => {
  it('substitutes a shadow verbatim and does not recurse into it', async () => {
    const lens: InflateLens = {
      shadow: vi.fn(async (s: string) => (s === CHILD ? { compact: 'child summary' } : null)),
      miss: vi.fn(),
    }
    const result = await inflate(ROOT, undefined, { lens }) as Record<string, unknown>
    // The shadow object stands in for the whole resolved subtree — 'ghost'
    // (which the real child layer carries) never appears.
    expect(result.notes).toEqual([{ compact: 'child summary' }])
    expect(lens.shadow).toHaveBeenCalledWith(CHILD)
  })

  it('calls miss exactly once per sig that has no shadow, then resolves normally', async () => {
    const lens: InflateLens = { shadow: vi.fn(async () => null), miss: vi.fn() }
    const result = await inflate(RESOURCE, undefined, { lens })
    expect(result).toEqual({ hello: 'world' })
    expect(lens.miss).toHaveBeenCalledTimes(1)
    expect(lens.miss).toHaveBeenCalledWith(RESOURCE)
  })

  it('leaves cycle and missing markers unchanged, and never asks the lens about a cycling sig', async () => {
    const lens: InflateLens = { shadow: vi.fn(async () => null), miss: vi.fn() }
    const result = await inflate(ROOT, undefined, { lens }) as Record<string, unknown>
    expect(result.loop).toEqual({ $cycle: ROOT })
    const notes = result.notes as Record<string, unknown>[]
    expect(notes[0].ghost).toEqual({ $sig: MISSING, $missing: true })
    // ROOT (top-level), CHILD and MISSING are each asked once; the second
    // occurrence of ROOT (the `loop` field) short-circuits on the cycle
    // check BEFORE the lens is ever consulted, so it is not a fourth call.
    expect(lens.shadow).toHaveBeenCalledTimes(3)
  })

  it('has no effect at all when omitted, on the same input', async () => {
    const withLens = await inflate(ROOT, undefined, { lens: { shadow: async () => null } })
    const withoutLens = await inflate(ROOT)
    expect(withLens).toEqual(withoutLens)
  })
})

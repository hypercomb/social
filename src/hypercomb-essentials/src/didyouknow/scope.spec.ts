// didyouknow/scope.spec.ts — where the game is on: a mark on a layer, read by
// walking up from the layer you stand on (the application-scope primitive).

import { beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory stand-in for the layers' decoration slots: layer key → sigs.
const layers = new Map<string, string[]>()
const key = (segments: readonly string[]): string => segments.join('/')
let counter = 0

vi.mock('../commands/decoration-manifest.js', () => ({
  listDecorations: async ({ segments }: { kind: string; segments: readonly string[] }) =>
    (layers.get(key(segments)) ?? []).map(sig => ({ sig, record: {} })),
  writeDecoration: async ({ segments }: { segments: readonly string[] }) => {
    const sig = `sig-${++counter}`
    layers.set(key(segments), [...(layers.get(key(segments)) ?? []), sig])
    return sig
  },
  removeDecorationAndWait: async ({ sig, segments }: { sig: string; segments: readonly string[] }) => {
    layers.set(key(segments), (layers.get(key(segments)) ?? []).filter(s => s !== sig))
  },
}))

import { declarationsAt, declaredAt, disableAt, enableAt } from './scope.js'

beforeEach(() => { layers.clear(); counter = 0 })

describe('declaredAt — the nearest layer that declares the game on', () => {
  it('is null where no layer at or above declares it', async () => {
    expect(await declaredAt(['lecture', 'biology'])).toBeNull()
    expect(await declaredAt([])).toBeNull()
  })

  it('a declaration on the root layer is everywhere', async () => {
    await enableAt([])
    expect(await declaredAt([])).toEqual([])
    expect(await declaredAt(['lecture'])).toEqual([])
    expect(await declaredAt(['lecture', 'biology', 'cells'])).toEqual([])
  })

  it('a declaration on a branch holds for that layer and everything beneath, and for nothing beside it', async () => {
    await enableAt(['lecture'])
    expect(await declaredAt(['lecture'])).toEqual(['lecture'])
    expect(await declaredAt(['lecture', 'biology', 'cells'])).toEqual(['lecture'])
    expect(await declaredAt(['other'])).toBeNull()
    expect(await declaredAt([])).toBeNull()
  })

  it('the nearest declaration answers when several layers declare', async () => {
    await enableAt([])
    await enableAt(['lecture', 'biology'])
    expect(await declaredAt(['lecture', 'biology', 'cells'])).toEqual(['lecture', 'biology'])
    expect(await declaredAt(['lecture', 'chemistry'])).toEqual([])
  })
})

describe('enableAt / disableAt', () => {
  it('declaring twice on one layer writes one mark', async () => {
    await enableAt(['lecture'])
    await enableAt(['lecture'])
    expect(await declarationsAt(['lecture'])).toHaveLength(1)
  })

  it('stamps nothing on descendants', async () => {
    await enableAt(['lecture'])
    expect(await declarationsAt(['lecture', 'biology'])).toHaveLength(0)
    expect(await declarationsAt([])).toHaveLength(0)
  })

  it('disabling takes the mark off exactly that layer and leaves an ancestor alone', async () => {
    await enableAt([])
    await enableAt(['lecture'])
    expect(await disableAt(['lecture'])).toBe(1)
    expect(await declarationsAt(['lecture'])).toHaveLength(0)
    expect(await declaredAt(['lecture'])).toEqual([])
    expect(await disableAt(['lecture'])).toBe(0)
  })
})

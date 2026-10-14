// commands/remove.queen.spec.ts
//
// /remove takes a `/`-path under the current page: each page its targets sit
// on is committed on its own, deepest first, through the same removeTilesAt.
// The command line's `[a, b]/remove` and `~name` hand their labels here, so
// this is the one place a removal — a layer committed without the tile — runs.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { segments: readonly string[]; targets: readonly string[] }[] = []
let refuse = new Set<string>()

vi.mock('./remove-tiles.js', () => ({
  removeTilesAt: async (segments: readonly string[], targets: readonly string[]) => {
    calls.push({ segments: [...segments], targets: [...targets] })
    return !refuse.has(segments.join('/'))
  },
}))
vi.mock('./remove-confirm.js', () => ({ confirmRemoval: async () => true }))

type Queen = { invoke(args: string): Promise<void> }
let queen: Queen

beforeAll(async () => {
  const registry = new Map<string, unknown>([
    ['@hypercomb.social/Lineage', { explorerSegments: () => ['here'] }],
  ])
  ;(globalThis as Record<string, unknown>)['get'] = (key: string) => registry.get(key)
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => registry.set(key, value),
    get: (key: string) => registry.get(key),
    whenReady: () => { /* noop */ },
  }
  await import('./remove.queen.js')
  queen = registry.get('@diamondcoreprocessor.com/RemoveQueenBee') as Queen
})

beforeEach(() => { calls.length = 0; refuse = new Set() })

describe('/remove with page paths', () => {
  it('commits each page its targets sit on, deepest first', async () => {
    await queen.invoke('[x, a/b, a/c, a/b/d]')
    expect(calls).toEqual([
      { segments: ['here', 'a', 'b'], targets: ['d'] },
      { segments: ['here', 'a'], targets: ['b', 'c'] },
      { segments: ['here'], targets: ['x'] },
    ])
  })

  it('normalizes each part of a path on its own', async () => {
    await queen.invoke('A Thing/Sub Tile')
    expect(calls).toEqual([{ segments: ['here', 'a-thing'], targets: ['sub-tile'] }])
  })

  it('a plain name still removes from the current page', async () => {
    await queen.invoke('drafts')
    expect(calls).toEqual([{ segments: ['here'], targets: ['drafts'] }])
  })

  it('says so when any page did not change', async () => {
    refuse = new Set(['here/a'])
    await expect(queen.invoke('[x, a/b]')).rejects.toThrow(/did not run/)
    expect(calls).toHaveLength(2)
  })
})

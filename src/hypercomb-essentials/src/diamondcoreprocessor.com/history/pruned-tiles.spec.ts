// diamondcoreprocessor.com/history/pruned-tiles.spec.ts
//
// The enumeration behind prune mode decides which tiles a participant is
// offered a HARD DELETE of. Every case here is a way that answer could be
// wrong in a direction that costs content: naming a live tile as deleted,
// splitting one tile into several ghosts, or reading an unreadable head as
// "this location has nothing".

import { describe, it, expect } from 'vitest'
import { collectBranchNodes, collectBranchSigs, collectPrunedTiles } from './pruned-tiles.js'
import type { PlacementLayer } from './layer-placement.js'

/** Build a fixture pool: sig → layer, plus a marker list over layer sigs. */
const source = (
  pool: Record<string, PlacementLayer | null>,
  markers: ReadonlyArray<{ layerSig: string; at: number }>,
) => ({
  markers,
  readLayer: async (sig: string): Promise<PlacementLayer | null> => pool[sig] ?? null,
})

describe('collectPrunedTiles', () => {
  it('reports a name the head no longer carries', async () => {
    const pool: Record<string, PlacementLayer> = {
      a: { name: 'alpha' },
      b: { name: 'beta' },
      r1: { name: 'root', children: ['a', 'b'] },
      r2: { name: 'root', children: ['a'] },
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 100 },
      { layerSig: 'r2', at: 200 },
    ]))
    expect(out.map(t => t.name)).toEqual(['beta'])
    expect(out[0].sigs).toEqual(['b'])
    expect(out[0].lastSeenAt).toBe(100)
  })

  it('keeps every sig a deleted name ever held — one tile, not one per edit', async () => {
    const pool: Record<string, PlacementLayer> = {
      b1: { name: 'beta' },
      b2: { name: 'beta', children: ['x'] },
      x: { name: 'x' },
      r1: { name: 'root', children: ['b1'] },
      r2: { name: 'root', children: ['b2'] },
      r3: { name: 'root' },
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 1 },
      { layerSig: 'r2', at: 2 },
      { layerSig: 'r3', at: 3 },
    ]))
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('beta')
    expect(out[0].sigs).toEqual(['b1', 'b2'])
  })

  it('does NOT report a name that was deleted and later created again', async () => {
    const pool: Record<string, PlacementLayer> = {
      b1: { name: 'beta' },
      b2: { name: 'beta' },
      r1: { name: 'root', children: ['b1'] },
      r2: { name: 'root' },
      r3: { name: 'root', children: ['b2'] },
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 1 },
      { layerSig: 'r2', at: 2 },
      { layerSig: 'r3', at: 3 },
    ]))
    expect(out).toEqual([])
  })

  it('falls back to the newest READABLE revision — an unreadable head never marks the whole location deleted', async () => {
    const pool: Record<string, PlacementLayer | null> = {
      a: { name: 'alpha' },
      r1: { name: 'root', children: ['a'] },
      gone: null, // purged / cold head
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 1 },
      { layerSig: 'gone', at: 2 },
    ]))
    expect(out).toEqual([])
  })

  it('ignores children whose layer will not resolve rather than inventing a ghost', async () => {
    const pool: Record<string, PlacementLayer | null> = {
      a: { name: 'alpha' },
      dangling: null,
      r1: { name: 'root', children: ['a', 'dangling'] },
      r2: { name: 'root', children: ['a'] },
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 1 },
      { layerSig: 'r2', at: 2 },
    ]))
    expect(out).toEqual([])
  })

  it('reads the children slot whatever it is called (cells / layers / children)', async () => {
    const pool: Record<string, PlacementLayer> = {
      c: { name: 'gamma' },
      r1: { name: 'root', cells: ['c'] },
      r2: { name: 'root' },
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 1 },
      { layerSig: 'r2', at: 2 },
    ]))
    expect(out.map(t => t.name)).toEqual(['gamma'])
  })

  it('orders newest deletion first', async () => {
    const pool: Record<string, PlacementLayer> = {
      a: { name: 'alpha' },
      b: { name: 'beta' },
      r1: { name: 'root', children: ['a', 'b'] },
      r2: { name: 'root', children: ['b'] },
      r3: { name: 'root' },
    }
    const out = await collectPrunedTiles(source(pool, [
      { layerSig: 'r1', at: 10 },
      { layerSig: 'r2', at: 20 },
      { layerSig: 'r3', at: 30 },
    ]))
    expect(out.map(t => t.name)).toEqual(['beta', 'alpha'])
  })

  it('has nothing to say about a location with no revisions', async () => {
    expect(await collectPrunedTiles(source({}, []))).toEqual([])
  })
})

describe('collectBranchSigs', () => {
  it('takes the whole branch — a deleted tile does not leave its descendants behind', async () => {
    const pool: Record<string, PlacementLayer> = {
      top: { name: 'top', children: ['mid'] },
      mid: { name: 'mid', children: ['leaf'] },
      leaf: { name: 'leaf' },
    }
    const out = await collectBranchSigs(['top'], async sig => pool[sig] ?? null)
    expect(new Set(out)).toEqual(new Set(['top', 'mid', 'leaf']))
  })

  it('visits a shared descendant once', async () => {
    const pool: Record<string, PlacementLayer> = {
      one: { name: 'one', children: ['shared'] },
      two: { name: 'two', children: ['shared'] },
      shared: { name: 'shared' },
    }
    const out = await collectBranchSigs(['one', 'two'], async sig => pool[sig] ?? null)
    expect(out).toHaveLength(3)
  })

  it('stops at an unreadable layer instead of failing the whole walk', async () => {
    const pool: Record<string, PlacementLayer | null> = {
      top: { name: 'top', children: ['gone', 'leaf'] },
      gone: null,
      leaf: { name: 'leaf' },
    }
    const out = await collectBranchSigs(['top'], async sig => pool[sig] ?? null)
    expect(new Set(out)).toEqual(new Set(['top', 'gone', 'leaf']))
  })
})

describe('collectBranchNodes', () => {
  it('gives every descendant its own PATH — which is what addresses its bag', async () => {
    const pool: Record<string, PlacementLayer> = {
      top: { name: 'top', children: ['mid'] },
      mid: { name: 'mid', children: ['leaf'] },
      leaf: { name: 'leaf' },
    }
    const nodes = await collectBranchNodes(['top'], ['root', 'top'], async sig => pool[sig] ?? null)
    const paths = nodes.map(n => n.segments.join('/')).sort()
    expect(paths).toEqual(['root/top', 'root/top/mid', 'root/top/mid/leaf'])
  })

  it('gathers every revision of one place under that one place', async () => {
    const pool: Record<string, PlacementLayer> = {
      t1: { name: 'top' },
      t2: { name: 'top', children: ['leaf'] },
      leaf: { name: 'leaf' },
    }
    const nodes = await collectBranchNodes(['t1', 't2'], ['top'], async sig => pool[sig] ?? null)
    const top = nodes.find(n => n.segments.join('/') === 'top')
    expect([...(top?.sigs ?? [])].sort()).toEqual(['t1', 't2'])
    expect(nodes.map(n => n.segments.join('/')).sort()).toEqual(['top', 'top/leaf'])
  })

  it('keeps an unreadable child as bytes at its parent place rather than dropping it', async () => {
    const pool: Record<string, PlacementLayer | null> = {
      top: { name: 'top', children: ['gone'] },
      gone: null,
    }
    const nodes = await collectBranchNodes(['top'], ['top'], async sig => pool[sig] ?? null)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].segments).toEqual(['top'])
    expect([...nodes[0].sigs].sort()).toEqual(['gone', 'top'])
  })
})

// sharing/branch-difference.spec.ts — the adopt-all door stays lit on a held
// tile while anything beneath it, at any depth, is still untaken.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publisherHoldsUnheldBelow } from './branch-difference.js'
import type { PlacementHistory, PlacementLayer } from '../history/layer-placement.js'

/** A store of layers by sig; `absent` sigs read as a cold miss. */
const historyOf = (layers: Record<string, PlacementLayer>, absent: string[] = []): PlacementHistory => ({
  sign: async () => '',
  currentLayerAt: async () => null,
  commitLayer: async () => '',
  getLayerBySig: async (sig: string) => (absent.includes(sig) ? null : layers[sig] ?? null),
})

// The publisher: root → a → a1 → a1x, and root → b.
const theirs: Record<string, PlacementLayer> = {
  root: { name: 'root', children: ['a', 'b'] },
  a: { name: 'A', children: ['a1'] },
  a1: { name: 'a1', children: ['a1x'] },
  a1x: { name: 'a1x', children: [] },
  b: { name: 'b', children: [] },
}

// Mine carries different sigs for the same names — an adopted copy never
// matches the publisher's bytes, only their names.
const mineFull: Record<string, PlacementLayer> = {
  'my-a': { name: 'a', children: ['my-a1'] },
  'my-a1': { name: 'a1', children: ['my-a1x'] },
  'my-a1x': { name: 'a1x', children: [] },
  'my-b': { name: 'b', children: [] },
}
const mineRoot: PlacementLayer = { name: 'root', children: ['my-a', 'my-b'] }

const never = () => false

describe('publisherHoldsUnheldBelow', () => {
  it('is false when every name the publisher holds is held here, whatever the sigs', async () => {
    const history = historyOf({ ...theirs, ...mineFull })
    expect(await publisherHoldsUnheldBelow(history, 'root', mineRoot, ['root'], never)).toEqual({ unheld: false, incomplete: false })
  })

  it('is true when a GRANDCHILD is missing, though every child is held', async () => {
    const mine = { ...mineFull, 'my-a1': { name: 'a1', children: [] } }
    const history = historyOf({ ...theirs, ...mine })
    expect((await publisherHoldsUnheldBelow(history, 'root', mineRoot, ['root'], never)).unheld).toBe(true)
  })

  it('is true when only the parent was taken', async () => {
    const history = historyOf(theirs)
    expect((await publisherHoldsUnheldBelow(history, 'root', { name: 'root', children: [] }, ['root'], never)).unheld).toBe(true)
  })

  it('a path given back never counts', async () => {
    const mine = { ...mineFull, 'my-a1': { name: 'a1', children: [] } }
    const history = historyOf({ ...theirs, ...mine })
    const gaveBack = (path: readonly string[]) => path.join('/') === 'root/A/a1/a1x'
    expect(await publisherHoldsUnheldBelow(history, 'root', mineRoot, ['root'], gaveBack)).toEqual({ unheld: false, incomplete: false })
  })

  it('a publisher layer not on this device is no evidence — and says the walk was incomplete', async () => {
    const mine = { ...mineFull, 'my-a1': { name: 'a1', children: [] } }
    const history = historyOf({ ...theirs, ...mine }, ['a1x'])
    expect(await publisherHoldsUnheldBelow(history, 'root', mineRoot, ['root'], never)).toEqual({ unheld: false, incomplete: true })
  })

  it('a child of mine that cannot be read is no evidence either', async () => {
    const history = historyOf({ ...theirs, ...mineFull }, ['my-b'])
    expect((await publisherHoldsUnheldBelow(history, 'root', { name: 'root', children: ['my-a', 'my-b'] }, ['root'], never)).unheld).toBe(false)
  })

  it('stops at its budget rather than walking an unbounded branch', async () => {
    const history = historyOf(theirs)
    expect(await publisherHoldsUnheldBelow(history, 'root', mineRoot, ['root'], never, 0)).toEqual({ unheld: false, incomplete: true })
  })
})

describe('the adopt-all door on a held tile', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', ...p), 'utf8')

  it('the divergence scan walks the publisher branch at any depth', () => {
    const src = read('sharing', 'swarm-adopt.drone.ts')
    expect(src.includes('publisherHoldsUnheldBelow(history, sig, held.layer, target, isAdoptTombstoned)')).toBe(true)
    expect(src.includes('else if (below.incomplete) this.#localizeBranchLayers(sig)')).toBe(true)
  })

  it('an incomplete walk brings the layer records over once, never the pictures', () => {
    const src = read('sharing', 'swarm-adopt.drone.ts')
    const a = src.indexOf('#localizeBranchLayers = (sig: string)')
    const body = src.slice(a, src.indexOf('\n  }\n', a))
    expect(body.includes('layersOnly: true')).toBe(true)
    expect(body.includes('this.#localizedBranches.has(sig)')).toBe(true)
    expect(body.includes('#commitBranch')).toBe(false)
  })

  it('the door registers on held profiles and asks the divergence set there', () => {
    const src = read('sharing', 'adopt-branch.drone.ts')
    expect(src.includes("['public-external', 'public-own', 'private']")).toBe(true)
    expect(src.includes('peerDivergesAt(ctx.label)')).toBe(true)
    expect(src.includes("'overlay:register-action', DESCRIPTORS")).toBe(true)
  })

  it('the overlay tells the door whether the tile is held', () => {
    const src = read('presentation', 'tiles', 'tile-overlay.drone.ts')
    expect(src.includes('isExternal: this.#externalLabels.has(label)')).toBe(true)
    expect(src.includes('isExternal: this.#externalLabels.has(entry.label)')).toBe(true)
  })
})

// acquire-inventory.spec.ts — the inventory is READ OUT OF THE SIGNED TREE.
//
// The property under test is the one the manifest could never give: what
// installs is a function of bytes that hashed to their own names, so no
// document a host serves can widen the set (inject a module) or narrow it
// (strand one). Same io mocks as replication-walker.spec.ts — a Map heap and
// a Map origin, real sha256 signatures throughout.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { deriveInventory } from './acquire'
import { isComplete, type ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

type World = {
  heap: Map<string, Uint8Array<ArrayBuffer>>
  origin: Map<string, Uint8Array<ArrayBuffer>>
  io: ReplicationIo
}

const world = (): World => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const origin = new Map<string, Uint8Array<ArrayBuffer>>()
  const io: ReplicationIo = {
    read: async (sig) => heap.get(sig) ?? null,
    fetch: async (sig) => origin.get(sig) ?? null,
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  return { heap, origin, io }
}

/** A layer record in the shape the build emits: child layers in `cells`,
 *  bees and dependencies carrying the writer's `.js` suffix. */
const layer = (record: { cells?: string[]; bees?: string[]; dependencies?: string[] }): Uint8Array<ArrayBuffer> =>
  encode(JSON.stringify({ name: 'layer', cells: [], bees: [], dependencies: [], ...record }))

/** Publish an atom at the origin under its real signature. */
const publish = async (w: World, bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const sig = await sigOf(bytes)
  w.origin.set(sig, bytes)
  return sig
}

describe('inventory derivation', () => {

  it('walks the layer closure and unions what those layers declare', async () => {
    const w = world()
    const beeA = await publish(w, encode('bee a'))
    const beeB = await publish(w, encode('bee b'))
    const dep = await publish(w, encode('dep'))

    const child = await publish(w, layer({ bees: [`${beeB}.js`] }))
    const root = await publish(w, layer({ cells: [child], bees: [`${beeA}.js`], dependencies: [`${dep}.js`] }))

    const { inventory, result } = await deriveInventory(root, w.io)

    expect(isComplete(result)).toBe(true)
    expect(new Set(inventory.layers)).toEqual(new Set([root, child]))
    expect(inventory.bees).toEqual([beeA, beeB].sort())
    expect(inventory.dependencies).toEqual([dep])
  })

  it('cannot be widened by an atom the tree does not name', async () => {
    const w = world()
    const declared = await publish(w, encode('declared bee'))
    // Sitting at the same origin, perfectly well-formed, hashes to its name —
    // and still not part of the package, because no layer names it.
    const injected = await publish(w, encode('injected bee'))
    const root = await publish(w, layer({ bees: [`${declared}.js`] }))

    const { inventory } = await deriveInventory(root, w.io)

    expect(inventory.bees).toEqual([declared])
    expect(inventory.bees).not.toContain(injected)
    expect(inventory.layers).toEqual([root])
  })

  it('follows only `cells` — a bee signature is inventory, never frontier', async () => {
    const w = world()
    // A bee whose bytes happen to be JSON naming another signature. Blind
    // mining would walk into it and file it as a layer; the structured walk
    // treats it as the leaf it is.
    const stranger = await publish(w, encode('stranger'))
    const bee = await publish(w, encode(JSON.stringify({ cells: [stranger] })))
    const root = await publish(w, layer({ bees: [`${bee}.js`] }))

    const { inventory } = await deriveInventory(root, w.io)

    expect(inventory.layers).toEqual([root])
    expect(inventory.bees).toEqual([bee])
  })

  it('folds the writer suffix and collapses duplicates across layers', async () => {
    const w = world()
    const shared = await publish(w, encode('shared dep'))
    const child = await publish(w, layer({ dependencies: [shared] }))          // bare
    const root = await publish(w, layer({ cells: [child], dependencies: [`${shared}.js`] })) // suffixed

    const { inventory } = await deriveInventory(root, w.io)

    expect(inventory.dependencies).toEqual([shared])
  })

  it('reports holes when a child layer is unreachable — the caller refuses', async () => {
    const w = world()
    const missing = await sigOf(encode('a layer nobody serves'))
    const root = await publish(w, layer({ cells: [missing] }))

    const { result } = await deriveInventory(root, w.io)

    expect(isComplete(result)).toBe(false)
    expect(result.holes).toEqual([missing])
  })

  it('refuses bytes that do not hash to their name', async () => {
    const w = world()
    const claimed = await sigOf(encode('the layer that was promised'))
    w.origin.set(claimed, encode('something else entirely'))
    const root = await publish(w, layer({ cells: [claimed] }))

    const { result } = await deriveInventory(root, w.io)

    expect(isComplete(result)).toBe(false)
    expect(result.refused).toEqual([claimed])
  })

  it('treats an unparseable record as a leaf rather than a failure', async () => {
    const w = world()
    const opaque = await publish(w, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) as Uint8Array<ArrayBuffer>)
    const root = await publish(w, layer({ cells: [opaque] }))

    const { inventory, result } = await deriveInventory(root, w.io)

    expect(isComplete(result)).toBe(true)
    expect(new Set(inventory.layers)).toEqual(new Set([root, opaque]))
    expect(inventory.bees).toEqual([])
  })

  it('reuses a verified local copy instead of fetching it again', async () => {
    const w = world()
    const bee = await publish(w, encode('bee'))
    const root = await publish(w, layer({ bees: [`${bee}.js`] }))

    const first = await deriveInventory(root, w.io)
    expect(first.result.fetched).toBe(1)

    const second = await deriveInventory(root, w.io)
    expect(second.result.fetched).toBe(0)
    expect(second.result.present).toBe(1)
    expect(second.inventory).toEqual(first.inventory)
  })
})

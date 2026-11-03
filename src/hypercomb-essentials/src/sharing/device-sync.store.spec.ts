// sharing/device-sync.store.spec.ts — what the real store lends the walk: which
// root directories count as lineage bags, the forward-only marker append, and
// the atoms it serves and admits. An in-memory filesystem, core's real marker
// writer and pool registry.

import { describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { registerPoolMeaning } from '@hypercomb/core'
import { bagHeads, localIo, markerLayerOf, readAtom, serveOf, syncStore } from './device-sync.store.js'
import { lay, markersOf, memStore, putAtom, sha } from './device-sync.fixtures.js'

// jsdom's Blob has no arrayBuffer(); a real browser's does.
vi.stubGlobal('Blob', NodeBlob)

const bag = (n: number) => n.toString(16).padStart(64, 'a')
const sig = (n: number) => n.toString(16).padStart(64, 'c')

describe('which directories are lineage bags', () => {
  it('takes a plain bag at its highest marker, and leaves everything else alone', async () => {
    const store = memStore()
    await lay(store, bag(1), 0, sig(1)); await lay(store, bag(1), 1, sig(2))

    // A pool the registry knows — its markers are NOT a lineage.
    const pool = await registerPoolMeaning('test:device-sync-pool')
    await lay(store, pool, 0, sig(3))
    // A directory that also holds a member file: a pool or a molecule, whatever the registry has heard.
    await lay(store, bag(2), 0, sig(4))
    await (await store.root.getDirectoryHandle(bag(2))).getFileHandle(sig(9), { create: true })
    // A bag whose newest marker is not a layer record.
    const junk = await store.root.getDirectoryHandle(bag(3), { create: true })
    ;(await junk.getFileHandle('00000000', { create: true })).bytes = new TextEncoder().encode('not json')
    // An empty directory, a non-signature directory, a file at the root.
    await store.root.getDirectoryHandle(bag(4), { create: true })
    await lay(store, 'not-a-signature', 0, sig(5))
    await store.root.getFileHandle(sig(6), { create: true })

    expect(await bagHeads(store)).toEqual([{ bag: bag(1), name: '00000001', layer: sig(2) }])
  })

  it('reads a marker by name', async () => {
    const store = memStore()
    await lay(store, bag(1), 0, sig(1)); await lay(store, bag(1), 1, sig(2))
    expect(await markerLayerOf(store, bag(1), '00000000')).toBe(sig(1))
    expect(await markerLayerOf(store, bag(1), '00000007')).toBeNull()
    expect(await markerLayerOf(store, 'nope', '00000000')).toBeNull()
  })
})

describe('the forward-only append', () => {
  it('appends the very next marker once the layer is held, creating the bag if need be', async () => {
    const store = memStore()
    const layer = await putAtom(store, '{"v":0}')
    const next = await putAtom(store, '{"v":1}')
    const append = syncStore(store).appendMarker

    expect(await append(bag(1), '00000000', layer)).toBe(true)
    expect(await append(bag(1), '00000001', next)).toBe(true)
    expect(markersOf(store, bag(1))).toEqual(['00000000', '00000001'])
    expect(await markerLayerOf(store, bag(1), '00000001')).toBe(next)
  })

  it('never replaces, skips ahead, goes back, or names a layer it does not hold', async () => {
    const store = memStore()
    const layer = await putAtom(store, '{"v":0}')
    const other = await putAtom(store, '{"v":1}')
    const append = syncStore(store).appendMarker
    await append(bag(1), '00000000', layer)

    expect(await append(bag(1), '00000000', other)).toBe(false)         // replace
    expect(await append(bag(1), '00000005', other)).toBe(false)         // skip ahead
    expect(await append(bag(1), '00000001', sig(99))).toBe(false)       // layer not held
    expect(await append(bag(2), '00000003', layer)).toBe(false)         // a new bag starts at 0
    expect(await markerLayerOf(store, bag(1), '00000000')).toBe(layer)
    expect(markersOf(store, bag(1))).toEqual(['00000000'])
  })

  it('never puts a marker into a pool or a directory that is not a lineage', async () => {
    const store = memStore()
    const layer = await putAtom(store, '{"v":0}')
    const append = syncStore(store).appendMarker

    const pool = await registerPoolMeaning('test:device-sync-pool-2')
    expect(await append(pool, '00000000', layer)).toBe(false)

    await (await store.root.getDirectoryHandle(bag(7), { create: true })).getFileHandle(sig(9), { create: true })
    expect(await append(bag(7), '00000000', layer)).toBe(false)
    expect(markersOf(store, bag(7))).toEqual([sig(9)])
  })
})

describe('atoms', () => {
  it('serves held atoms and heads, and answers nothing for what it lacks', async () => {
    const store = memStore()
    const layer = await putAtom(store, '{"hello":1}')
    await lay(store, bag(1), 0, layer)
    const serve = serveOf(store)
    expect(new TextDecoder().decode((await serve.atom(layer))!)).toBe('{"hello":1}')
    expect(await serve.atom(sig(42))).toBeNull()
    expect(await serve.heads!()).toEqual([{ bag: bag(1), name: '00000000', layer }])
    expect(await serve.marker!(bag(1), '00000000')).toBe(layer)
    expect(await readAtom(store, 'not-a-signature')).toBeNull()
  })

  it('admits bytes under the name the store itself computes, and refuses a disagreement', async () => {
    const store = memStore()
    const bytes = new TextEncoder().encode('admit me')
    const name = await sha(bytes)
    await localIo(store).write(name, bytes)
    expect(new TextDecoder().decode((await localIo(store).read(name))!)).toBe('admit me')
    await expect(localIo(store).write(sig(1), bytes)).rejects.toThrow()
  })
})

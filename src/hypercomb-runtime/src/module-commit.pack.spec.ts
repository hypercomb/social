// @vitest-environment node
//
// module-commit.pack.spec.ts — A COMMIT'S TRANSFER PACK is minted in memory
// from the files the package holds (module-drafts.ts packFiles), complete or
// absent: every file inside was hashed to its own name when it was stored
// (and is hashed again only by the receiver, on arrival), and a file that is
// not held here means no pack at all — a door never serves a pack that silently
// lacks part of the package. Nothing is written into the hive.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { packFiles, type ModuleDraftDeps } from './module-drafts'
import { decodeTransferPack, gunzipBytes } from './transfer-pack'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const world = async () => {
  const layers = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array<ArrayBuffer>>()
  const dependencies = new Map<string, Uint8Array<ArrayBuffer>>()
  const add = async (into: Map<string, Uint8Array<ArrayBuffer>>, text: string): Promise<string> => {
    const bytes = encode(text)
    const sig = await sigOf(bytes)
    into.set(sig, bytes)
    return sig
  }
  const bee = await add(bees, '// src/games/solomon/solomon.drone.ts\nexport {};')
  const dependency = await add(dependencies, '// @hypercomb/essentials/games/solomon/labyrinth\n// lazy — an atom\nexport const rooms = 1;')
  const layer = await add(layers, JSON.stringify({ name: 'solomon', cells: [], bees: [bee], dependencies: [] }))
  const root = await add(layers, JSON.stringify({ name: 'root', cells: [layer], bees: [], dependencies: [dependency] }))
  const io: ReplicationIo = { read: async sig => layers.get(sig) ?? null, fetch: async () => null, write: async () => {} }
  const deps = {
    trunk: () => root,
    store: () => ({ getBeeBytes: async (sig: string) => bees.get(sig) ?? null, getDependencyBytes: async (sig: string) => dependencies.get(sig) ?? null }),
    layers: async () => io,
  } as unknown as ModuleDraftDeps
  return { files: [root, layer, bee, dependency], deps, layers, bees, dependencies }
}

describe('packFiles', () => {
  it('packs every file of the package, each under its own name', async () => {
    const w = await world()
    const pack = await packFiles(w.files, w.deps)
    expect(pack).not.toBeNull()
    expect(await SignatureService.sign(pack!.bytes.slice().buffer as ArrayBuffer)).toBe(pack!.sig)
    const members = decodeTransferPack(await gunzipBytes(pack!.bytes))!
    expect(members.map(([sig]) => sig).sort()).toEqual([...w.files].sort())
    for (const [sig, bytes] of members) expect(await sigOf(bytes)).toBe(sig)
  })

  it('packs the same files to the same pack, whatever order they come in', async () => {
    const w = await world()
    expect((await packFiles([...w.files].reverse(), w.deps))?.sig).toBe((await packFiles(w.files, w.deps))?.sig)
  })

  it('mints nothing when a file is not held here', async () => {
    const w = await world()
    expect(await packFiles([...w.files, 'e'.repeat(64)], w.deps)).toBeNull()
  })

  it('does not hash held files again: the receiver hashes each one on arrival', async () => {
    const w = await world()
    const bee = w.files[2]!
    w.bees.set(bee, encode('tampered'))
    const minted = await packFiles(w.files, w.deps)
    expect(minted).not.toBeNull()
    const members = decodeTransferPack(await gunzipBytes(minted!.bytes))!
    const carried = new Map(members)
    expect(await SignatureService.sign(carried.get(bee)!.slice().buffer as ArrayBuffer)).not.toBe(bee)
  })
})

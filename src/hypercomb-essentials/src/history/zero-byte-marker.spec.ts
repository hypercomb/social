// @vitest-environment jsdom
//
// history/zero-byte-marker.spec.ts — ZERO BYTES ARE NOT A LAYER.
//
// A marker file exists, empty, from the moment its writer creates it until
// the bytes are closed. Two first reads of a new tile's bag raced: the second
// saw the file, read zero bytes, took them for a legacy marker (whose bytes
// ARE the layer) and answered with the signature of nothing. The commit that
// asked linked that signature into the parent as the tile. Nothing can ever
// answer it with a layer (and no store can hold it: it is the root lineage
// bag's own address), so the parent carried a child that read as "cold" for
// good, and every write that re-lists its siblings was refused: on a managed
// site door the owner's card could never be brought in (2026-11-14).
//
// Driven against the REAL HistoryService over an in-memory OPFS whose files,
// like real ones, are created empty and filled only when the writer closes.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService, mintMetaEnvelope } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {},
  }
})

/** How long a close takes: the window in which the file exists and is empty. */
const CLOSE_MS = 20

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    const exact = this.bytes.slice().buffer
    return Object.assign(new Blob([exact]), {
      name: this.name, lastModified: 1,
      arrayBuffer: async () => exact,
      text: async () => new TextDecoder().decode(exact),
    }) as File
  }
  async createWritable() {
    let pending = new Uint8Array()
    return {
      write: async (value: ArrayBuffer | Uint8Array | string) => {
        pending = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      },
      // The bytes land when the writer closes, never before.
      close: async () => {
        await new Promise<void>(resolve => setTimeout(resolve, CLOSE_MS))
        this.bytes = pending
      },
      abort: async () => {},
    }
  }
}

class MemoryDirectory {
  readonly kind = 'directory'
  readonly files = new Map<string, MemoryFile>()
  readonly dirs = new Map<string, MemoryDirectory>()
  constructor(readonly name = '') {}
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (this.dirs.has(name)) throw new DOMException('Directory at file address', 'TypeMismatchError')
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) throw new DOMException('File absent', 'NotFoundError')
      this.files.set(name, file = new MemoryFile(name))
    }
    return file
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    if (this.files.has(name)) throw new DOMException('File at directory address', 'TypeMismatchError')
    let directory = this.dirs.get(name)
    if (!directory) {
      if (!options.create) throw new DOMException('Directory absent', 'NotFoundError')
      this.dirs.set(name, directory = new MemoryDirectory(name))
    }
    return directory
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw new DOMException('Absent', 'NotFoundError')
  }
  async *entries() {
    for (const entry of [...this.files]) yield entry
    for (const entry of [...this.dirs]) yield entry
  }
}

const services = new Map<string, unknown>()
const get = (key: string) => services.get(key)
;(globalThis as Record<string, unknown>)['get'] = get
;(window as unknown as { ioc: unknown }).ioc = {
  get, whenReady: () => {}, register: (key: string, value: unknown) => services.set(key, value),
}

class MuteChannel {
  constructor(_name: string) {}
  postMessage(): void {}
  set onmessage(_handler: unknown) {}
  close(): void {}
}
const RealChannel = globalThis.BroadcastChannel
const withMute = <T>(make: () => T): T => {
  ;(globalThis as Record<string, unknown>)['BroadcastChannel'] = MuteChannel
  try { return make() } finally { (globalThis as Record<string, unknown>)['BroadcastChannel'] = RealChannel }
}

const { HistoryService, ROOT_NAME } = await import('./history.service.js')
const { childNamesOfStrict, readChildrenStrict } = await import('./layer-placement.js')
type Placement = Parameters<typeof childNamesOfStrict>[0]

const sign = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
const NOTHING = await SignatureService.sign(new ArrayBuffer(0))

const world = async () => {
  localStorage.clear()
  const root = new MemoryDirectory()
  /** Content lands whole: only MARKERS are written through a slow close. */
  const put = async (bytes: Uint8Array): Promise<string> => {
    const sig = await sign(bytes)
    const file = await root.getFileHandle(sig, { create: true })
    file.bytes = new Uint8Array(bytes)
    return sig
  }
  const store: Record<string, unknown> = {
    hypercombRoot: root, opfsRoot: root,
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
    },
  }
  services.clear()
  services.set('@hypercomb.social/Store', store)
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: () => 'test.example' })
  const history = withMute(() => new HistoryService())
  const rootLoc = await history.sign({ explorerSegments: () => [] } as never)
  const at = (name: string): Promise<string> => history.sign({ explorerSegments: () => [name] } as never)
  const putJson = (value: unknown): Promise<string> => put(new TextEncoder().encode(JSON.stringify(value)))
  return { root, history, rootLoc, at, putJson }
}

afterEach(() => { services.clear() })

describe('a new tile\'s first marker', () => {
  it('is never read while it is still empty: two first reads answer the same real layer', async () => {
    const w = await world()
    // The parent is warm and carries nothing under the name: a brand-new bag.
    await w.history.latestMarkerSigFor(w.rootLoc, ROOT_NAME)
    const loc = await w.at('image')
    const [first, second] = await Promise.all([
      w.history.latestMarkerSigFor(loc, 'image'),
      w.history.latestMarkerSigFor(loc, 'image'),
    ])
    expect(first).not.toBe(NOTHING)
    expect(second).toBe(first)
    // What it names is a layer that is really there.
    expect((await w.history.getLayerBySig(first))?.name).toBe('image')
  })

  it('waits for a marker another writer is still closing', async () => {
    const w = await world()
    const loc = await w.at('late')
    const layerSig = await w.putJson({ name: 'late' })
    const bag = await w.root.getDirectoryHandle(loc, { create: true })
    const marker = await bag.getFileHandle('00000000', { create: true })
    // Another tab's write: the file is there, its bytes arrive shortly.
    setTimeout(() => { marker.bytes = new TextEncoder().encode(JSON.stringify({ layer: layerSig })) }, 30)
    expect(await w.history.latestMarkerSigFor(loc, 'late')).toBe(layerSig)
  })

  it('refuses a marker that stays empty, and never answers the signature of nothing', async () => {
    const w = await world()
    const loc = await w.at('torn')
    const bag = await w.root.getDirectoryHandle(loc, { create: true })
    await bag.getFileHandle('00000000', { create: true })
    await expect(w.history.latestMarkerSigFor(loc, 'torn')).rejects.toThrow(/empty/)
  })
})

describe('a reference to the signature of nothing', () => {
  const envelope = (layer: string): unknown => mintMetaEnvelope({ layer, relation: 'children' })

  it('is dead, through its envelope or bare; a live or merely cold one is not', async () => {
    const w = await world()
    const live = await w.putJson({ name: 'alpha' })
    const liveRef = await w.putJson(envelope(live))
    const deadRef = await w.putJson(envelope(NOTHING))
    const cold = 'c'.repeat(64)
    expect(await w.history.isDeadLayerReference(deadRef)).toBe(true)
    expect(await w.history.isDeadLayerReference(NOTHING)).toBe(true)
    expect(await w.history.isDeadLayerReference(liveRef)).toBe(false)
    expect(await w.history.isDeadLayerReference(live)).toBe(false)
    expect(await w.history.isDeadLayerReference(cold)).toBe(false)
    expect(await w.history.isDeadLayerReference('not a signature')).toBe(false)
  })

  it('does not hold its siblings: a strict read leaves it out and reports no cold miss', async () => {
    const w = await world()
    const live = await w.putJson({ name: 'alpha' })
    const liveRef = await w.putJson(envelope(live))
    const deadRef = await w.putJson(envelope(NOTHING))
    const history = w.history as unknown as Placement
    expect(await childNamesOfStrict(history, { name: ROOT_NAME, children: [deadRef] }))
      .toEqual({ names: [], coldMiss: false })
    expect(await childNamesOfStrict(history, { name: ROOT_NAME, children: [deadRef, liveRef] }))
      .toEqual({ names: ['alpha'], coldMiss: false })
  })

  it('a child that is only cold still refuses the write', async () => {
    const w = await world()
    const deadRef = await w.putJson(envelope(NOTHING))
    const history = w.history as unknown as Placement
    const read = await childNamesOfStrict(history, { name: ROOT_NAME, children: [deadRef, 'c'.repeat(64)] })
    expect(read.coldMiss).toBe(true)
  })

  it('a strict children read gives the rest of the page, not null', async () => {
    const w = await world()
    const live = await w.putJson({ name: 'alpha' })
    const liveRef = await w.putJson(envelope(live))
    const deadRef = await w.putJson(envelope(NOTHING))
    await w.history.commitLayer(w.rootLoc, { name: ROOT_NAME, children: [deadRef, liveRef] } as never)
    const rows = await readChildrenStrict(w.history as unknown as Placement, () => 'test.example', [])
    expect(rows?.map(row => row.name)).toEqual(['alpha'])
  })
})

// @vitest-environment jsdom
//
// history/tile-order.commit.spec.ts — WHERE A TILE SITS IS ITS PAGE'S CLAIM.
//
// Drives the REAL HistoryService and LayerCommitter over an in-memory OPFS
// (the two-tab-commit harness): a page's seats ride in the page's own marker,
// a tile's layer never changes for where it sits, and a new tile takes its
// seat in the marker that adds it — one undo step.

import { describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {},
  }
})

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
    return {
      write: async (value: ArrayBuffer | Uint8Array | string) => {
        this.bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      },
      close: async () => {},
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

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(reader.result as ArrayBuffer)
  reader.readAsArrayBuffer(blob)
})

const { HistoryService, ROOT_NAME } = await import('./history.service.js')
const { LayerCommitter } = await import('./layer-committer.drone.js')
const { readOrderAt, registerSeatChooser } = await import('./tile-order.js')
type History = InstanceType<typeof HistoryService>

const committer = new LayerCommitter()

const world = async (): Promise<{ root: MemoryDirectory; history: History; rootLoc: string }> => {
  localStorage.clear()
  const root = new MemoryDirectory()
  const local = async (sig: string) => root.files.get(sig)?.getFile() ?? null
  const store: Record<string, unknown> = {
    hypercombRoot: root, opfsRoot: root,
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    getResourceLocal: local,
    // The real store follows a resource incidence to the bytes it names.
    getResource: async (sig: string): Promise<Blob | null> => {
      const file = await local(sig)
      if (!file) return null
      try {
        const parsed = JSON.parse(await file.text())
        if (parsed?.meta === 1 && typeof parsed.resource === 'string') return local(parsed.resource)
      } catch { /* not JSON — the bytes themselves */ }
      return file
    },
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
    },
    putResource: async (blob: Blob) => {
      const bytes = await readBlob(blob)
      const sig = await SignatureService.sign(bytes)
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
      return sig
    },
  }
  services.clear()
  services.set('@hypercomb.social/Store', store)
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: () => 'test.example' })
  const history = new HistoryService()
  services.set('@diamondcoreprocessor.com/HistoryService', history)
  services.set('@diamondcoreprocessor.com/HistoryCursorService', { state: { rewound: false }, onNewLayer: async () => {} })
  const rootLoc = await history.sign({ explorerSegments: () => [] })
  return { root, history, rootLoc }
}

const markers = async (history: History, loc: string): Promise<number> => (await history.listLayers(loc)).length

const head = async (history: History, loc: string, name = ROOT_NAME) =>
  history.getLayerBySig(await history.latestMarkerSigFor(loc, name))

const childSigByName = async (history: History, loc: string): Promise<Map<string, string>> => {
  const out = new Map<string, string>()
  for (const sig of ((await head(history, loc))?.children as string[] | undefined) ?? []) {
    const child = await history.getLayerBySig(sig)
    if (child?.name) out.set(String(child.name), sig)
  }
  return out
}

describe('a page’s seats ride in the page’s own marker', () => {
  it('re-seating is ONE marker at the page, and no tile’s layer changes', async () => {
    const w = await world()
    await committer.importTree([{ segments: ['desk'], layer: { name: 'desk' } }, { segments: ['inbox'], layer: { name: 'inbox' } }])
    const before = await childSigByName(w.history, w.rootLoc)
    const count = await markers(w.history, w.rootLoc)

    await committer.commitOrder([], { set: { desk: 4, inbox: 1 } })

    expect(await markers(w.history, w.rootLoc)).toBe(count + 1)
    expect([...await readOrderAt([])].sort()).toEqual([['desk', 4], ['inbox', 1]])
    expect(await childSigByName(w.history, w.rootLoc)).toEqual(before)
  })

  it('builds on the seats already there', async () => {
    await world()
    await committer.commitOrder([], { set: { desk: 4 } })
    await committer.commitOrder([], { set: { inbox: 0 }, remove: ['desk'] })
    expect([...await readOrderAt([])]).toEqual([['inbox', 0]])
  })

  it('a move’s landing seat rides with its append — the appended sig is the tile’s own', async () => {
    const w = await world()
    await committer.importTree([{ segments: ['work'], layer: { name: 'work' } }, { segments: ['desk'], layer: { name: 'desk' } }])
    const desk = (await childSigByName(w.history, w.rootLoc)).get('desk')!
    const workLoc = await w.history.sign({ explorerSegments: () => ['work'] })
    const count = await markers(w.history, workLoc)

    await committer.commitChildrenDeltas(['work'], { appends: [desk], order: { set: { desk: 0 } } })

    expect(await markers(w.history, workLoc)).toBe(count + 1)
    expect(((await head(w.history, workLoc, 'work'))?.children as string[])).toContain(desk)
    expect([...await readOrderAt(['work'])]).toEqual([['desk', 0]])
  })

  it('a current order that cannot be read is left alone, never rebuilt from nothing', async () => {
    const w = await world()
    await committer.commitOrder([], { set: { desk: 4, inbox: 1 } })
    const kept = (await head(w.history, w.rootLoc))?.['order']
    // The resource behind the head's order is gone from this replica.
    const ref = String((kept as string[])[0])
    const meta = JSON.parse(await (await w.root.files.get(ref)!.getFile()).text())
    w.root.files.delete(typeof meta?.resource === 'string' ? meta.resource : ref)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await committer.commitOrder([], { set: { desk: 9 } })

    expect((await head(w.history, w.rootLoc))?.['order']).toEqual(kept)
    expect(warn.mock.calls.flat().map(String).some(s => s.includes('order change skipped'))).toBe(true)
    warn.mockRestore()
  })
})

describe('a new tile takes its seat in the marker that adds it', () => {
  it('through the create path’s importTree', async () => {
    const w = await world()
    // A page that already exists (its first touch plants a genesis marker).
    await committer.importTree([{ segments: ['inbox'], layer: { name: 'inbox' } }])
    const count = await markers(w.history, w.rootLoc)
    registerSeatChooser((segments, name) => segments.length === 0 && name === 'desk' ? 5 : undefined)
    try {
      await committer.importTree([{ segments: ['desk'], layer: { name: 'desk' } }])
    } finally { registerSeatChooser(null) }
    expect(await markers(w.history, w.rootLoc)).toBe(count + 1)
    expect([...await readOrderAt([])]).toEqual([['desk', 5]])
    // The tile's own layer carries no seat.
    const deskLoc = await w.history.sign({ explorerSegments: () => ['desk'] })
    expect((await head(w.history, deskLoc, 'desk'))?.['properties']).toBeUndefined()
  })

  it('takes no seat for a page the chooser cannot speak for', async () => {
    await world()
    registerSeatChooser(() => undefined)
    try {
      await committer.importTree([{ segments: ['desk'], layer: { name: 'desk' } }])
    } finally { registerSeatChooser(null) }
    expect((await readOrderAt([])).size).toBe(0)
  })
})

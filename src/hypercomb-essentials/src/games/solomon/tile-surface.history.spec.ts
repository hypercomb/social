// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { SolomonTileSurface } from './tile-surface.js'
import type { RoomDef } from './labyrinth.js'

// Real HistoryService + LayerCommitter + typed metadata. Only the browser's
// OPFS handles are replaced; all addressing, writes and reads remain real.
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {},
  }
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear() })

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
    for (const entry of this.files) yield entry
    for (const entry of this.dirs) yield entry
  }
}

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(reader.result as ArrayBuffer)
  reader.readAsArrayBuffer(blob)
})

it('creates and reopens a real signed native room through OPFS markers and metadata incidences', async () => {
  // Keep FileReader's setImmediate delivery real while suppressing the
  // HistoryService background housekeeping scheduled with setTimeout.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  localStorage.clear()
  const root = new MemoryDirectory()
  const store = {
    hypercombRoot: root, opfsRoot: root,
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    getResourceLocal: async (sig: string) => {
      const file = root.files.get(sig)
      return file ? file.getFile() : null
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
  const services = new Map<string, unknown>([
    ['@hypercomb.social/Store', store],
    ['@hypercomb.social/Lineage', { explorerSegments: () => ['elsewhere'], domain: () => 'test.example' }],
  ])
  const get = (key: string) => services.get(key)
  ;(globalThis as Record<string, unknown>)['get'] = get
  ;(window as unknown as { ioc: unknown }).ioc = {
    get, whenReady: () => {}, register: (key: string, service: unknown) => services.set(key, service),
  }
  const { HistoryService } = await import('../../history/history.service.js')
  const { LayerCommitter } = await import('../../history/layer-committer.drone.js')
  const history = new HistoryService()
  services.set('@diamondcoreprocessor.com/HistoryService', history)
  const committer = new LayerCommitter()
  const noteLocation = await history.sign({ explorerSegments: () => ['notes'] })
  const note = await history.commitLayer(noteLocation, { name: 'notes', title: 'Keep this tile' })
  const home = await history.sign({ explorerSegments: () => [] })
  await history.commitLayer(home, { name: '/', children: [note] })
  const room: RoomDef = {
    id: 'native-entry', labyrinthId: 'native', depth: 0, doors: [], relics: [], gates: [],
    level: {
      name: 'Native entry', cols: 4, rows: 3,
      tiles: [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1],
      player: { col: 1, row: 1 }, door: { col: 2, row: 1 }, enemies: [], mirrors: [],
      items: [{ kind: 'treasure', col: 2, row: 1, secret: true, deep: true, hidden: true }],
    },
  }
  const surface = new SolomonTileSurface({ history, committer, parentSegments: [], domain: () => 'different.example' })
  const loaded = await surface.ensureRoom(room)
  expect(loaded.room).toEqual(room)
  expect(loaded.tiles).toHaveLength(12)
  const nativeRoom = await history.currentLayerAt(await history.sign({ explorerSegments: () => loaded.roomSegments }))
  expect(nativeRoom!.children).toHaveLength(12)
  for (const ref of nativeRoom!.children!) {
    const incidence = JSON.parse(new TextDecoder().decode(root.files.get(ref)!.bytes))
    expect(incidence).toMatchObject({ meta: 1, relation: 'children' })
    expect(incidence.layer).toMatch(/^[a-f0-9]{64}$/)
    expect((await history.getLayerBySig(ref))!['solomonTile']).toBeDefined()
  }
  const edited = loaded.tiles[5]
  await committer.update(edited.segments, { solomonTile: { ...(edited.layer['solomonTile'] as object), code: 2 } })
  // New service has no in-memory layer/head caches; it must read saved markers
  // and typed pool records. The current navigation still points elsewhere.
  const reopenedHistory = new HistoryService()
  services.set('@diamondcoreprocessor.com/HistoryService', reopenedHistory)
  const reopened = await new SolomonTileSurface({ history: reopenedHistory, committer, parentSegments: [] }).ensureRoom(room)
  expect(reopened.level.tiles[5]).toBe(2)
  expect(reopened.level.items).toEqual(room.level.items)
  const rootAfter = await reopenedHistory.currentLayerAt(home)
  const rootChildren = await Promise.all(rootAfter!.children!.map(sig => reopenedHistory.getLayerBySig(sig)))
  expect(rootChildren.map(layer => layer?.name)).toEqual(['notes', 'solomon-maze-v1'])
  expect(rootChildren[0]!['title']).toBe('Keep this tile')
  expect((services.get('@hypercomb.social/Lineage') as { explorerSegments(): string[] }).explorerSegments()).toEqual(['elsewhere'])
}, 15000)

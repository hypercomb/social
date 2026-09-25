import { Blob as NodeBlob } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { SignatureService, mintMetaEnvelope } from '@hypercomb/core'
import { QuickMenuRegistry } from '../../hypercomb-essentials/src/quickmenu/quick-menu-registry.service'
import { writeCreation, type CreationStore } from './meaning-creations'
import {
  initializeQuickMenuPool, refreshQuickMenus, validQuickMenu, writeQuickMenu,
  type QuickMenuCache, type QuickMenuData,
} from './quick-menu-pool'

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  async getFile(): Promise<Blob> { return new NodeBlob([exact(this.bytes)]) as Blob }
  async createWritable(): Promise<{ write: (value: ArrayBuffer) => Promise<void>; close: () => Promise<void> }> {
    return { write: async value => { this.bytes = new Uint8Array(value) }, close: async () => {} }
  }
}

class MemoryDir {
  readonly kind = 'directory'
  files = new Map<string, MemoryFile>()
  dirs = new Map<string, MemoryDir>()
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    const found = this.files.get(name)
    if (found) return found
    if (!options?.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' })
    const file = new MemoryFile()
    this.files.set(name, file)
    return file
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDir> {
    const found = this.dirs.get(name)
    if (found) return found
    if (!options?.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' })
    const dir = new MemoryDir()
    this.dirs.set(name, dir)
    return dir
  }
  async *entries(): AsyncGenerator<[string, MemoryFile | MemoryDir]> {
    for (const entry of this.files) yield entry
    for (const entry of this.dirs) yield entry
  }
}

class MemoryStore {
  pools = new Map<string, MemoryDir>()
  content = new Map<string, Uint8Array>()
  async getPool(meaning: string): Promise<FileSystemDirectoryHandle> {
    let pool = this.pools.get(meaning)
    if (!pool) this.pools.set(meaning, pool = new MemoryDir())
    return pool as unknown as FileSystemDirectoryHandle
  }
  async openPool(meaning: string): Promise<FileSystemDirectoryHandle | null> {
    return this.pools.get(meaning) as unknown as FileSystemDirectoryHandle ?? null
  }
  async writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void> {
    if (await SignatureService.sign(bytes) === sig) this.content.set(sig, new Uint8Array(bytes))
  }
  async getLayerPoolBytes(sig: string): Promise<Uint8Array | null> { return this.content.get(sig) ?? null }
  async putArtifactMeta(_kind: 'layer', sig: string, incidence: Record<string, unknown>): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(mintMetaEnvelope({ layer: sig, ...incidence })))
    const name = await digest(bytes)
    this.content.set(name, bytes)
    return name
  }
  async getResourceLocal(sig: string): Promise<Blob | null> {
    const bytes = this.content.get(sig)
    return bytes ? new NodeBlob([exact(bytes)]) as Blob : null
  }
}

const menu = (title: string): QuickMenuData => ({
  name: 'reading', title, contexts: ['document'],
  slots: [{ direction: 'centre', label: 'Close', action: { kind: 'command', command: 'view', args: 'hexagons' } }],
})

class Cache implements QuickMenuCache {
  definitions = new Map<string, QuickMenuData>([['reading', menu('Included')]])
  writer: ((definition: QuickMenuData) => Promise<QuickMenuData | null>) | null = null
  all(): readonly QuickMenuData[] { return [...this.definitions.values()] }
  register(definition: QuickMenuData): void { this.definitions.set(definition.name, definition) }
  setWriter(writer: typeof this.writer): void { this.writer = writer }
}

describe('quick menu meaning pool', () => {
  it('accepts every included ring through the same pool writer', async () => {
    const store = new MemoryStore()
    const registry = new QuickMenuRegistry()
    await initializeQuickMenuPool(store as CreationStore, registry)
    expect((await refreshQuickMenus(store as CreationStore, registry)).map(menu => menu.name))
      .toEqual(registry.names())
  })

  it('seeds the local default and reads only the current signed location head', async () => {
    const store = new MemoryStore()
    const cache = new Cache()
    await initializeQuickMenuPool(store as CreationStore, cache)
    expect(cache.writer).toBeTypeOf('function')
    const first = await writeQuickMenu(store as CreationStore, menu('First revision'))
    const second = await writeQuickMenu(store as CreationStore, menu('Second revision'))
    expect(first?.title).toBe('First revision')
    expect(second?.title).toBe('Second revision')
    await refreshQuickMenus(store as CreationStore, cache)
    expect(cache.definitions.get('reading')?.title).toBe('Second revision')
    expect(store.pools.get('menus:quick')?.dirs.size).toBe(1)
    expect([...store.pools.get('menus:quick')!.dirs.values()][0].files.size).toBe(3)
  })

  it('rejects malformed actions and ignores a validly hashed layer with an invalid menu', async () => {
    const store = new MemoryStore()
    const cache = new Cache()
    expect(validQuickMenu({ ...menu('No'), slots: [
      { direction: 'east', label: 'A', action: { kind: 'script', code: 'run()' } },
    ] })).toBe(false)
    expect(await writeQuickMenu(store as CreationStore, {
      ...menu('No'), slots: [
        { direction: 'east', label: 'A', action: { kind: 'menu', menu: 'reading' } },
        { direction: 'east', label: 'B', action: { kind: 'menu', menu: 'reading' } },
      ],
    })).toBeNull()
    await writeCreation(store as CreationStore, 'menus:quick', 'reading', {
      name: 'quick-menu', definition: { ...menu('Unsafe'), slots: [{ direction: 'centre', label: 'Run', action: { kind: 'script' } }] },
    })
    expect(await refreshQuickMenus(store as CreationStore, cache)).toEqual([])
    expect(cache.definitions.get('reading')?.title).toBe('Included')
  })
})

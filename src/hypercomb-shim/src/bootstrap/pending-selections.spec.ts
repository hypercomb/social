import { describe, expect, it } from 'vitest'
import { SignatureService, mintMetaEnvelope } from '@hypercomb/core'
import type { CreationStore } from '@hypercomb/runtime/meaning-creations'
import { clearPendingSelectionLayer, listPendingSelectionLayers,
  PENDING_SELECTIONS_MEANING, stagePendingSelectionLayer } from './pending-selections'

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))
const fileOf = (bytes: Uint8Array): Blob => ({
  arrayBuffer: async () => exact(bytes),
  text: async () => new TextDecoder().decode(bytes),
}) as Blob

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  async getFile(): Promise<Blob> { return fileOf(this.bytes) }
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
    const made = new MemoryFile()
    this.files.set(name, made)
    return made
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDir> {
    const found = this.dirs.get(name)
    if (found) return found
    if (!options?.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' })
    const made = new MemoryDir()
    this.dirs.set(name, made)
    return made
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
    return bytes ? fileOf(bytes) : null
  }
}

describe('pending offering selections', () => {
  it('keeps multiple choices by stable location and resolves only the chosen head', async () => {
    const memory = new MemoryStore()
    const store = memory as CreationStore
    const garden = { source: 'example.com', route: 'https://garden.example.com/',
      pubkey: 'a'.repeat(64), lineage: 'garden', head: 'b'.repeat(64) }
    const studio = { ...garden, route: 'https://studio.example.com/', lineage: 'studio' }
    expect(await stagePendingSelectionLayer(store, garden)).toBe(true)
    expect(await stagePendingSelectionLayer(store, studio)).toBe(true)
    expect(await stagePendingSelectionLayer(store, garden)).toBe(true)
    expect((await listPendingSelectionLayers(store)).map(row => 'kind' in row ? row.key : row.lineage).sort()).toEqual(['garden', 'studio'])
    expect([...memory.pools.get(PENDING_SELECTIONS_MEANING)!.dirs.values()]
      .map(bag => bag.files.size)).toEqual([1, 1])

    const newerGarden = { ...garden, head: 'c'.repeat(64) }
    expect(await stagePendingSelectionLayer(store, newerGarden)).toBe(true)
    expect(await clearPendingSelectionLayer(store, garden)).toBe(false)
    expect((await listPendingSelectionLayers(store)).find(row => !('kind' in row) && row.lineage === 'garden')?.head)
      .toBe(newerGarden.head)

    expect(await clearPendingSelectionLayer(store, newerGarden)).toBe(true)
    expect((await listPendingSelectionLayers(store)).map(row => 'kind' in row ? row.key : row.lineage)).toEqual(['studio'])
    const pool = memory.pools.get(PENDING_SELECTIONS_MEANING)!
    expect(pool.dirs.size).toBe(2)
    expect([...pool.dirs.values()].map(bag => bag.files.size).sort()).toEqual([1, 3])
  })

  it('rejects an unsafe remote reference before writing a pool member', async () => {
    const memory = new MemoryStore()
    const store = memory as CreationStore
    expect(await stagePendingSelectionLayer(store, { source: 'example.com',
      route: 'http://garden.example.com/', pubkey: 'a'.repeat(64),
      lineage: 'garden', head: 'b'.repeat(64) })).toBe(false)
    expect(memory.pools.size).toBe(0)
  })

  it('holds creation and site choices in the same pool while the latest location head decides', async () => {
    const memory = new MemoryStore()
    const store = memory as CreationStore
    const site = { source: 'example.com', route: 'https://garden.example.com/',
      pubkey: 'a'.repeat(64), lineage: 'garden', head: 'b'.repeat(64) }
    const theme = { kind: 'creation' as const, source: 'example.com', pubkey: 'a'.repeat(64),
      meaning: 'themes:text', key: 'editorial', location: 'c'.repeat(64), head: 'd'.repeat(64) }
    expect(await stagePendingSelectionLayer(store, site)).toBe(true)
    expect(await stagePendingSelectionLayer(store, theme)).toBe(true)
    expect(await listPendingSelectionLayers(store)).toHaveLength(2)
    const newer = { ...theme, head: 'e'.repeat(64) }
    expect(await stagePendingSelectionLayer(store, newer)).toBe(true)
    expect(await clearPendingSelectionLayer(store, theme)).toBe(false)
    expect((await listPendingSelectionLayers(store)).find(row => 'kind' in row)?.head).toBe(newer.head)
    expect(await clearPendingSelectionLayer(store, newer)).toBe(true)
    expect((await listPendingSelectionLayers(store)).map(row => 'kind' in row ? row.key : row.lineage)).toEqual(['garden'])
    expect(memory.pools.get(PENDING_SELECTIONS_MEANING)?.dirs.size).toBe(2)
  })
})

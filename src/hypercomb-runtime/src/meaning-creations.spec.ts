import { describe, expect, it } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { SignatureService, mintMetaEnvelope } from '@hypercomb/core'
import { disableCreation, installCreationHead, listCreations, readCreation, writeCreation,
  type CreationStore } from './meaning-creations'

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  async getFile(): Promise<Blob> { return new NodeBlob([exact(this.bytes)]) as Blob }
  async createWritable(): Promise<{ write: (value: ArrayBuffer) => Promise<void>; close: () => Promise<void> }> {
    return {
      write: async value => { this.bytes = new Uint8Array(value) },
      close: async () => {},
    }
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
    return bytes ? new NodeBlob([exact(bytes)]) as Blob : null
  }
}

type Layer = { name: string; label: string; read: string; code: string }

describe('meaning creations', () => {
  it('discovers a stable location while earlier signatured revisions remain', async () => {
    const store = new MemoryStore()
    const meaning = 'themes:text'
    const first = await writeCreation(store as CreationStore, meaning, 'studio',
      { name: 'text-theme', label: 'Studio', read: 'hive', code: 'plex' })
    const next = await writeCreation(store as CreationStore, meaning, 'studio',
      { name: 'text-theme', label: 'Studio revised', read: 'serif', code: 'plex' })
    expect(first?.location).toBe(next?.location)
    expect(first?.head).not.toBe(next?.head)
    expect(first?.marker).toBe('00000000')
    expect(next?.marker).toBe('00000001')
    expect(store.content.has(first!.head)).toBe(true)
    expect((await readCreation<Layer>(store as CreationStore, meaning, 'studio'))?.layer.label).toBe('Studio revised')
    expect((await listCreations<Layer>(store as CreationStore, meaning)).map(row => row.layer.label))
      .toEqual(['Studio revised'])
  })

  it('refuses a pool member whose bytes do not match its filename', async () => {
    const store = new MemoryStore()
    await writeCreation(store as CreationStore, 'themes:text', 'studio',
      { name: 'text-theme', label: 'Studio', read: 'hive', code: 'plex' })
    const pool = store.pools.get('themes:text')!
    const [member] = pool.files.values()
    member!.bytes = new TextEncoder().encode('{}')
    expect(await listCreations<Layer>(store as CreationStore, 'themes:text')).toEqual([])
    expect((await readCreation<Layer>(store as CreationStore, 'themes:text', 'studio'))?.layer.label)
      .toBe('Studio')
  })

  it('selects an exact held revision and turns it off with a later layer', async () => {
    const store = new MemoryStore()
    const meaning = 'themes:text'
    const key = 'public:publisher:studio'
    const layerBytes = new TextEncoder().encode(JSON.stringify({ name: 'text-theme',
      label: 'Studio', read: 'hive', code: 'plex' }))
    const layerSig = await digest(layerBytes)
    await store.writeLayerBytes(layerSig, exact(layerBytes))
    const metaBytes = new TextEncoder().encode(JSON.stringify(mintMetaEnvelope({ layer: layerSig,
      relation: meaning })))
    const head = await digest(metaBytes)
    store.content.set(head, metaBytes)
    const selected = await installCreationHead<Layer>(store as CreationStore, meaning, key, head)
    expect(selected?.head).toBe(head)
    expect(selected?.marker).toBe('00000000')
    expect(await disableCreation(store as CreationStore, meaning, key, 'b'.repeat(64))).toBe(false)
    expect(await disableCreation(store as CreationStore, meaning, key, head)).toBe(true)
    expect(await listCreations<Layer>(store as CreationStore, meaning)).toEqual([])
    expect(store.content.has(head)).toBe(true)
    const again = await installCreationHead<Layer>(store as CreationStore, meaning, key, head)
    expect(again?.marker).toBe('00000002')
    expect(again?.head).toBe(head)
  })
})

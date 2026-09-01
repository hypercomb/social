import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
  }
})

type LayerContent = { name: string; children?: string[] }
type HistoryServiceCtor = new () => {
  getLayerBySig(sig: string): Promise<LayerContent | null>
  commitLayer(locationSig: string, layer: LayerContent & Record<string, unknown>): Promise<string>
}

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

const bytesOfBlob = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.readAsArrayBuffer(blob)
})

class MockFile {
  readonly kind = 'file' as const
  bytes = new Uint8Array()
  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    const exact = this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer
    return Object.assign(new Blob([exact]), {
      name: this.name,
      lastModified: 1,
      arrayBuffer: () => Promise.resolve(exact),
      text: () => Promise.resolve(new TextDecoder().decode(exact)),
    }) as unknown as File
  }

  async createWritable() {
    return {
      write: async (chunk: ArrayBuffer | Uint8Array | string) => {
        this.bytes = typeof chunk === 'string'
          ? new TextEncoder().encode(chunk)
          : chunk instanceof Uint8Array ? new Uint8Array(chunk) : new Uint8Array(chunk)
      },
      close: async () => { /* noop */ },
    }
  }
}

class MockDir {
  readonly kind = 'directory' as const
  readonly files = new Map<string, MockFile>()
  readonly dirs = new Map<string, MockDir>()
  constructor(readonly name = '') {}

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MockFile> {
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) throw new DOMException('NotFoundError', 'NotFoundError')
      file = new MockFile(name)
      this.files.set(name, file)
    }
    return file
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MockDir> {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!options.create) throw new DOMException('NotFoundError', 'NotFoundError')
      dir = new MockDir(name)
      this.dirs.set(name, dir)
    }
    return dir
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) {
      throw new DOMException('NotFoundError', 'NotFoundError')
    }
  }

  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const entry of this.files) yield entry
    for (const entry of this.dirs) yield entry
  }
}

describe('HistoryService typed layer metadata', () => {
  let HistoryService: HistoryServiceCtor
  let records: Map<string, Uint8Array>
  let reads: string[]

  beforeAll(async () => {
    HistoryService = (await import('./history.service.js')).HistoryService as unknown as HistoryServiceCtor
  })

  beforeEach(() => {
    records = new Map()
    reads = []
    ;(globalThis as Record<string, unknown>)['get'] = (key: string) =>
      key === '@hypercomb.social/Store'
        ? {
            getLayerPoolBytes: async (sig: string) => {
              reads.push(sig)
              return records.get(sig) ?? null
            },
          }
        : undefined
  })

  it('resolves a layer metadata signature to the same primitive layer', async () => {
    const metaSig = 'a'.repeat(64)
    const layerSig = 'b'.repeat(64)
    records.set(metaSig, encode({ meta: 1, layer: layerSig }))
    records.set(layerSig, encode({ name: 'people', children: [] }))

    const history = new HistoryService()
    await expect(history.getLayerBySig(metaSig)).resolves.toEqual({
      name: 'people',
    })

    const readsAfterFirstResolution = reads.length
    await expect(history.getLayerBySig(metaSig)).resolves.toEqual({
      name: 'people',
    })
    expect(reads).toHaveLength(readsAfterFirstResolution)
  })

  it('rejects circular metadata without recursing forever', async () => {
    const first = 'c'.repeat(64)
    const second = 'd'.repeat(64)
    records.set(first, encode({ meta: 1, layer: second }))
    records.set(second, encode({ meta: 1, layer: first }))

    const history = new HistoryService()
    await expect(history.getLayerBySig(first)).resolves.toBeNull()
  })

  it('promotes bare artifact references at the new-layer write boundary', async () => {
    const root = new MockDir()
    const resources = new Map<string, Uint8Array>()
    const layers = new Map<string, Uint8Array>()
    ;(globalThis as Record<string, unknown>)['get'] = (key: string) =>
      key === '@hypercomb.social/Store'
        ? {
            hypercombRoot: root,
            opfsRoot: root,
            getResourceLocal: async (sig: string) => {
              const bytes = resources.get(sig)
              if (!bytes) return null
              const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
              return {
                size: bytes.byteLength,
                arrayBuffer: async () => exact,
                text: async () => new TextDecoder().decode(bytes),
              } as Blob
            },
            putResource: async (blob: Blob) => {
              const bytes = await bytesOfBlob(blob)
              const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
              const sig = await SignatureService.sign(exact)
              resources.set(sig, bytes)
              return sig
            },
            writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
              layers.set(sig, new Uint8Array(bytes))
            },
          }
        : undefined

    const rawChild = '1'.repeat(64)
    const rawProperties = '2'.repeat(64)
    const history = new HistoryService()
    const layerSig = await history.commitLayer('f'.repeat(64), {
      name: 'parent',
      children: [rawChild],
      properties: [rawProperties],
    })

    const written = JSON.parse(new TextDecoder().decode(layers.get(layerSig)!)) as {
      children: string[]
      properties: string[]
    }
    const childMeta = JSON.parse(new TextDecoder().decode(resources.get(written.children[0])!))
    const propertiesMeta = JSON.parse(new TextDecoder().decode(resources.get(written.properties[0])!))
    expect(childMeta).toEqual({ meta: 1, layer: rawChild, relation: 'children' })
    expect(propertiesMeta).toEqual({ meta: 1, resource: rawProperties, relation: 'properties' })
  })
})

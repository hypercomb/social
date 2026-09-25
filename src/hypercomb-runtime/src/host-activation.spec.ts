import { describe, expect, it } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { SignatureService } from '@hypercomb/core'
import { hostActivationLocation, readHostActivation, writeHostActivation } from './host-activation'

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  async getFile(): Promise<Blob> { return new NodeBlob([exact(this.bytes)]) as Blob }
  async createWritable() {
    return { write: async (bytes: ArrayBuffer) => { this.bytes = new Uint8Array(bytes) }, close: async () => {} }
  }
}
class MemoryDir {
  readonly kind = 'directory'
  files = new Map<string, MemoryFile>()
  dirs = new Map<string, MemoryDir>()
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    let file = this.files.get(name)
    if (!file && options?.create) this.files.set(name, file = new MemoryFile())
    if (!file) throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
    return file
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDir> {
    let dir = this.dirs.get(name)
    if (!dir && options?.create) this.dirs.set(name, dir = new MemoryDir())
    if (!dir) throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
    return dir
  }
  async *entries() {
    for (const entry of this.files) yield entry
    for (const entry of this.dirs) yield entry
  }
}

const store = () => {
  const root = new MemoryDir()
  const layers = new Map<string, Uint8Array>()
  return {
    opfsRoot: root as unknown as FileSystemDirectoryHandle,
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      if (await SignatureService.sign(bytes) !== sig) throw new Error('bad layer')
      layers.set(sig, new Uint8Array(bytes))
    },
    getLayerPoolBytes: async (sig: string) => layers.get(sig) ?? null,
    root,
    layers,
  }
}

const offer = { pubkey: 'a'.repeat(64), lineage: 'garden', sourceRoute: 'https://garden.jwize.com/',
  localRoute: 'garden.localhost', head: 'b'.repeat(64), source: 'jwize.com' }

describe('host route activation', () => {
  it('uses the hostname location, keeps old signed layers, and reads only the newest switch', async () => {
    const held = store()
    const location = await hostActivationLocation('GARDEN.LOCALHOST')
    expect(location).toBe(await hostActivationLocation('garden.localhost:4850'))
    expect(location).toBe(await SignatureService.sign(new TextEncoder().encode('garden.localhost').buffer as ArrayBuffer))
    const on = await writeHostActivation(held, { ...offer, enabled: true })
    const off = await writeHostActivation(held, { ...offer, enabled: false })
    expect(on.marker).toBe('00000001')
    expect(off.marker).toBe('00000002')
    expect(on.sig).not.toBe(off.sig)
    expect(held.layers.has(on.sig)).toBe(true)
    expect((await readHostActivation(held, 'garden.localhost'))?.layer.enabled).toBe(false)
    expect(held.root.dirs.get(location)?.files.size).toBe(3)
  })

  it('cannot turn off a route that another creation now serves', async () => {
    const held = store()
    await writeHostActivation(held, { ...offer, enabled: true })
    const different = { ...offer, enabled: true, pubkey: 'c'.repeat(64), lineage: 'other' }
    await expect(writeHostActivation(held, different)).rejects.toThrow('already serves another creation')
    await writeHostActivation(held, different, { replaceExisting: true })
    await expect(writeHostActivation(held, { ...offer, enabled: false }))
      .rejects.toThrow('another creation')
    expect((await readHostActivation(held, offer.localRoute))?.layer.pubkey).toBe('c'.repeat(64))
  })

  it('rejects ambiguous or invalid route names before writing a marker', async () => {
    const held = store()
    await expect(writeHostActivation(held, { ...offer, localRoute: 'garden.localhost/path', enabled: true }))
      .rejects.toThrow('Invalid host activation')
    await expect(writeHostActivation(held, { ...offer, localRoute: 'a-.garden.localhost', enabled: true }))
      .rejects.toThrow('Invalid host activation')
    await expect(writeHostActivation(held, { ...offer, pubkey: 'nope', enabled: true }))
      .rejects.toThrow('Invalid host activation')
    expect(held.root.dirs.size).toBe(0)
  })
})

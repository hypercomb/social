// serve.queen.spec.ts — the door `serve at <domain>` writes is the runtime's
// door, byte for byte: essentials may import only core, so the writer lives
// here, and the runtime's own reader (hypercomb-runtime host-activation.ts —
// what the shim reads, in the shape hypercomb-serve answers) must accept it.

import { describe, expect, it } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SignatureService } from '@hypercomb/core'

// The runtime's own door reader and writer, read through the one copy in the
// runtime (essentials may not import it in source).
type DoorInput = Record<string, unknown>
const { readHostActivation, writeHostActivation } = await import(
  /* @vite-ignore */ pathToFileURL(join(__dirname, '..', '..', '..', 'hypercomb-runtime', 'src', 'host-activation.ts')).href
) as {
  readHostActivation: (store: unknown, route: string) => Promise<{ layer: DoorInput & { enabled: boolean; pubkey: string } } | null>
  writeHostActivation: (store: unknown, input: DoorInput) => Promise<{ sig: string }>
}

;(window as unknown as { ioc: unknown }).ioc ??= { register: () => void 0, get: () => undefined }
const { doorHost, readDoor, writeDoor } = await import('./serve.queen.js')

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
  }
}

const door = (enabled: boolean) => ({
  name: 'host:activation' as const,
  enabled,
  pubkey: 'c'.repeat(64),
  lineage: 'site/about',
  sourceRoute: 'https://alice.example.com/',
  localRoute: 'alice.example.com',
  head: 'd'.repeat(64),
  source: 'alice.example.com',
})

describe('serve — the door a domain opens', () => {
  it('writes the runtime\'s door: its own reader accepts it', async () => {
    const held = store()
    await writeDoor(held, door(true))
    const read = await readHostActivation(held, 'alice.example.com')
    expect(read?.layer).toMatchObject({ enabled: true, head: 'd'.repeat(64), lineage: 'site/about' })
  })

  it('names the very layer the runtime\'s writer would — one door, two writers', async () => {
    const ours = store()
    const theirs = store()
    const mine = await writeDoor(ours, door(true))
    const { name: _name, ...input } = door(true)
    const runtime = await writeHostActivation(theirs, input)
    expect(mine).toBe(runtime.sig)
  })

  it('switching off is a new revision that says so, read back by both', async () => {
    const held = store()
    await writeDoor(held, door(true))
    const current = await readDoor(held, 'alice.example.com')
    expect(current?.enabled).toBe(true)
    await writeDoor(held, { ...current!, enabled: false })
    expect((await readDoor(held, 'alice.example.com'))?.enabled).toBe(false)
    expect((await readHostActivation(held, 'alice.example.com'))?.layer.enabled).toBe(false)
  })

  it('reads a domain the way the host reads its Host header', () => {
    expect(doorHost('https://Alice.Example.com:443/page')).toBe('alice.example.com')
    expect(doorHost('alice.localhost:4270')).toBe('alice.localhost')
    expect(doorHost('example.com.')).toBe('example.com')
    for (const bad of ['', 'a b', '-x.com', 'x..com']) expect(doorHost(bad), bad).toBe('')
  })
})

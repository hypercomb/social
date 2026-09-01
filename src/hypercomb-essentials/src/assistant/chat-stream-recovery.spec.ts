// assistant/chat-stream-recovery.spec.ts
//
// THE ONE INTERRUPTION A MODULE CANNOT SURVIVE — the page itself going away.
//
// A streamed answer is only a turn once its last chunk lands. Everything before
// that lived in memory, so a reload mid-answer took the whole thing, including
// the half already read. The checkpoint is the answer to that: the partial is
// written down while it arrives, and a checkpoint that outlived its stream is
// exactly one thing — an answer that was interrupted.
//
// What these tests freeze:
//   1. a checkpoint is stored and read back per conversation
//   2. clearing is what completion does, and only that
//   3. recovery files each abandoned partial as the turn it was becoming
//   4. a conversation still STREAMING is left alone — recovery may not file an
//      answer that is still being said
//   5. a partial whose turn could not be stored KEEPS its checkpoint, so the
//      next boot tries again rather than losing the words twice

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = () => undefined
  g['register'] = () => { /* noop */ }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  class TestBlob {
    #bytes: Uint8Array
    constructor(parts: Array<string | ArrayBuffer | Uint8Array> = []) {
      const chunks = parts.map(p =>
        typeof p === 'string' ? new TextEncoder().encode(p)
          : p instanceof Uint8Array ? p
            : new Uint8Array(p as ArrayBuffer))
      const total = chunks.reduce((n, c) => n + c.byteLength, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
      this.#bytes = out
    }
    get size(): number { return this.#bytes.byteLength }
    async arrayBuffer(): Promise<ArrayBuffer> {
      return this.#bytes.buffer.slice(
        this.#bytes.byteOffset, this.#bytes.byteOffset + this.#bytes.byteLength) as ArrayBuffer
    }
    async text(): Promise<string> { return new TextDecoder().decode(this.#bytes) }
  }
  g['Blob'] = TestBlob
})

/** The slice of OPFS the threads module touches, in memory. */
class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    const slice = this.bytes.buffer.slice(
      this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
    return {
      name: this.name,
      size: this.bytes.byteLength,
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(slice)),
    } as unknown as File
  }
  async createWritable() {
    return {
      write: async (chunk: Blob | ArrayBuffer | Uint8Array | string) => {
        if (typeof chunk === 'string') { this.bytes = new TextEncoder().encode(chunk); return }
        if (ArrayBuffer.isView(chunk)) {
          const view = chunk as Uint8Array
          this.bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
          return
        }
        if (chunk && typeof (chunk as Blob).arrayBuffer === 'function') {
          this.bytes = new Uint8Array(await (chunk as Blob).arrayBuffer())
          return
        }
        this.bytes = new Uint8Array(chunk as ArrayBuffer)
      },
      close: async () => { /* noop */ },
    }
  }
}

class MockDir {
  kind = 'directory' as const
  files = new Map<string, MockFile>()
  dirs = new Map<string, MockDir>()
  constructor(public name = '') {}
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    let f = this.files.get(name)
    if (!f) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      f = new MockFile(name); this.files.set(name, f)
    }
    return f
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      d = new MockDir(name); this.dirs.set(name, d)
    }
    return d
  }
  async removeEntry(name: string): Promise<void> {
    if (!(this.files.delete(name) || this.dirs.delete(name))) {
      throw new DOMException('NotFoundError', 'NotFoundError')
    }
  }
  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const [n, f] of this.files) yield [n, f]
    for (const [n, d] of this.dirs) yield [n, d]
  }
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const h = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join('')
}

/** A store with a POOL PER MEANING (the checkpoints and the threads must not
 *  share one) and a doc per pool. */
const makeStore = (options: { refuseTurns?: boolean } = {}) => {
  const pools = new Map<string, MockDir>()
  const docs = new Map<MockDir, ArrayBuffer>()
  const resources = new Map<string, Uint8Array>()
  return {
    pools,
    getPool: async (meaning: string) => {
      let pool = pools.get(meaning)
      if (!pool) { pool = new MockDir(meaning); pools.set(meaning, pool) }
      return pool as unknown as FileSystemDirectoryHandle
    },
    getPoolDoc: async (pool?: FileSystemDirectoryHandle) =>
      (pool ? docs.get(pool as unknown as MockDir) ?? null : null),
    putPoolDoc: async (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => {
      docs.set(pool as unknown as MockDir, bytes)
      return 'doc'
    },
    putResource: async (blob: Blob) => {
      if (options.refuseTurns) throw new Error('pool refused')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const sig = await sha256Hex(bytes)
      resources.set(sig, bytes)
      return sig
    },
    getResource: async (sig: string) => {
      const bytes = resources.get(sig)
      if (!bytes) return null
      return { text: () => Promise.resolve(new TextDecoder().decode(bytes)) } as unknown as Blob
    },
  }
}

type ChatThreadModule = typeof import('./chat-thread.js')

const loadModule = async (store: ReturnType<typeof makeStore>): Promise<ChatThreadModule> => {
  const g = globalThis as Record<string, unknown>
  g['get'] = (key: string) => key === '@hypercomb.social/Store' ? store : undefined
  return import('./chat-thread.js')
}

describe('chat-thread — an interrupted answer is filed, not lost', () => {
  let store: ReturnType<typeof makeStore>
  let mod: ChatThreadModule

  beforeEach(async () => {
    store = makeStore()
    mod = await loadModule(store)
    // The doc is shared module state across imports in one file — start clean.
    for (const held of await mod.listStreamCheckpoints()) {
      await mod.saveStreamCheckpoint(held.convoId, '')
    }
  })

  it('holds a partial per conversation and forgets it on completion', async () => {
    expect(await mod.saveStreamCheckpoint('chat:cp-1', 'half an answ')).toBe(true)
    expect((await mod.listStreamCheckpoints()).map(c => c.text)).toEqual(['half an answ'])

    await mod.saveStreamCheckpoint('chat:cp-1', '')
    expect(await mod.listStreamCheckpoints()).toEqual([])
  })

  it('files every abandoned partial as the turn it was becoming', async () => {
    await mod.saveStreamCheckpoint('chat:cp-2', 'the words the host really said')

    expect(await mod.recoverStreamCheckpoints()).toBe(1)
    const turns = await mod.readTurns('chat:cp-2')
    expect(turns.map(t => ({ role: t.role, text: t.text }))).toEqual([
      { role: 'assistant', text: 'the words the host really said' },
    ])
    // Filed once and only once — a second boot must not double it.
    expect(await mod.recoverStreamCheckpoints()).toBe(0)
    expect(await mod.listStreamCheckpoints()).toEqual([])
  })

  it('leaves a conversation whose answer is STILL ARRIVING alone', async () => {
    await mod.saveStreamCheckpoint('chat:cp-live', 'still being said')

    expect(await mod.recoverStreamCheckpoints(new Set(['chat:cp-live']))).toBe(0)
    expect(await mod.readTurns('chat:cp-live')).toEqual([])
    // Still held, so the run that owns it can finish or the next boot can file.
    expect((await mod.listStreamCheckpoints()).map(c => c.convoId)).toEqual(['chat:cp-live'])
  })

  it('KEEPS a partial whose turn could not be stored', async () => {
    const refusing = makeStore({ refuseTurns: true })
    const other = await loadModule(refusing)
    await other.saveStreamCheckpoint('chat:cp-3', 'unstorable but not lost')

    expect(await other.recoverStreamCheckpoints()).toBe(0)
    expect((await other.listStreamCheckpoints()).map(c => c.text)).toEqual(['unstorable but not lost'])
  })
})

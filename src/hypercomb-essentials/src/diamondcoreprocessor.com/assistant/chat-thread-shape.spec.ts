// diamondcoreprocessor.com/assistant/chat-thread-shape.spec.ts
//
// THE TURN SHAPE — mechanical proof of the doctrine pass on chat threads:
//
//   text:  a ROOT CONTENT RESOURCE (stored once, content-addressed)
//   turn:  a small manifest { kind, convoId, role, at, contentSig }
//   read:  BOTH shapes materialize — legacy inline turns are readable forever
//
// What these tests freeze:
//   1. appendTurn writes a manifest, never inline text, when the store can
//      mint resources — and the text bytes land at the content root
//   2. a bucket holding one legacy turn and one manifest reads as ONE thread,
//      both texts materialized, ordered by `at`
//   3. the list walk probe-skips a machine bucket after exactly ONE file read
//   4. the list walk resolves exactly ONE text per human thread (the title),
//      and hands back the newest thread fully materialized
//   5. deleteConversation drops the bucket and leaves the text resource —
//      content-addressed bytes may be shared; their lifecycle is GC's
//   6. ARCHIVING is additive and reversible: a marker file in the thread's
//      OWN bucket, every turn untouched, and the list still reports the
//      thread — it is the surfaces that hide it, not the pool that forgets it

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Shell globals BEFORE the module imports evaluate (chat-thread registers its
// IoC surface at module scope; the Store is resolved via `get` at call time).
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
  // jsdom's Blob has neither arrayBuffer() nor text() — a minimal shim so the
  // module's `new Blob([...])` writes are readable by the fakes below.
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
      return this.#bytes.buffer.slice(this.#bytes.byteOffset, this.#bytes.byteOffset + this.#bytes.byteLength) as ArrayBuffer
    }
    async text(): Promise<string> { return new TextDecoder().decode(this.#bytes) }
  }
  g['Blob'] = TestBlob
})

// ---- in-memory OPFS (the slice chat-thread touches) -------------------

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  reads = 0
  constructor(public name: string, private counter?: { reads: number }) {}
  async getFile(): Promise<File> {
    this.reads++
    if (this.counter) this.counter.reads++
    const slice = this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
    return {
      name: this.name,
      size: this.bytes.byteLength,
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(slice)),
    } as unknown as File
  }
  async createWritable() {
    return {
      // Duck-typed, never instanceof: vitest's jsdom hands typed arrays and
      // Blobs across realms, where instanceof silently lies.
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
  constructor(public name = '', public counter?: { reads: number }) {}
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    let f = this.files.get(name)
    if (!f) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      f = new MockFile(name, this.counter); this.files.set(name, f)
    }
    return f
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      d = new MockDir(name, this.counter); this.dirs.set(name, d)
    }
    return d
  }
  async removeEntry(name: string, _opts?: { recursive?: boolean }): Promise<void> {
    if (!(this.files.delete(name) || this.dirs.delete(name))) throw new DOMException('NotFoundError', 'NotFoundError')
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

// ---- a content-addressed fake Store ----------------------------------

const makeStore = (pool: MockDir) => {
  const resources = new Map<string, Uint8Array>()
  let resourceReads = 0
  return {
    resources,
    get resourceReads() { return resourceReads },
    getPool: async () => pool as unknown as FileSystemDirectoryHandle,
    putResource: async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const sig = await sha256Hex(bytes)
      resources.set(sig, bytes)
      return sig
    },
    getResource: async (sig: string) => {
      resourceReads++
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

/** Write a LEGACY inline-text turn file straight into a bucket, the way every
 *  pre-doctrine session left them. */
const writeLegacyTurn = async (
  pool: MockDir, convoId: string, role: string, text: string, at: number,
): Promise<void> => {
  const bucketName = await sha256Hex(new TextEncoder().encode(convoId))
  const bucket = await pool.getDirectoryHandle(bucketName, { create: true })
  const record = JSON.stringify({ kind: 'chat-turn', convoId, role, at, text })
  const bytes = new TextEncoder().encode(record)
  const file = await bucket.getFileHandle(await sha256Hex(bytes), { create: true })
  const writable = await file.createWritable()
  await writable.write(bytes)
  await writable.close()
}

describe('chat-thread — turns are contentSig manifests; legacy stays readable', () => {

  let pool: MockDir
  let store: ReturnType<typeof makeStore>
  let mod: ChatThreadModule

  beforeEach(async () => {
    pool = new MockDir('threads', { reads: 0 })
    pool.counter = { reads: 0 }
    store = makeStore(pool)
    mod = await loadModule(store)
  })

  it('appendTurn writes a manifest pointing at a root resource, never inline text', async () => {
    const ok = await mod.appendTurn('chat:shape-1', 'user', 'hello doctrine', )
    expect(ok).toBe(true)

    const bucketName = await sha256Hex(new TextEncoder().encode('chat:shape-1'))
    const bucket = pool.dirs.get(bucketName)
    expect(bucket).toBeDefined()
    const files = [...bucket!.files.values()]
    expect(files.length).toBe(1)
    const record = JSON.parse(new TextDecoder().decode(files[0].bytes))
    expect(record.kind).toBe('chat-turn')
    expect(record.contentSig).toMatch(/^[0-9a-f]{64}$/)
    expect(record.text).toBeUndefined()
    // …and the text bytes are AT the content root, addressed by that sig.
    expect(new TextDecoder().decode(store.resources.get(record.contentSig)!)).toBe('hello doctrine')
  })

  it('identical text across turns and threads dedups to one resource', async () => {
    await mod.appendTurn('chat:shape-a', 'user', 'same words')
    await mod.appendTurn('chat:shape-b', 'assistant', 'same words')
    expect(store.resources.size).toBe(1)
  })

  it('a mixed bucket — legacy inline + manifest — reads as one ordered thread', async () => {
    await writeLegacyTurn(pool, 'chat:mixed', 'user', 'old shape', 1000)
    await mod.appendTurn('chat:mixed', 'assistant', 'new shape')

    const turns = await mod.readTurns('chat:mixed')
    expect(turns.length).toBe(2)
    expect(turns[0].text).toBe('old shape')       // at:1000, oldest first
    expect(turns[0].contentSig).toBeUndefined()
    expect(turns[1].text).toBe('new shape')
    expect(turns[1].contentSig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the list walk probe-skips a machine bucket after exactly one file read', async () => {
    for (let i = 0; i < 5; i++) {
      await writeLegacyTurn(pool, 'keywords:machine', 'assistant', `chatter ${i}`, 1000 + i)
    }
    await writeLegacyTurn(pool, 'chat:human', 'user', 'a real question', 2000)

    pool.counter!.reads = 0
    const { conversations } = await mod.listConversationsWithLatest()

    expect(conversations.map(c => c.convoId)).toEqual(['chat:human'])
    // 1 probe read for the machine bucket + 1 read for the human bucket's turn.
    expect(pool.counter!.reads).toBe(2)
  })

  it('the list walk resolves one text per thread and fully materializes only the newest', async () => {
    await mod.appendTurn('chat:older', 'user', 'first thread question')
    await mod.appendTurn('chat:older', 'assistant', 'first thread answer')
    // Force distinct ordering: the newest thread written after.
    await new Promise(r => setTimeout(r, 5))
    await mod.appendTurn('chat:newer', 'user', 'second thread question')
    await mod.appendTurn('chat:newer', 'assistant', 'second thread answer')

    const before = store.resourceReads
    const { conversations, latestTurns } = await mod.listConversationsWithLatest()

    expect(conversations[0].convoId).toBe('chat:newer')
    expect(conversations[0].title).toBe('second thread question')
    expect(conversations[1].title).toBe('first thread question')
    expect(latestTurns.map(t => t.text)).toEqual(['second thread question', 'second thread answer'])
    // 2 title resolves (one per thread) + 2 for materializing the newest.
    expect(store.resourceReads - before).toBe(4)
  })

  it('archiving is a marker in the thread’s own bucket, and every turn survives', async () => {
    await mod.appendTurn('chat:filed', 'user', 'a question worth keeping')
    await mod.appendTurn('chat:filed', 'assistant', 'an answer worth keeping')
    const bucketName = await sha256Hex(new TextEncoder().encode('chat:filed'))
    const before = pool.dirs.get(bucketName)!.files.size

    expect(await mod.setConversationArchived('chat:filed', true)).toBe(true)

    // ONE more file — the marker — and not one turn fewer. Archiving is the
    // opposite of deleting and the bucket has to show that.
    expect(pool.dirs.get(bucketName)!.files.size).toBe(before + 1)
    expect((await mod.readTurns('chat:filed')).map(t => t.text))
      .toEqual(['a question worth keeping', 'an answer worth keeping'])
  })

  it('the list still reports an archived thread — flagged, never dropped', async () => {
    await mod.appendTurn('chat:filed', 'user', 'put me away')
    await mod.appendTurn('chat:live', 'user', 'keep me out')
    await mod.setConversationArchived('chat:filed', true)

    const { conversations } = await mod.listConversationsWithLatest()
    const byId = new Map(conversations.map(c => [c.convoId, c]))
    // The pool never forgets a thread; hiding it is the surface's job, and a
    // list that dropped it would leave no way to bring it back.
    expect(byId.get('chat:filed')?.archived).toBe(true)
    expect(byId.get('chat:live')?.archived).toBe(false)
    expect(byId.get('chat:filed')?.turnCount).toBe(1)
  })

  it('an archived thread is never what a window resumes into', async () => {
    await mod.appendTurn('chat:older', 'user', 'the older thread')
    await new Promise(r => setTimeout(r, 5))
    await mod.appendTurn('chat:newest', 'user', 'the newest thread')
    await mod.setConversationArchived('chat:newest', true)

    // Newest by time, but put away — resuming into it would undo the act on
    // the next reload, so `latestTurns` is the newest LIVE thread.
    const { latestTurns } = await mod.listConversationsWithLatest()
    expect(latestTurns.map(t => t.text)).toEqual(['the older thread'])
  })

  it('un-archiving removes the marker and mints nothing', async () => {
    await mod.appendTurn('chat:filed', 'user', 'back again')
    const bucketName = await sha256Hex(new TextEncoder().encode('chat:filed'))
    const before = pool.dirs.get(bucketName)!.files.size

    await mod.setConversationArchived('chat:filed', true)
    expect(await mod.setConversationArchived('chat:filed', false)).toBe(true)

    expect(pool.dirs.get(bucketName)!.files.size).toBe(before)
    const { conversations } = await mod.listConversationsWithLatest()
    expect(conversations.find(c => c.convoId === 'chat:filed')?.archived).toBe(false)
  })

  it('un-archiving a thread that has no bucket does not mint one', async () => {
    // A chat opened and never spoken in. The act is a no-op, and it must not
    // leave an empty directory behind as a souvenir.
    await mod.setConversationArchived('chat:never-spoken', false)
    const bucketName = await sha256Hex(new TextEncoder().encode('chat:never-spoken'))
    expect(pool.dirs.has(bucketName)).toBe(false)
  })

  it('goal completion belongs only to the conversation that reached it', async () => {
    await mod.appendTurn('chat:finished', 'user', 'finish this outcome')
    await mod.appendTurn('chat:ongoing', 'user', 'this still has work')

    expect(await mod.setConversationGoalReached('chat:finished', 'Built and verified the requested result.'))
      .toBe(true)

    const { conversations } = await mod.listConversationsWithLatest()
    const byId = new Map(conversations.map(c => [c.convoId, c]))
    expect(byId.get('chat:finished')?.goal?.details).toBe('Built and verified the requested result.')
    expect(byId.get('chat:ongoing')?.goal).toBeUndefined()
    // A receipt is metadata, never another visible transcript turn.
    expect(byId.get('chat:finished')?.turnCount).toBe(1)
    expect((await mod.readTurns('chat:finished')).map(t => t.text)).toEqual(['finish this outcome'])
  })

  it('deleteConversation drops the bucket and leaves the text resource', async () => {
    await mod.appendTurn('chat:doomed', 'user', 'kept bytes')
    const bucketName = await sha256Hex(new TextEncoder().encode('chat:doomed'))
    expect(pool.dirs.has(bucketName)).toBe(true)

    const ok = await mod.deleteConversation('chat:doomed')
    expect(ok).toBe(true)
    expect(pool.dirs.has(bucketName)).toBe(false)
    expect(store.resources.size).toBe(1)   // the resource outlives the thread
  })
})

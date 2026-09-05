// assistant/chat-steps.spec.ts
//
// THE STEP LEDGER — mechanical proof of the claims chat-steps.ts makes.
//
// What these tests freeze:
//   1. a step is a MANIFEST: the request is a root content resource, the
//      record is a small pointer named by the hash of its own bytes
//   2. THE LEDGER IS INVISIBLE to every existing reader — a conversation
//      full of steps reads back as exactly its turns, so a build that
//      predates the ledger keeps working and data never heals
//   3. the conversation LIST pays nothing for a busy run — the walk reads
//      the turns beside the ledger, never the steps inside it
//   4. replaying an identical step writes ONE file; a RETRY writes two, and
//      `settle` returns the outcome that stands
//   5. `nextSeq` resumes a run from the LEDGER, not from memory — the fact
//      that survives a reload is the one on disk
//   6. `deleteConversation` still deletes a conversation that ran an agent,
//      and still REFUSES one whose ledger holds a record that is not its own
//   7. a step with no run declared is not recorded, and mints no directory

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
      return this.#bytes.buffer.slice(this.#bytes.byteOffset, this.#bytes.byteOffset + this.#bytes.byteLength) as ArrayBuffer
    }
    async text(): Promise<string> { return new TextDecoder().decode(this.#bytes) }
  }
  g['Blob'] = TestBlob
})

// ---- in-memory OPFS ---------------------------------------------------

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string, private counter?: { reads: number }) {}
  async getFile(): Promise<File> {
    if (this.counter) this.counter.reads++
    const slice = this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
    return {
      name: this.name,
      size: this.bytes.byteLength,
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(slice)),
    } as unknown as File
  }
  opens = 0
  async createWritable() {
    this.opens++
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

const makeStore = (pool: MockDir) => {
  const resources = new Map<string, Uint8Array>()
  const store = {
    resources,
    getPool: async () => pool as unknown as FileSystemDirectoryHandle,
    putOptions: [] as Array<{ emit?: boolean } | undefined>,
    putResource: async function (this: { putOptions: Array<unknown> }, blob: Blob, options?: { emit?: boolean }) {
      store.putOptions.push(options)
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
  return store
}

type StepsModule = typeof import('./chat-steps.js')
type ThreadModule = typeof import('./chat-thread.js')

const load = async (store: ReturnType<typeof makeStore>): Promise<{ steps: StepsModule; thread: ThreadModule }> => {
  const g = globalThis as Record<string, unknown>
  g['get'] = (key: string) => key === '@hypercomb.social/Store' ? store : undefined
  return { steps: await import('./chat-steps.js'), thread: await import('./chat-thread.js') }
}

const CONVO = 'chat:1712345678-abc123'
const RUN = 'run-7f3a'

/** The ledger directory inside a conversation's bucket, or undefined. */
const ledgerOf = async (pool: MockDir, convoId = CONVO): Promise<MockDir | undefined> => {
  const bucket = pool.dirs.get(await sha256Hex(new TextEncoder().encode(convoId)))
  if (!bucket) return undefined
  return bucket.dirs.get(await sha256Hex(new TextEncoder().encode('chat-steps')))
}

const bucketOf = async (pool: MockDir, convoId = CONVO): Promise<MockDir | undefined> =>
  pool.dirs.get(await sha256Hex(new TextEncoder().encode(convoId)))

let pool: MockDir
let store: ReturnType<typeof makeStore>

beforeEach(() => {
  vi.resetModules()
  pool = new MockDir('threads', { reads: 0 })
  store = makeStore(pool)
})

describe('a step is a manifest, not a copy', () => {
  it('puts the request at the content root and names the record by its own bytes', async () => {
    const { steps } = await load(store)

    const ok = await steps.appendStep({
      convoId: CONVO, runId: RUN, seq: 0, verb: 'note-add', at: 1000,
      outcome: 'ok', request: { cell: '/dolphin', text: 'a note' },
      sigs: ['a'.repeat(64)],
    })
    expect(ok).toBe(true)

    const ledger = await ledgerOf(pool)
    expect(ledger, 'the ledger directory was created inside the bucket').toBeDefined()
    expect(ledger!.files.size).toBe(1)

    const [name, file] = [...ledger!.files.entries()][0]!
    const record = JSON.parse(new TextDecoder().decode(file.bytes))

    // The record is named by the hash of its own bytes — append-only.
    expect(name).toBe(await sha256Hex(file.bytes))

    // It points at the request; it does not carry it.
    expect(record.kind).toBe('chat-step')
    expect(record.contentSig).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(record)).not.toContain('a note')
    expect(new TextDecoder().decode(store.resources.get(record.contentSig)!))
      .toContain('a note')

    // Sigs are pointers into history, carried verbatim.
    expect(record.sigs).toEqual(['a'.repeat(64)])
  })

  it('records a failure with its reason, so an absent effect has an explanation', async () => {
    const { steps } = await load(store)
    await steps.appendStep({
      convoId: CONVO, runId: RUN, seq: 0, verb: 'update', at: 1000,
      outcome: 'failed', error: 'no such cell',
    })
    const [step] = await steps.readSteps(CONVO, RUN)
    expect(step!.outcome).toBe('failed')
    expect(step!.errorSig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a step with no run declared, and mints nothing', async () => {
    const { steps } = await load(store)
    expect(await steps.appendStep({
      convoId: CONVO, runId: '', seq: 0, verb: 'note-add', at: 1, outcome: 'ok',
    })).toBe(false)
    expect(await bucketOf(pool), 'no run means no bucket, no directory, no bytes').toBeUndefined()
  })
})

describe('the ledger is invisible to every existing reader', () => {
  it('leaves the thread reading as exactly its turns', async () => {
    const { steps, thread } = await load(store)

    await thread.appendTurn(CONVO, 'user', 'do the thing')
    for (let seq = 0; seq < 25; seq++) {
      await steps.appendStep({
        convoId: CONVO, runId: RUN, seq, verb: 'update', at: 1000 + seq, outcome: 'ok',
        request: { step: seq },
      })
    }
    await thread.appendTurn(CONVO, 'assistant', 'done')

    const turns = await thread.readTurns(CONVO)
    expect(turns.map(t => t.text)).toEqual(['do the thing', 'done'])
    expect(await steps.readSteps(CONVO, RUN)).toHaveLength(25)
  })

  it('costs the conversation list nothing — the walk never opens a step', async () => {
    const { steps, thread } = await load(store)
    await thread.appendTurn(CONVO, 'user', 'hello')
    for (let seq = 0; seq < 40; seq++) {
      await steps.appendStep({
        convoId: CONVO, runId: RUN, seq, verb: 'update', at: 2000 + seq, outcome: 'ok',
      })
    }

    pool.counter!.reads = 0
    const list = await thread.listConversations()
    expect(list.map(c => c.convoId)).toContain(CONVO)

    // One turn beside the ledger; forty steps inside it. The walk pays for
    // the turn only — if it ever descends, this number jumps by 40.
    expect(pool.counter!.reads).toBeLessThanOrEqual(2)
  })
})

describe('append-only, settled on read', () => {
  it('writes ONE file when the identical step is replayed', async () => {
    const { steps } = await load(store)
    const step = {
      convoId: CONVO, runId: RUN, seq: 3, verb: 'note-add', at: 5000,
      outcome: 'ok' as const, request: { cell: '/x' },
    }
    await steps.appendStep(step)
    await steps.appendStep(step)

    expect((await ledgerOf(pool))!.files.size, 'same bytes, same name, one file').toBe(1)
    expect(await steps.readSteps(CONVO, RUN)).toHaveLength(1)
  })

  it('keeps a retry as its own record, and settles on the outcome that stands', async () => {
    const { steps } = await load(store)
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 3, verb: 'update', at: 5000, outcome: 'failed', error: 'busy' })
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 3, verb: 'update', at: 5100, outcome: 'ok' })

    const all = await steps.readSteps(CONVO, RUN)
    expect(all, 'both attempts survive — the trail is honest about the retry').toHaveLength(2)

    const settled = steps.settle(all)
    expect(settled).toHaveLength(1)
    expect(settled[0]!.outcome).toBe('ok')
  })

  it('prefers the attempt that worked when a retry shares its instant', async () => {
    const { steps } = await load(store)
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 1, verb: 'update', at: 700, outcome: 'ok' })
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 1, verb: 'update', at: 700, outcome: 'failed', error: 'x' })
    expect(steps.settle(await steps.readSteps(CONVO, RUN))[0]!.outcome).toBe('ok')
  })

  it('orders a run by seq, never by the clock', async () => {
    const { steps } = await load(store)
    // Written out of order, and with a clock that disagrees with the run.
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 2, verb: 'c', at: 10, outcome: 'ok' })
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'a', at: 90, outcome: 'ok' })
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 1, verb: 'b', at: 50, outcome: 'ok' })
    expect((await steps.readSteps(CONVO, RUN)).map(s => s.verb)).toEqual(['a', 'b', 'c'])
  })

  it('keeps two runs on one conversation apart', async () => {
    const { steps } = await load(store)
    await steps.appendStep({ convoId: CONVO, runId: 'run-a', seq: 0, verb: 'a0', at: 1, outcome: 'ok' })
    await steps.appendStep({ convoId: CONVO, runId: 'run-b', seq: 0, verb: 'b0', at: 2, outcome: 'ok' })

    expect((await steps.readSteps(CONVO, 'run-a')).map(s => s.verb)).toEqual(['a0'])
    expect((await steps.readSteps(CONVO, 'run-b')).map(s => s.verb)).toEqual(['b0'])
    expect(await steps.readSteps(CONVO)).toHaveLength(2)
    expect(await steps.nextSeq(CONVO, 'run-a')).toBe(1)
  })
})

describe('a run resumes from the ledger', () => {
  it('reads where it got to off disk, so a reload continues the count', async () => {
    const { steps } = await load(store)
    expect(await steps.nextSeq(CONVO, RUN), 'a run nobody has started begins at 0').toBe(0)

    for (const seq of [0, 1, 2]) {
      await steps.appendStep({ convoId: CONVO, runId: RUN, seq, verb: 'update', at: 100 + seq, outcome: 'ok' })
    }

    // A fresh module graph — every in-memory counter gone, as after a reload.
    vi.resetModules()
    const reloaded = await load(store)
    expect(await reloaded.steps.nextSeq(CONVO, RUN)).toBe(3)
  })

  it('hands back the request a step recorded, so the loop can be replayed', async () => {
    const { steps } = await load(store)
    await steps.appendStep({
      convoId: CONVO, runId: RUN, seq: 0, verb: 'note-add', at: 1,
      outcome: 'ok', request: { cell: '/dolphin', text: 'the answer' },
    })
    const [step] = await steps.readSteps(CONVO, RUN)
    expect(await steps.stepRequest(step!)).toEqual({ cell: '/dolphin', text: 'the answer' })
  })
})

describe('deleting a conversation that ran an agent', () => {
  it('still deletes it — ledger and all', async () => {
    const { steps, thread } = await load(store)
    await thread.appendTurn(CONVO, 'user', 'hello')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'update', at: 1, outcome: 'ok' })

    expect(await ledgerOf(pool)).toBeDefined()
    expect(await thread.deleteConversation(CONVO)).toBe(true)
    expect(await bucketOf(pool), 'the bucket is gone, ledger included').toBeUndefined()
  })

  it('still refuses when the ledger holds a record that is not this conversation', async () => {
    const { steps, thread } = await load(store)
    await thread.appendTurn(CONVO, 'user', 'hello')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'update', at: 1, outcome: 'ok' })

    // Something that is not ours, sitting in our ledger.
    const ledger = (await ledgerOf(pool))!
    const stray = await ledger.getFileHandle('stray', { create: true })
    const w = await stray.createWritable()
    await w.write(JSON.stringify({ kind: 'chat-step', convoId: 'chat:someone-else', runId: 'r', seq: 0 }))
    await w.close()

    expect(await thread.deleteConversation(CONVO), 'unproven is not ours to delete').toBe(false)
    expect(await bucketOf(pool)).toBeDefined()
  })

  it('still refuses a subdirectory that is not the ledger at all', async () => {
    const { thread } = await load(store)
    await thread.appendTurn(CONVO, 'user', 'hello')
    const bucket = (await bucketOf(pool))!
    await bucket.getDirectoryHandle('9'.repeat(64), { create: true })

    expect(await thread.deleteConversation(CONVO)).toBe(false)
    expect(await bucketOf(pool)).toBeDefined()
  })
})

describe('the ledger keeps the run private', () => {
  it('mints every payload SILENTLY — a recorded request is not published', async () => {
    const { steps } = await load(store)
    await steps.appendStep({
      convoId: CONVO, runId: RUN, seq: 0, verb: 'note-add', at: 1,
      outcome: 'failed', request: { cell: '/private', text: 'working notes' },
      error: 'nope',
    })

    // `content:wrote` is the publication trigger — HostSync PUTs on that
    // signal, with no filter on kind. Every resource the
    // ledger mints must suppress it, or a run's private working material is
    // enqueued for a host the participant never chose to show it to.
    expect(store.putOptions.length, 'request AND error were both stored').toBe(2)
    for (const options of store.putOptions) expect(options).toEqual({ emit: false })
  })
})

describe('a replayed step never destroys the record it repeats', () => {
  it('does not reopen the file when the identical step is written again', async () => {
    const { steps } = await load(store)
    const step = {
      convoId: CONVO, runId: RUN, seq: 0, verb: 'update', at: 4242,
      outcome: 'ok' as const, request: { cell: '/x' },
    }
    await steps.appendStep(step)
    const ledger = (await ledgerOf(pool))!
    const file = [...ledger.files.values()][0]!
    expect(file.opens).toBe(1)

    // createWritable() truncates to zero and only refills on close, so
    // rewriting a complete record opens a window where a crash leaves it
    // empty. The record is content-addressed: there is nothing to write.
    expect(await steps.appendStep(step)).toBe(true)
    expect(file.opens, 'the complete record was left untouched').toBe(1)
    expect(await steps.readSteps(CONVO, RUN)).toHaveLength(1)
  })

  it('does not let an interrupted write brick the conversation forever', async () => {
    const { steps, thread } = await load(store)
    await thread.appendTurn(CONVO, 'user', 'hello')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'update', at: 1, outcome: 'ok' })

    // Exactly what a crash between getFileHandle and close leaves behind.
    const ledger = (await ledgerOf(pool))!
    await ledger.getFileHandle('0'.repeat(64), { create: true })

    // An empty entry is this ledger's own half-write, not foreign bytes — if
    // it counted as unaccounted-for, Delete would refuse for good.
    expect(await thread.deleteConversation(CONVO)).toBe(true)
    expect(await bucketOf(pool)).toBeUndefined()
  })
})

describe('an unrecognised outcome never reads as landed', () => {
  it('settles anything that is not "ok" to failed', async () => {
    const { steps } = await load(store)
    await steps.appendStep({
      convoId: CONVO, runId: RUN, seq: 0, verb: 'update', at: 1,
      outcome: 'pending' as unknown as 'ok',
    })
    expect((await steps.readSteps(CONVO, RUN))[0]!.outcome).toBe('failed')
  })
})

describe('failing to read is not an empty run', () => {
  it('propagates a store failure instead of reporting that nothing landed', async () => {
    const failing = {
      ...store,
      getPool: async () => { throw new Error('OPFS unavailable') },
    }
    vi.resetModules()
    const g = globalThis as Record<string, unknown>
    g['get'] = (key: string) => key === '@hypercomb.social/Store' ? failing : undefined
    const steps = await import('./chat-steps.js')

    // An empty array here would be indistinguishable from "this run has done
    // nothing", and a resuming responder would redo work that already landed.
    await expect(steps.readSteps(CONVO, RUN)).rejects.toThrow('OPFS unavailable')
  })
})

describe('the reader finds what the writer wrote', () => {
  // THE BUG CLASS THIS CLOSES. The responder writes a run's steps and the
  // agent panel reads them back. If the two compute the bucket from different
  // inputs they disagree silently: the ledger fills, every read is empty, and
  // nothing reports a fault. Both now address the ASK, and this proves the
  // round trip rather than trusting it.

  const ASK = 'f'.repeat(64)

  it('reads back by ask sig alone what a run recorded under it', async () => {
    const { steps } = await load(store)

    const convoId = steps.runConvoForAsk(ASK)
    const runId = await steps.runIdForAsk(ASK)
    await steps.appendStep({
      convoId, runId, seq: 0, verb: 'note-add', at: 10, outcome: 'ok',
      request: { cell: 'site', segments: ['dolphin'] },
    })
    await steps.appendStep({
      convoId, runId, seq: 1, verb: 'optimization-remove', at: 20, outcome: 'failed',
      error: 'gone',
    })

    // The panel knows the ask sig and nothing else — exactly what it has.
    const read = await steps.readAskSteps(ASK)
    expect(read.map(s => [s.verb, s.outcome])).toEqual([
      ['note-add', 'ok'],
      ['optimization-remove', 'failed'],
    ])
    expect(await steps.stepRequest(read[0]!)).toEqual({ cell: 'site', segments: ['dolphin'] })
  })

  it('keeps a headless run out of the chat list', async () => {
    const { steps, thread } = await load(store)
    expect(thread.isHumanConversation(steps.runConvoForAsk(ASK))).toBe(false)

    await steps.appendStep({
      convoId: steps.runConvoForAsk(ASK), runId: await steps.runIdForAsk(ASK),
      seq: 0, verb: 'update', at: 1, outcome: 'ok',
    })
    // A run's bucket holds no turns, so the chat window never lists it.
    expect((await thread.listConversations()).map(c => c.convoId)).not.toContain(steps.runConvoForAsk(ASK))
  })

  it('says nothing about an ask that never ran', async () => {
    const { steps } = await load(store)
    expect(await steps.readAskSteps('c'.repeat(64))).toEqual([])
    expect(await steps.readAskSteps('')).toEqual([])
  })
})

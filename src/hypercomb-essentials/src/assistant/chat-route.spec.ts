// assistant/chat-route.spec.ts
//
// THE ROUTE IS A VIEW OVER RECORDS — mechanical proof of every placement
// rule in chat-route.ts, over hand-built turns and steps (no store, no
// clock but the one passed), and of the reader's one promise: a fault
// THROWS, it never draws as an empty pipe.
//
// What these tests freeze:
//   1. a run belongs to the reply row its own `chat-reply` step names — by
//      the TURN's sig only, never the content sig
//   2. the live run is the one whose id the shell passes, never "the one
//      with no reply yet"
//   3. every other run is placed by time on the first assistant turn after
//      its last step; a user turn first (or nothing) leaves it unfinished,
//      and a young unfinished run is "in progress"
//   4. a piece is one RUN: attempts are the settled mutating-not-hidden
//      verbs in seq order; a failed attempt anywhere is a leak; reads and
//      bookkeeping are not drawn, and a run with nothing drawable has no piece
//   5. rows are ordered by the thread, never by run id
//   6. readRoute reads the bucket strictly: no bucket → empty, no ledger →
//      empty, a store or file fault → rejects

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
  // jsdom's Blob has neither arrayBuffer() nor text(); the modules under
  // test only ever build one from string or byte parts.
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

import { deriveRoute, IN_PROGRESS_MS, type RouteTurn } from './chat-route.js'
import type { ChatStep } from './chat-steps.js'

// ── the pure derivation ─────────────────────────────────────────────────

const CONVO = 'chat:tile:/dolphin'
const SIG = (letter: string): string => letter.repeat(64)

const turn = (role: 'user' | 'assistant', at: number, sig?: string): RouteTurn =>
  ({ role, at, ...(sig ? { sig } : {}) })

let seqs = new Map<string, number>()
const step = (
  runId: string,
  verb: string,
  at: number,
  extra: Partial<Omit<ChatStep, 'kind' | 'convoId' | 'runId' | 'verb' | 'at'>> = {},
): ChatStep => {
  const seq = extra.seq ?? (seqs.get(runId) ?? 0)
  seqs.set(runId, seq + 1)
  return { kind: 'chat-step', convoId: CONVO, runId, seq, verb, at, outcome: 'ok', ...extra }
}

const NO_REQUESTS = new Map<string, unknown>()

beforeEach(() => { seqs = new Map() })

describe('rule 1 — a run belongs to the reply its own chat-reply step names', () => {
  it('lands on the row whose TURN sig the step carries', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 300, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'chat-reply', 310, { sigs: [SIG('b'), SIG('c')] }),
    ], NO_REQUESTS)

    expect(route.rows).toHaveLength(1)
    expect(route.rows[0]!.turnSig).toBe(SIG('b'))
    expect(route.rows[0]!.index).toBe(1)
    expect(route.rows[0]!.pieces).toHaveLength(1)
    expect(route.rows[0]!.pieces[0]!.placedByTime).toBeUndefined()
    expect(route.unfinished).toEqual([])
    expect(route.live).toBeUndefined()
  })

  it('matches the turn sig ONLY — a content sig shared by two identical replies is not a row', () => {
    // Two replies that said the same words share one content resource;
    // the step's bag carries it beside the turn sig. Only the turn sig may
    // decide the row, so the content sig is deliberately made to LOOK like a
    // turn of a different row: it must still not be matched.
    const shared = SIG('c')
    const turns = [
      turn('user', 100, SIG('a')),
      turn('assistant', 300, SIG('b')),
      turn('user', 400, SIG('d')),
      turn('assistant', 600, SIG('e')),
    ]
    const route = deriveRoute(turns, [
      step('run-2', 'update', 500),
      // Names the SECOND reply by turn sig, and the shared content sig too.
      step('run-2', 'chat-reply', 610, { sigs: [shared, SIG('e')] }),
    ], NO_REQUESTS)
    expect(route.rows.map(r => r.turnSig)).toEqual([SIG('e')])

    // A step whose only sig is the content sig names no row and falls
    // through to time — and its last step (the reply's own, at 610) is
    // after every turn, so no reply follows it: unfinished after the last
    // turn, never a row.
    const byContent = deriveRoute(turns, [
      step('run-3', 'update', 500),
      step('run-3', 'chat-reply', 610, { sigs: [shared] }),
    ], NO_REQUESTS, { now: 1_000_000 })
    expect(byContent.rows).toEqual([])
    expect(byContent.unfinished.map(u => [u.afterIndex, u.piece.runId])).toEqual([[3, 'run-3']])
  })

  it('takes the LAST reply when a run replied more than once', () => {
    const turns = [
      turn('user', 100, SIG('a')),
      turn('assistant', 300, SIG('b')),
      turn('assistant', 500, SIG('c')),
    ]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'chat-reply', 310, { sigs: [SIG('b')] }),
      step('run-1', 'note-add', 400),
      step('run-1', 'chat-reply', 510, { sigs: [SIG('c')] }),
    ], NO_REQUESTS)
    expect(route.rows.map(r => r.turnSig)).toEqual([SIG('c')])
    expect(route.rows[0]!.pieces[0]!.attempts).toHaveLength(2)
  })

  it('wins over the live rule — a reply that landed is on its row, not in the wait', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 300, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'chat-reply', 310, { sigs: [SIG('b')] }),
    ], NO_REQUESTS, { liveRunId: 'run-1' })
    expect(route.live).toBeUndefined()
    expect(route.rows[0]!.turnSig).toBe(SIG('b'))
  })

  it('ignores a FAILED chat-reply — nothing was written, so nothing is named', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 300, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'chat-reply', 310, { outcome: 'failed', sigs: [SIG('b')] }),
    ], NO_REQUESTS, { now: 100_000 })
    // Falls through to time: the assistant turn at 300 precedes the last
    // step at 310, so no reply followed the run — unfinished.
    expect(route.rows).toEqual([])
    expect(route.unfinished).toHaveLength(1)
  })
})

describe('rule 2 — the live run is named, never inferred', () => {
  it('puts the run whose id the shell passes in the live slot', () => {
    const turns = [turn('user', 100, SIG('a'))]
    const route = deriveRoute(turns, [
      step('run-live', 'note-add', 200),
      step('run-live', 'put-resource', 250),
    ], NO_REQUESTS, { liveRunId: 'run-live', now: 300 })
    expect(route.live?.runId).toBe('run-live')
    expect(route.live?.attempts.map(a => a.verb)).toEqual(['note-add', 'put-resource'])
    expect(route.rows).toEqual([])
    expect(route.unfinished).toEqual([])
  })

  it('does not mistake a dead run for the live one', () => {
    // Two runs with no reply step; only the named one is live. The other
    // is what it is — unfinished (and, being old, not in progress).
    const turns = [turn('user', 100, SIG('a'))]
    const route = deriveRoute(turns, [
      step('run-dead', 'note-add', 200),
      step('run-live', 'note-add', 300),
    ], NO_REQUESTS, { liveRunId: 'run-live', now: 300 + IN_PROGRESS_MS })
    expect(route.live?.runId).toBe('run-live')
    expect(route.unfinished.map(u => u.piece.runId)).toEqual(['run-dead'])
    expect(route.unfinished[0]!.piece.inProgress).toBeUndefined()
  })

  it('has no live piece when the live run has recorded nothing drawable', () => {
    const route = deriveRoute([turn('user', 100, SIG('a'))], [
      step('run-live', 'layer-at', 200),
      step('run-live', 'get-resource', 210),
    ], NO_REQUESTS, { liveRunId: 'run-live' })
    expect(route.live).toBeUndefined()
  })
})

describe('rule 3 — placed by time, or unfinished', () => {
  const turns = [
    turn('user', 100, SIG('a')),
    turn('assistant', 300, SIG('b')),
    turn('user', 400, SIG('c')),
    turn('assistant', 600, SIG('d')),
  ]

  it('goes to the first assistant turn after its last step, and says so', () => {
    // A responder that delivered through an older _chat-reply.cjs: work
    // recorded, reply written, no chat-reply step. The reply is right
    // there; the route must not say it never landed.
    const route = deriveRoute(turns, [step('run-1', 'note-add', 200)], NO_REQUESTS)
    expect(route.rows).toHaveLength(1)
    expect(route.rows[0]!.turnSig).toBe(SIG('b'))
    expect(route.rows[0]!.pieces[0]!.placedByTime).toBe(true)
    expect(route.unfinished).toEqual([])
  })

  it('never crosses the next user turn', () => {
    // The run's last step is after the first reply and before the second
    // question: the next turn is a USER turn, so no reply followed it.
    const route = deriveRoute(turns, [step('run-1', 'note-add', 350)], NO_REQUESTS, { now: 100_000 })
    expect(route.rows).toEqual([])
    expect(route.unfinished).toEqual([{ afterIndex: 1, piece: { runId: 'run-1', attempts: route.unfinished[0]!.piece.attempts, leak: false } }])
  })

  it('places a run that followed the second question on the second reply', () => {
    const route = deriveRoute(turns, [step('run-1', 'update', 500)], NO_REQUESTS)
    expect(route.rows.map(r => [r.turnSig, r.index])).toEqual([[SIG('d'), 3]])
  })

  it('is unfinished after the last turn, with the index it follows', () => {
    const route = deriveRoute(turns, [step('run-1', 'update', 700)], NO_REQUESTS, { now: 700 + IN_PROGRESS_MS })
    expect(route.rows).toEqual([])
    expect(route.unfinished.map(u => [u.afterIndex, u.piece.inProgress])).toEqual([[3, undefined]])
  })

  it('is unfinished BEFORE every turn with afterIndex -1', () => {
    const route = deriveRoute([turn('user', 500, SIG('a'))], [step('run-0', 'update', 100)], NO_REQUESTS, { now: 500_000 })
    expect(route.unfinished.map(u => u.afterIndex)).toEqual([-1])
  })

  it('draws a young unfinished run as IN PROGRESS — the reply step may simply not have landed', () => {
    // Every normal reply passes through this state: the turn is written
    // and the effect fires BEFORE the chat-reply step is recorded.
    const at = 700
    const young = deriveRoute(turns, [step('run-1', 'update', at)], NO_REQUESTS, { now: at + IN_PROGRESS_MS - 1 })
    expect(young.unfinished[0]!.piece.inProgress).toBe(true)
    const old = deriveRoute(turns, [step('run-1', 'update', at)], NO_REQUESTS, { now: at + IN_PROGRESS_MS })
    expect(old.unfinished[0]!.piece.inProgress).toBeUndefined()
  })

  it('measures the run by its LAST step, hidden ones included', () => {
    // The retire is hidden from the card but it is still the run's newest
    // step: a run whose work was at 200 and whose retire was at 450 is
    // after the second question, not before it.
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'optimization-remove', 450),
    ], NO_REQUESTS)
    expect(route.rows.map(r => r.turnSig)).toEqual([SIG('d')])
  })

  it('gives a turn without a sig no pieces — an in-flight reply cannot carry work', () => {
    const inFlight = [turn('user', 100, SIG('a')), turn('assistant', 300)]
    const route = deriveRoute(inFlight, [step('run-1', 'note-add', 200)], NO_REQUESTS, { now: 100_000 })
    expect(route.rows).toEqual([])
    expect(route.unfinished.map(u => u.afterIndex)).toEqual([0])
  })
})

describe('what a piece is', () => {
  it('is one run: the settled attempts in seq order, work verbs only', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'layer-at', 200),                 // a read — recorded, not drawn
      step('run-1', 'note-add', 300),
      step('run-1', 'get-resource', 350),             // a read
      step('run-1', 'decoration-add', 400),
      step('run-1', 'effect-emit', 450),              // a UI intent — not work
      step('run-1', 'optimization-remove', 500),      // the retire — bookkeeping
      step('run-1', 'chat-goal-reached', 600),        // the receipt — bookkeeping
      step('run-1', 'chat-reply', 910, { sigs: [SIG('b')] }),
    ], NO_REQUESTS)
    expect(route.rows[0]!.pieces).toHaveLength(1)
    expect(route.rows[0]!.pieces[0]!.attempts.map(a => [a.seq, a.verb])).toEqual([[1, 'note-add'], [3, 'decoration-add']])
    expect(route.rows[0]!.pieces[0]!.leak).toBe(false)
  })

  it('has no piece for a run that recorded nothing drawable', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'thread-read', 200),
      step('run-1', 'layer-at', 300),
      step('run-1', 'chat-reply', 910, { sigs: [SIG('b')] }),
    ], NO_REQUESTS)
    expect(route.rows).toEqual([])
    expect(route.unfinished).toEqual([])
  })

  it('settles retries first — one attempt per seq, the outcome that stands', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 300, { seq: 0, outcome: 'failed', errorSig: SIG('e') }),
      step('run-1', 'note-add', 320, { seq: 0, outcome: 'ok' }),   // the retry that landed
      step('run-1', 'chat-reply', 910, { seq: 1, sigs: [SIG('b')] }),
    ], NO_REQUESTS)
    const piece = route.rows[0]!.pieces[0]!
    expect(piece.attempts).toHaveLength(1)
    expect(piece.attempts[0]!.outcome).toBe('ok')
    // The retry that stands is ok, so the run is not a leak.
    expect(piece.leak).toBe(false)
  })

  it('is a LEAK when a settled attempt failed, and names the failure', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const requests = new Map<string, unknown>([[SIG('1'), { cell: 'no-such-tile', segments: [], text: 'x' }]])
    const errors = new Map<string, string>([[SIG('e'), 'cell not found: no-such-tile']])
    const route = deriveRoute(turns, [
      step('run-1', 'put-resource', 200),
      step('run-1', 'note-add', 300, { outcome: 'failed', contentSig: SIG('1'), errorSig: SIG('e') }),
      step('run-1', 'chat-reply', 910, { sigs: [SIG('b')] }),
    ], requests, { errors })
    const piece = route.rows[0]!.pieces[0]!
    expect(piece.leak).toBe(true)
    expect(piece.attempts.map(a => a.outcome)).toEqual(['ok', 'failed'])
    expect(piece.attempts[1]).toEqual({
      seq: 1, verb: 'note-add', outcome: 'failed', at: 300,
      cell: 'no-such-tile', error: 'cell not found: no-such-tile',
    })
    // An attempt that worked carries no error even if its request is known.
    expect(piece.attempts[0]!.error).toBeUndefined()
  })

  it('labels an attempt by the target its request named, when the request is known', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const requests = new Map<string, unknown>([[SIG('1'), { cell: 'site', op: 'update' }]])
    const route = deriveRoute(turns, [
      step('run-1', 'update', 200, { contentSig: SIG('1') }),
      step('run-1', 'update', 250, { contentSig: SIG('2') }),   // request not materialized
      step('run-1', 'chat-reply', 910, { sigs: [SIG('b')] }),
    ], requests)
    expect(route.rows[0]!.pieces[0]!.attempts.map(a => a.cell)).toEqual(['site', undefined])
  })

  it('does not draw a hidden verb even when it failed', () => {
    // A retire that failed is the loop's bookkeeping going wrong, not the
    // participant's work leaking.
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'optimization-remove', 500, { outcome: 'failed' }),
      step('run-1', 'chat-reply', 910, { sigs: [SIG('b')] }),
    ], NO_REQUESTS)
    expect(route.rows[0]!.pieces[0]!.leak).toBe(false)
    expect(route.rows[0]!.pieces[0]!.attempts.map(a => a.verb)).toEqual(['note-add'])
  })
})

describe('order', () => {
  it('is the thread\'s order, never the run id\'s', () => {
    // Run ids sort the wrong way round on purpose: settle() orders by run
    // id, and the route must not inherit that.
    const turns = [
      turn('user', 100, SIG('a')), turn('assistant', 300, SIG('b')),
      turn('user', 400, SIG('c')), turn('assistant', 600, SIG('d')),
    ]
    const route = deriveRoute(turns, [
      step('zzz-first', 'note-add', 200),
      step('zzz-first', 'chat-reply', 310, { sigs: [SIG('b')] }),
      step('aaa-second', 'note-add', 500),
      step('aaa-second', 'chat-reply', 610, { sigs: [SIG('d')] }),
    ], NO_REQUESTS)
    expect(route.rows.map(r => [r.index, r.pieces[0]!.runId])).toEqual([[1, 'zzz-first'], [3, 'aaa-second']])
  })

  it('orders two runs on one row by when they ended', () => {
    const turns = [turn('user', 100, SIG('a')), turn('assistant', 900, SIG('b'))]
    const route = deriveRoute(turns, [
      step('later', 'note-add', 500),
      step('later', 'chat-reply', 910, { sigs: [SIG('b')] }),
      step('earlier', 'note-add', 200),
      step('earlier', 'chat-reply', 905, { sigs: [SIG('b')] }),
    ], NO_REQUESTS)
    expect(route.rows[0]!.pieces.map(p => p.runId)).toEqual(['earlier', 'later'])
  })

  it('orders unfinished runs by the turn they follow', () => {
    const turns = [
      turn('user', 100, SIG('a')), turn('assistant', 300, SIG('b')),
      turn('user', 400, SIG('c')),
    ]
    const route = deriveRoute(turns, [
      step('late', 'note-add', 450),
      step('early', 'note-add', 350),
    ], NO_REQUESTS, { now: 1_000_000 })
    expect(route.unfinished.map(u => [u.afterIndex, u.piece.runId])).toEqual([[1, 'early'], [2, 'late']])
  })

  it('is empty when there are no steps at all', () => {
    expect(deriveRoute([turn('user', 1, SIG('a'))], [], NO_REQUESTS)).toEqual({ rows: [], unfinished: [] })
  })
})

// ── the reader ──────────────────────────────────────────────────────────
//
// An in-memory OPFS, the slice chat-thread and chat-steps touch. The reader
// is exercised through the real writers so the join it depends on — the
// chat-reply step naming the turn file's name — is the one the worker makes.

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  failRead = false
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    if (this.failRead) throw new DOMException('disk gone', 'NotReadableError')
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
      write: async (chunk: Blob | ArrayBuffer | Uint8Array | string) => {
        if (typeof chunk === 'string') { this.bytes = new TextEncoder().encode(chunk); return }
        if (ArrayBuffer.isView(chunk)) {
          const view = chunk as Uint8Array
          this.bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer)
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
  return {
    resources,
    getPool: async () => pool as unknown as FileSystemDirectoryHandle,
    putResource: async (blob: Blob) => {
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

type RouteModule = typeof import('./chat-route.js')
type StepsModule = typeof import('./chat-steps.js')
type ThreadModule = typeof import('./chat-thread.js')

const load = async (store: unknown): Promise<{ route: RouteModule; steps: StepsModule; thread: ThreadModule }> => {
  vi.resetModules()
  const g = globalThis as Record<string, unknown>
  g['get'] = (key: string) => key === '@hypercomb.social/Store' ? store : undefined
  return {
    route: await import('./chat-route.js'),
    steps: await import('./chat-steps.js'),
    thread: await import('./chat-thread.js'),
  }
}

const bucketOf = async (pool: MockDir, convoId: string): Promise<MockDir | undefined> =>
  pool.dirs.get(await sha256Hex(new TextEncoder().encode(convoId)))

describe('readRoute reads the records, strictly', () => {
  const RUN = 'ask:' + '7'.repeat(32)

  it('lays a run along the reply its chat-reply step named — the join the worker makes', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const { route, steps, thread } = await load(store)

    await thread.appendTurn(CONVO, 'user', 'lay this out')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'note-add', at: 200, outcome: 'ok', request: { cell: 'site', text: 'a note' } })
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 1, verb: 'update', at: 300, outcome: 'failed', request: { cell: 'gone' }, error: 'no such cell' })
    // What #chatReply does: write the turn, get its sig back, and the step
    // recorded for the op carries that sig.
    const stored = await thread.deliverTurnSig(CONVO, 'assistant', 'Two ways to lay this out.')
    expect(stored?.turnSig).toMatch(/^[0-9a-f]{64}$/)
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 2, verb: 'chat-reply', at: 400, outcome: 'ok', sigs: [stored!.turnSig, stored!.contentSig!] })

    const result = await route.readRoute(CONVO)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.turnSig).toBe(stored!.turnSig)
    expect(result.rows[0]!.index).toBe(1)
    const piece = result.rows[0]!.pieces[0]!
    expect(piece.runId).toBe(RUN)
    expect(piece.leak).toBe(true)
    expect(piece.placedByTime).toBeUndefined()
    // Requests and errors were materialized from the ledger's resources.
    expect(piece.attempts.map(a => [a.verb, a.outcome, a.cell, a.error])).toEqual([
      ['note-add', 'ok', 'site', undefined],
      ['update', 'failed', 'gone', 'no such cell'],
    ])
    // And the same turn read through the ordinary reader carries the sig
    // the route is keyed by — the shell's join.
    const turns = await thread.readTurns(CONVO)
    expect(turns.map(t => t.sig)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), stored!.turnSig])
  })

  it('names the live run by the id the shell passes', async () => {
    const pool = new MockDir('threads')
    const { route, steps, thread } = await load(makeStore(pool))
    await thread.appendTurn(CONVO, 'user', 'go')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'put-resource', at: Date.now(), outcome: 'ok' })
    const result = await route.readRoute(CONVO, RUN)
    expect(result.live?.runId).toBe(RUN)
    expect(result.rows).toEqual([])
    expect(result.unfinished).toEqual([])
  })

  it('is empty for a conversation with no bucket, and for one with no ledger', async () => {
    const pool = new MockDir('threads')
    const { route, thread } = await load(makeStore(pool))
    expect(await route.readRoute('chat:never')).toEqual({ rows: [], unfinished: [] })
    expect(await route.readRoute('')).toEqual({ rows: [], unfinished: [] })

    await thread.appendTurn(CONVO, 'user', 'hello')
    expect((await bucketOf(pool, CONVO))!.dirs.size, 'no ledger was minted by reading').toBe(0)
    expect(await route.readRoute(CONVO)).toEqual({ rows: [], unfinished: [] })
  })

  it('REJECTS on a store fault instead of drawing an empty pipe', async () => {
    const { route } = await load({ getPool: async () => { throw new Error('OPFS unavailable') } })
    await expect(route.readRoute(CONVO)).rejects.toThrow('OPFS unavailable')
  })

  it('REJECTS when a turn file cannot be read', async () => {
    const pool = new MockDir('threads')
    const { route, thread } = await load(makeStore(pool))
    await thread.appendTurn(CONVO, 'user', 'hello')
    for (const file of (await bucketOf(pool, CONVO))!.files.values()) file.failRead = true
    await expect(route.readRoute(CONVO)).rejects.toThrow('disk gone')
    // The window's own reader still swallows — that contract is unchanged.
    expect(await thread.readTurns(CONVO)).toEqual([])
  })

  it('REJECTS when a step file cannot be read', async () => {
    const pool = new MockDir('threads')
    const { route, steps, thread } = await load(makeStore(pool))
    await thread.appendTurn(CONVO, 'user', 'hello')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'note-add', at: 1, outcome: 'ok' })
    const ledger = [...(await bucketOf(pool, CONVO))!.dirs.values()][0]!
    for (const file of ledger.files.values()) file.failRead = true
    await expect(route.readRoute(CONVO)).rejects.toThrow('disk gone')
  })

  it('skips the ledger\'s own half-written entry — a state, not a fault', async () => {
    const pool = new MockDir('threads')
    const { route, steps, thread } = await load(makeStore(pool))
    await thread.appendTurn(CONVO, 'user', 'hello')
    await steps.appendStep({ convoId: CONVO, runId: RUN, seq: 0, verb: 'note-add', at: Date.now(), outcome: 'ok' })
    const ledger = [...(await bucketOf(pool, CONVO))!.dirs.values()][0]!
    await ledger.getFileHandle('0'.repeat(64), { create: true })   // zero bytes: a crash mid-write
    const result = await route.readRoute(CONVO, RUN)
    expect(result.live?.attempts).toHaveLength(1)
  })
})

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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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

import {
  closedFlowEnd,
  deriveRoute,
  extractRouteFlow,
  flowIsBehind,
  flowMatches,
  IN_PROGRESS_MS,
  parseFlowRecord,
  parseRouteFlow,
  ROUTE_FLOW_IDLE_MS,
  ROUTE_FLOW_MAX_NODES,
  ROUTE_FLOW_VERSION,
  routeExchanges,
  routeFlowPrompt,
  validateFlowNodes,
  type RouteTurn,
} from './chat-route.js'
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
  const h = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join('')
}
const signText = (text: string): Promise<string> => sha256Hex(new TextEncoder().encode(text))

const makeStore = (pool: MockDir) => {
  const resources = new Map<string, Uint8Array>()
  /** Every other pool, by meaning — the flows pool among them. */
  const pools = new Map<string, MockDir>()
  /** Every resource minted, with the options it was minted under. */
  const minted: Array<{ sig: string; emit?: boolean }> = []
  /** Every pool opened, by meaning, in order. */
  const opened: string[] = []
  /** The optimization pool's `kind:'ask'` records, by sig. */
  const optimizations = new Map<string, unknown>()
  const counts = { optimizationLists: 0 }
  return {
    resources,
    pools,
    minted,
    opened,
    optimizations,
    counts,
    getPool: async (meaning = 'threads') => {
      opened.push(meaning)
      if (meaning === 'threads') return pool as unknown as FileSystemDirectoryHandle
      let dir = pools.get(meaning)
      if (!dir) { dir = new MockDir(meaning); pools.set(meaning, dir) }
      return dir as unknown as FileSystemDirectoryHandle
    },
    openPool: async (meaning: string) => {
      opened.push(meaning)
      if (meaning === 'threads') return pool as unknown as FileSystemDirectoryHandle
      return (pools.get(meaning) ?? null) as unknown as FileSystemDirectoryHandle | null
    },
    // The runtime Store's document-pool rule: `<pool>/<sign(subKey)>/<sign(bytes)>`,
    // the new member written, then every other member dropped.
    putPoolDoc: async (handle: unknown, bytes: ArrayBuffer, subKey?: string) => {
      const dir = handle as MockDir
      const target = subKey ? await dir.getDirectoryHandle(await signText(subKey), { create: true }) : dir
      const view = new Uint8Array(bytes)
      const sig = await sha256Hex(view)
      const writable = await (await target.getFileHandle(sig, { create: true })).createWritable()
      await writable.write(view)
      for (const name of [...target.files.keys()]) if (name !== sig) target.files.delete(name)
      return sig
    },
    getPoolDoc: async (handle: unknown, subKey?: string) => {
      const dir = handle as MockDir | undefined
      if (!dir) return null
      const target = subKey ? dir.dirs.get(await signText(subKey)) : dir
      for (const file of target?.files.values() ?? []) {
        if (file.bytes.byteLength) return file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      }
      return null
    },
    listOptimizations: async () => { counts.optimizationLists++; return [...optimizations.keys()] },
    getOptimization: async (sig: string) => {
      if (!optimizations.has(sig)) return null
      return { text: () => Promise.resolve(JSON.stringify(optimizations.get(sig))) } as unknown as Blob
    },
    putResource: async (blob: Blob, options?: { emit?: boolean }) => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const sig = await sha256Hex(bytes)
      resources.set(sig, bytes)
      minted.push({ sig, ...(options && 'emit' in options ? { emit: options.emit } : {}) })
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
  pool.dirs.get(await signText(convoId))

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
    const store = makeStore(pool)
    const { route, thread } = await load(store)
    expect(await route.readRoute('chat:never')).toEqual({ rows: [], unfinished: [] })
    expect(await route.readRoute('')).toEqual({ rows: [], unfinished: [] })

    await thread.appendTurn(CONVO, 'user', 'hello')
    expect((await bucketOf(pool, CONVO))!.dirs.size, 'no ledger was minted by reading').toBe(0)
    // No work, and no flow: the exchange is a dormant stage. Reading never
    // created the flows pool.
    const noLedger = await route.readRoute(CONVO)
    expect(noLedger).toEqual({ rows: [], unfinished: [] })
    expect(store.pools.has('chat:route-flows')).toBe(false)
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

describe('ChatThreads names the live run', () => {
  const ASK = SIG('a')

  it('runIdForAsk is the chat-steps derivation, on the surface the shell resolves', async () => {
    const registered = new Map<string, unknown>()
    const ioc = (window as unknown as { ioc: { register: (key: string, value: unknown) => void } }).ioc
    const held = ioc.register
    ioc.register = (key, value) => { registered.set(key, value) }
    try {
      vi.resetModules()
      // chat-thread FIRST, so the cycle chat-thread → chat-route →
      // chat-steps → chat-thread evaluates from the end that instantiates the
      // class at module scope. A field initialiser would read chat-steps'
      // binding in its temporal dead zone here and throw on import.
      const thread = await import('./chat-thread.js')
      const steps = await import('./chat-steps.js')
      const threads = registered.get(thread.CHAT_THREADS_IOC_KEY) as {
        runIdForAsk?: (sig: string) => Promise<string>
        organizeRoute?: (convoId: string, liveRunId?: string, waiting?: boolean) => Promise<number>
        labelRoute?: unknown
      }
      expect(typeof threads?.runIdForAsk).toBe('function')
      expect(await threads.runIdForAsk!(ASK)).toBe(await steps.runIdForAsk(ASK))
      // A method, never an own field: read at call time, after the cycle.
      expect(Object.prototype.hasOwnProperty.call(threads, 'runIdForAsk')).toBe(false)
      // organizeRoute is on the same surface, for the same reason — and the
      // per-exchange labeller it replaced is gone.
      expect(typeof threads?.organizeRoute).toBe('function')
      expect(Object.prototype.hasOwnProperty.call(threads, 'organizeRoute')).toBe(false)
      expect(threads.labelRoute).toBeUndefined()
    } finally {
      ioc.register = held
    }
  })

  it('the id it names is the one readRoute draws as live', async () => {
    const pool = new MockDir('threads')
    const { thread, steps } = await load(makeStore(pool))
    const threads = new thread.ChatThreads()
    const liveRunId = await threads.runIdForAsk(ASK)
    await thread.appendTurn(CONVO, 'user', 'go')
    await steps.appendStep({ convoId: CONVO, runId: liveRunId, seq: 0, verb: 'put-resource', at: Date.now(), outcome: 'ok' })
    const result = await threads.readRoute(CONVO, liveRunId)
    expect(result.live?.runId).toBe(liveRunId)
  })
})

// ── THE FLOW — one organized workflow per conversation ──────────────────
//
// What these tests freeze:
//   7. a model's answer is extracted leniently (think blocks, fences, prose,
//      a trailing comma) and then VALIDATED AND REPAIRED: bad parents, cycles,
//      out-of-range turns, too many nodes, too deep; nothing valid is null
//   8. the prompt is a numbered, clipped transcript with work and decisions;
//      a long thread keeps lead and tail; a previous flow is passed and the
//      model asked to UPDATE it
//   9. the behind rule: a closed exchange beyond the flow; the last exchange
//      closes only once quiet, replied, and with nothing outstanding
//  10. only a MACHINE-LOCAL provider ALREADY known awake is called — never a
//      probe to find out — named explicitly, with no fallback; a closed gate
//      reads nothing, calls nothing, fetches nothing
//  11. ONE recycled slot per conversation, silent writes, a record at another
//      version (or about another history) reads as absent
//  12. the passive drain: live newest-first then archived, a budget, the gate
//      re-read mid-pass, and never a second mint beside the attended one

describe('extracting and repairing a flow', () => {
  const NODES = '{"nodes":[{"id":"a","title":"Plan the site","turns":[0,1],"state":"done"}]}'

  it.each([
    ['plain JSON', NODES],
    ['a think block and a fence', `<think>I should group these</think>\n\`\`\`json\n${NODES}\n\`\`\``],
    ['prose around it', `Here is the workflow:\n${NODES}\nHope that helps.`],
    ['a bare array', '[{"id":"a","title":"Plan the site","turns":[0,1],"state":"done"}]'],
    ['a trailing comma', '{"nodes":[{"id":"a","title":"Plan the site","turns":[0,1],"state":"done"},]}'],
    ['a nested workflow object', `{"workflow":${NODES}}`],
    ['an unterminated fence', `\`\`\`json\n${NODES}`],
  ])('reads %s', (_name, text) => {
    expect(parseRouteFlow(text, 4)).toEqual([{ id: 'a', title: 'Plan the site', turns: [0, 1], state: 'done' }])
  })

  it.each([
    ['broken JSON', '{"nodes": [{"title": "Plan'],
    ['no JSON at all', 'I organized it into three phases.'],
    ['JSON left inside an unclosed think block', `<think>maybe ${NODES}`],
    ['an empty answer', ''],
    ['nodes with nothing valid', '{"nodes":[{"title":"","turns":[0]},{"title":"Far away","turns":[99]}]}'],
  ])('refuses %s', (_name, text) => {
    expect(parseRouteFlow(text, 4)).toBeNull()
  })

  it('extracts the JSON value, not the prose', () => {
    expect(extractRouteFlow('ok ```\n[1, 2]\n``` done')).toEqual([1, 2])
    expect(extractRouteFlow('nothing here')).toBeNull()
  })

  it('repairs titles, details, turns and states', () => {
    const nodes = validateFlowNodes({
      nodes: [{
        id: 'a',
        title: '  "One two three four five six seven eight nine ten."  ',
        detail: 'x'.repeat(300),
        turns: [3, 0, '2', '4-5', 99, -1, 1.5, 'soon', 0],
        state: 'Completed',
      }, {
        id: 'b', title: 'In flight', turns: [1], state: 'in progress',
      }, {
        id: 'c', title: 'Went nowhere', turns: [1], state: 'abandoned',
      }, {
        id: 'd', title: 'Picked one', turns: [1], state: 'decision',
      }, {
        id: 'e', title: 'Whatever', turns: [1], state: 'sideways',
      }],
    }, 6)!
    expect(nodes[0]).toEqual({
      id: 'a', title: 'One two three four five six seven eight', detail: 'x'.repeat(159) + '…', turns: [0, 2, 3, 4, 5], state: 'done',
    })
    expect(nodes.map(n => n.state)).toEqual(['done', 'open', 'dropped', 'decided', 'done'])
  })

  it('keeps ids unique: a missing id is given one, a repeated id drops the later node', () => {
    const nodes = validateFlowNodes([
      { title: 'First', turns: [0] },
      { id: 'n1', title: 'Second', turns: [1] },
      { id: 'n1', title: 'Duplicate', turns: [2] },
      'not a node',
      { id: 'x', turns: [2] },
    ], 4)!
    expect(nodes.map(n => [n.id, n.title])).toEqual([['n1_', 'First'], ['n1', 'Second']])
  })

  it('takes off parents that do not precede — which is what makes a cycle impossible', () => {
    const nodes = validateFlowNodes([
      { id: 'a', parent: 'b', title: 'A', turns: [0] },       // b comes later: off
      { id: 'b', parent: 'a', title: 'B', turns: [1] },       // a precedes: kept
      { id: 'c', parent: 'c', title: 'C', turns: [2] },       // itself: off
      { id: 'd', parent: 'nobody', title: 'D', turns: [3] },  // unknown: off
    ], 4)!
    expect(nodes.map(n => [n.id, n.parent])).toEqual([['a', undefined], ['b', 'a'], ['c', undefined], ['d', undefined]])
  })

  it('re-hangs anything deeper than three levels on the ancestor at depth two', () => {
    const nodes = validateFlowNodes([
      { id: 'a', title: 'A', turns: [0] },
      { id: 'b', parent: 'a', title: 'B', turns: [1] },
      { id: 'c', parent: 'b', title: 'C', turns: [2] },
      { id: 'd', parent: 'c', title: 'D', turns: [3] },
      { id: 'e', parent: 'd', title: 'E', turns: [4] },
    ], 5)!
    expect(nodes.map(n => [n.id, n.parent])).toEqual([['a', undefined], ['b', 'a'], ['c', 'b'], ['d', 'b'], ['e', 'b']])
  })

  it('gives a node with no turns its children\'s, and drops a node that covers nothing either way', () => {
    const nodes = validateFlowNodes([
      { id: 'p', title: 'Phase', turns: [] },
      { id: 'x', parent: 'p', title: 'X', turns: [4, 2] },
      { id: 'y', parent: 'p', title: 'Y', turns: [3] },
      { id: 'z', title: 'Out of range', turns: [50] },
      { id: 'q', title: 'Empty phase' },
      { id: 'r', parent: 'q', title: 'Empty child', turns: [] },
    ], 10)!
    expect(nodes.map(n => [n.id, n.turns])).toEqual([['p', [2, 3, 4]], ['x', [2, 4]], ['y', [3]]])
  })

  it(`keeps at most ${ROUTE_FLOW_MAX_NODES} nodes — the first ones, so every kept parent is kept`, () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, title: `Node ${i}`, turns: [i % 5], ...(i ? { parent: 'n0' } : {}) }))
    const nodes = validateFlowNodes(many, 5)!
    expect(nodes).toHaveLength(ROUTE_FLOW_MAX_NODES)
    expect(nodes[15]!.id).toBe('n15')
    expect(nodes.every(n => !n.parent || nodes.some(p => p.id === n.parent))).toBe(true)
  })

  it('is null with nothing to cover or nothing valid', () => {
    expect(validateFlowNodes([{ title: 'A', turns: [0] }], 0)).toBeNull()
    expect(validateFlowNodes('junk', 5)).toBeNull()
    expect(validateFlowNodes({ nodes: [] }, 5)).toBeNull()
    expect(validateFlowNodes({ other: [{ title: 'A', turns: [0] }] }, 5)).toBeNull()
  })

  it('a stored record at another version, for another conversation, or with no sig reads as absent', () => {
    const record = {
      kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId: CONVO, upToTurnCount: 2, upToTurnSig: SIG('b'), at: 1,
      nodes: [{ id: 'a', title: 'A', turns: [0, 1, 7], state: 'done' }],
    }
    expect(parseFlowRecord(record, CONVO)?.nodes).toEqual([{ id: 'a', title: 'A', turns: [0, 1], state: 'done' }])
    expect(parseFlowRecord({ ...record, v: ROUTE_FLOW_VERSION + 1 }, CONVO)).toBeNull()
    expect(parseFlowRecord(record, 'chat:tile:/other')).toBeNull()
    expect(parseFlowRecord({ ...record, upToTurnSig: '' }, CONVO)).toBeNull()
    expect(parseFlowRecord({ ...record, upToTurnCount: 0 }, CONVO)).toBeNull()
    expect(parseFlowRecord({ ...record, nodes: [{ title: 'A', turns: [5] }] }, CONVO)).toBeNull()
  })
})

const QUESTION_REPLY = 'Two ways.\n\n```hypercomb-question\n{"prompt":"How many pages?","options":["One","Several"]}\n```'

describe('what the model is given', () => {
  it('numbers every turn, reads a question as its one line, and adds work and decisions', () => {
    const prompt = routeFlowPrompt({
      turns: [
        { role: 'user', text: 'Lay it out' },
        { role: 'assistant', text: QUESTION_REPLY },
        { role: 'user', text: 'Several' },
        { role: 'assistant', text: 'Several pages it is.' },
      ],
      work: new Map([[3, [
        { seq: 0, verb: 'note-add', cell: 'site', outcome: 'ok', at: 1 },
        { seq: 1, verb: 'update', cell: 'gone', outcome: 'failed', at: 2 },
      ]]]),
    })
    expect(prompt).toContain('TURNS 0–3')
    expect(prompt).toContain('[0] participant: Lay it out')
    expect(prompt).toContain('[1] reply: Two ways.')
    expect(prompt).toContain('How many pages?')
    expect(prompt).not.toContain('hypercomb-question')
    expect(prompt).toContain('    decided: How many pages? → Several')
    expect(prompt).toContain('    work: note-add site ok · update gone FAILED')
    expect(prompt).not.toContain('PREVIOUS WORKFLOW')
  })

  it('clips each turn and keeps a long thread\'s lead and tail, naming what it cut', () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `turn ${i} ` + 'word '.repeat(80),
    }))
    const prompt = routeFlowPrompt({ turns })
    expect(prompt).toContain('[3] reply: turn 3')
    expect(prompt).toContain('… turns 4–19 omitted …')
    expect(prompt).not.toContain('[4] ')
    expect(prompt).not.toContain('[19] ')
    expect(prompt).toContain('[20] participant: turn 20')
    expect(prompt).toContain('[39] reply: turn 39')
    for (const line of prompt.split('\n').filter(l => l.startsWith('['))) {
      expect(line.replace(/^\[\d+\] (participant|reply): /, '').length).toBeLessThanOrEqual(200)
    }
  })

  it('passes the previous flow and asks for an UPDATE over the new turns', () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `turn ${i}` }))
    const previous = { upToTurnCount: 6, nodes: [{ id: 'site', title: 'Lay out the site', turns: [0, 1, 2], state: 'done' as const }] }
    const prompt = routeFlowPrompt({ turns, previous })
    expect(prompt).toContain('PREVIOUS WORKFLOW (organizes turns 0–5):')
    expect(prompt).toContain('{"nodes":[{"id":"site","title":"Lay out the site","turns":[0,1,2],"state":"done"}]}')
    expect(prompt).toContain('NEW TURNS 6–7 (turns 4–5 repeated for context):')
    expect(prompt).toContain('[4] participant: turn 4')
    expect(prompt).toContain('[7] reply: turn 7')
    expect(prompt).not.toContain('[3] ')
    expect(prompt).toContain('UPDATE it')
    // A previous flow that already read every turn is not an update.
    expect(routeFlowPrompt({ turns, previous: { ...previous, upToTurnCount: 8 } })).not.toContain('PREVIOUS WORKFLOW')
  })
})

describe('the behind rule', () => {
  const NOW = 10_000_000
  const OLD = NOW - ROUTE_FLOW_IDLE_MS
  const RECENT = NOW - 1_000
  const thread = (roles: string, lastAt: number): RouteTurn[] =>
    [...roles].map((r, i) => turn(r === 'u' ? 'user' : 'assistant', lastAt - (roles.length - 1 - i), SIG(String.fromCharCode(97 + i))))

  it('closes every exchange with a later user turn', () => {
    expect(closedFlowEnd(thread('uaua', RECENT), { now: NOW })).toBe(2)
    expect(closedFlowEnd(thread('uau', OLD), { now: NOW })).toBe(2)
    expect(closedFlowEnd(thread('uauaa', RECENT), { now: NOW, liveRunId: 'ask:x', waiting: true, pendingAsk: true })).toBe(2)
  })

  it('closes the LAST exchange only when it holds a reply, the thread is quiet, and nothing is outstanding', () => {
    expect(closedFlowEnd(thread('uaua', OLD), { now: NOW })).toBe(4)
    expect(closedFlowEnd(thread('ua', OLD), { now: NOW })).toBe(2)
    expect(closedFlowEnd(thread('ua', RECENT), { now: NOW })).toBe(0)
    expect(closedFlowEnd(thread('ua', OLD), { now: NOW, pendingAsk: true })).toBe(0)
    expect(closedFlowEnd(thread('ua', OLD), { now: NOW, liveRunId: 'ask:x' })).toBe(0)
    expect(closedFlowEnd(thread('ua', OLD), { now: NOW, waiting: true })).toBe(0)
    expect(closedFlowEnd(thread('u', OLD), { now: NOW })).toBe(0)
    expect(closedFlowEnd(thread('ua', NOW - ROUTE_FLOW_IDLE_MS + 1), { now: NOW })).toBe(0)
  })

  it('carries turns before the first user turn with the first closed exchange', () => {
    expect(closedFlowEnd(thread('aua', OLD), { now: NOW })).toBe(3)
    expect(closedFlowEnd(thread('aua', RECENT), { now: NOW })).toBe(0)
    expect(closedFlowEnd(thread('aaa', OLD), { now: NOW })).toBe(0)
  })

  it('is behind when a closed exchange lies beyond what the flow read', () => {
    expect(flowIsBehind(null, 0)).toBe(false)
    expect(flowIsBehind(null, 2)).toBe(true)
    expect(flowIsBehind({ upToTurnCount: 2 }, 2)).toBe(false)
    expect(flowIsBehind({ upToTurnCount: 2 }, 4)).toBe(true)
    expect(flowIsBehind({ upToTurnCount: 4 }, 2)).toBe(false)
  })

  it('a flow is about THIS history only while its last turn is still there, unchanged', () => {
    const turns = thread('uaua', OLD)
    expect(flowMatches({ upToTurnCount: 2, upToTurnSig: SIG('b') }, turns)).toBe(true)
    expect(flowMatches({ upToTurnCount: 2, upToTurnSig: SIG('z') }, turns)).toBe(false)
    expect(flowMatches({ upToTurnCount: 5, upToTurnSig: SIG('e') }, turns)).toBe(false)
  })
})

describe('exchanges carry their work by row', () => {
  it('splits the thread at user turns and gives each the attempts of its rows and unfinished runs', () => {
    const turns = [
      turn('user', 100, SIG('a')), turn('assistant', 300, SIG('b')),
      turn('user', 400, SIG('c')), turn('assistant', 600, SIG('d')),
    ]
    const route = deriveRoute(turns, [
      step('run-1', 'note-add', 200),
      step('run-1', 'chat-reply', 310, { sigs: [SIG('b')] }),
      step('run-2', 'update', 350),    // no reply before the next question: unfinished after row 1
      step('run-3', 'update', 500),    // placed by time on the second reply
    ], NO_REQUESTS, { now: 1_000_000 })
    const [first, second] = routeExchanges(turns, route)
    expect([first!.index, first!.end, second!.index, second!.end]).toEqual([0, 2, 2, 4])
    expect(first!.attempts.map(a => `${a.runId}:${a.row}:${a.attempt.verb}`)).toEqual(['run-1:1:note-add', 'run-2:1:update'])
    expect(second!.attempts.map(a => `${a.runId}:${a.row}:${a.attempt.verb}`)).toEqual(['run-3:3:update'])
  })
})

const LOCAL_HOST = 'http://127.0.0.1:11434'
const MODELS_URL = `${LOCAL_HOST}/v1/models`
const CHAT_URL = `${LOCAL_HOST}/v1/chat/completions`
const FLOWS_MEANING = 'chat:route-flows'
const FLOW_ANSWER = JSON.stringify({
  nodes: [
    { id: 'site', title: 'Lay out the site', detail: 'Chose a structure for the pages.', turns: [0, 1, 2, 3], state: 'done' },
    { id: 'pages', parent: 'site', title: 'Choose how many pages', turns: [1, 2], state: 'decided' },
  ],
})
/** An hour ago: every exchange here is long quiet unless a test says not. */
const OLD_AT = Date.now() - 60 * 60_000

const answered = (json: unknown) => ({
  ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json),
})
const completion = (content: string) => answered({
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
})

/** A machine-local server as fetch sees it: `/v1/models` names one model,
 *  completions answer through `reply`, anything else is refused. */
const localServer = (reply: (body: string) => unknown = () => completion(FLOW_ANSWER)) =>
  vi.fn(async (url: string, init?: { body?: unknown }): Promise<unknown> => {
    if (url === MODELS_URL) return answered({ data: [{ id: 'qwen2.5-coder:7b' }] })
    if (url === CHAT_URL) return reply(String(init?.body ?? ''))
    throw new TypeError(`refused: ${url}`)
  })

/** A turn written the way chat-thread writes one, at a chosen time. */
const seedTurn = async (
  store: ReturnType<typeof makeStore>,
  pool: MockDir,
  role: 'user' | 'assistant',
  text: string,
  at: number,
  convoId = CONVO,
): Promise<string> => {
  const contentSig = await store.putResource(new Blob([text]))
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: 'chat-turn', convoId, role, at, contentSig }))
  const sig = await sha256Hex(bytes)
  const name = await signText(convoId)
  let bucket = pool.dirs.get(name)
  if (!bucket) { bucket = new MockDir(name); pool.dirs.set(name, bucket) }
  const writable = await (await bucket.getFileHandle(sig, { create: true })).createWritable()
  await writable.write(bytes)
  return sig
}

/** Two exchanges, long quiet; resolves the four turn sigs. */
const twoExchanges = async (
  store: ReturnType<typeof makeStore>,
  pool: MockDir,
  convoId = CONVO,
  at = OLD_AT,
  words = 'Lay out the site',
): Promise<string[]> => [
  await seedTurn(store, pool, 'user', words, at + 100, convoId),
  await seedTurn(store, pool, 'assistant', QUESTION_REPLY, at + 200, convoId),
  await seedTurn(store, pool, 'user', 'Several', at + 300, convoId),
  await seedTurn(store, pool, 'assistant', 'Several pages it is.', at + 400, convoId),
]

/** The route module and the provider modules, from ONE module graph — the
 *  graph chat-route's lazy imports resolve into. */
const loadFlows = async (store: ReturnType<typeof makeStore>) => {
  const loaded = await load(store)
  return {
    ...loaded,
    registry: (await import('./llm-provider-registry.js')).llmProviderRegistry(),
    activation: (await import('./llm-activation.js')).llmActivation,
    liveness: await import('./providers/local-liveness.js'),
    dispatch: await import('./llm-dispatch.js'),
    local: await import('./providers/local.provider.js'),
    core: await import('@hypercomb/core'),
  }
}
type Flows = Awaited<ReturnType<typeof loadFlows>>

/** Somebody ELSE's probe found the server awake — the console, a call. The
 *  fetch log is cleared afterwards, so every later call is the flow's. */
const wake = async (m: Flows, server: ReturnType<typeof localServer>): Promise<void> => {
  vi.stubGlobal('fetch', server)
  expect((await m.liveness.checkLocalServer(m.registry.get('local')!)).state).toBe('awake')
  server.mockClear()
}

/** The conversation's slot in the flows pool: the sub-bucket and its files. */
const slotOf = async (store: ReturnType<typeof makeStore>, convoId = CONVO): Promise<MockDir | undefined> =>
  store.pools.get(FLOWS_MEANING)?.dirs.get(await signText(convoId))

const recordIn = (slot: MockDir | undefined): Record<string, unknown> | null => {
  const file = slot ? [...slot.files.values()][0] : undefined
  return file ? JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown> : null
}

const bodyOf = (server: ReturnType<typeof localServer>, call: number): string =>
  String(server.mock.calls[call]?.[1]?.body ?? '')

const tick = (ms = 20): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('organizing a conversation — only the machine-local model, never a knock', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('with no machine-local provider: no call, no record, not even a read — attended or passive', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    for (const provider of m.registry.all()) m.registry.unregister(provider.id)
    const refused = vi.fn(async () => { throw new TypeError('refused') })
    vi.stubGlobal('fetch', refused)
    store.opened.length = 0

    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(await m.route.drainRouteFlows()).toEqual({ organized: 0, behind: 0, stopped: 'gate' })
    await tick()
    expect(refused).not.toHaveBeenCalled()
    expect(store.opened, 'the gate runs before a single read').toEqual([])
    expect(store.counts.optimizationLists).toBe(0)
    expect(store.pools.get(FLOWS_MEANING)).toBeUndefined()
  })

  it('a local provider known but NOT awake: no call and no probe — in a state where the obvious gate WOULD knock', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const local = m.registry.get('local')!
    // A server answered here once: an unattended read of localModelServerUp
    // now knocks (worthKnocking), which is exactly what the gate must not do.
    localStorage.setItem('hc:llm:local:answered', '1')
    const knock = vi.fn(async () => { throw new TypeError('connection refused') })
    vi.stubGlobal('fetch', knock)
    store.opened.length = 0

    expect(m.liveness.localServerReport(local).state).toBe('unknown')
    expect(await m.route.awakeLocalLabeller()).toBeNull()
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect((await m.route.drainRouteFlows()).stopped).toBe('gate')
    await tick()
    expect(knock, 'no probe, no call: the port was never touched').not.toHaveBeenCalled()
    expect(store.opened).toEqual([])
    expect(store.counts.optimizationLists).toBe(0)

    // THE CONTROL — the same state through localModelServerUp does knock.
    // That is why the gate reads localServerReport instead.
    expect(m.liveness.localModelServerUp(local)).toBe(false)
    await vi.waitFor(() => expect(knock).toHaveBeenCalled())
  })

  it('a server that answered with no model is not awake either', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const empty = vi.fn(async (url: string) => {
      if (url === MODELS_URL) return answered({ data: [] })
      throw new TypeError(`refused: ${url}`)
    })
    vi.stubGlobal('fetch', empty)
    expect((await m.liveness.checkLocalServer(m.registry.get('local')!)).state).toBe('empty')
    empty.mockClear()
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    await tick()
    expect(empty).not.toHaveBeenCalled()
  })

  it('an awake local model organizes the conversation once, silently, into its one slot, and the route reads it back', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const sigs = await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    const wrote = vi.fn()
    const changed = vi.fn()
    const offs = [m.core.EffectBus.on('content:wrote', wrote), m.core.EffectBus.on('chat:route-flow-changed', changed)]
    wrote.mockClear(); changed.mockClear()
    const minted = store.minted.length

    try {
      expect(await m.route.organizeRoute(CONVO)).toBe(1)

      // Only one completion, on the local server — no probe rode along.
      expect(server.mock.calls.map(([url]) => url)).toEqual([CHAT_URL])
      const body = JSON.parse(bodyOf(server, 0)) as { model: string }
      expect(body.model).toBe('qwen2.5-coder:7b')
      const wire = bodyOf(server, 0)
      expect(wire).toContain('RATIONAL order')
      expect(wire).toContain('[0] participant: Lay out the site')
      expect(wire).toContain('decided: How many pages? → Several')
      expect(wire).not.toContain('hypercomb-question')

      // SILENT: no resource minted, so no content:wrote for a host to pick up.
      expect(store.minted.length).toBe(minted)
      expect(wrote).not.toHaveBeenCalled()
      expect(changed).toHaveBeenCalledTimes(1)
      expect(changed).toHaveBeenCalledWith({ convoId: CONVO })

      // ONE slot: the pool holds one sub-bucket for the conversation, and it
      // holds one document.
      const flows = store.pools.get(FLOWS_MEANING)!
      expect(flows.files.size).toBe(0)
      expect(flows.dirs.size).toBe(1)
      const slot = await slotOf(store)
      expect(slot?.files.size).toBe(1)
      expect(recordIn(slot)).toEqual({
        kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId: CONVO,
        upToTurnCount: 4, upToTurnSig: sigs[3], at: expect.any(Number),
        nodes: [
          { id: 'site', title: 'Lay out the site', detail: 'Chose a structure for the pages.', turns: [0, 1, 2, 3], state: 'done' },
          { id: 'pages', parent: 'site', title: 'Choose how many pages', turns: [1, 2], state: 'decided' },
        ],
      })
      const route = await m.route.readRoute(CONVO)
      expect(route.flow?.upToTurnCount).toBe(4)
      expect(route.flow?.nodes.map(n => [n.id, n.parent])).toEqual([['site', undefined], ['pages', 'site']])

      // Nothing closed beyond it: a second pass calls nothing, announces nothing.
      expect(await m.route.organizeRoute(CONVO)).toBe(0)
      expect((await m.route.drainRouteFlows()).organized).toBe(0)
      expect(server).toHaveBeenCalledTimes(1)
      expect(changed).toHaveBeenCalledTimes(1)
    } finally {
      for (const off of offs) off()
    }
  })

  it('re-derives in place when a new exchange closes — the previous flow in the prompt, still one file', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    const firstFile = [...(await slotOf(store))!.files.keys()][0]

    await seedTurn(store, pool, 'user', 'Add a contact page', OLD_AT + 500)
    const last = await seedTurn(store, pool, 'assistant', 'Added.', OLD_AT + 600)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)

    expect(server).toHaveBeenCalledTimes(2)
    const update = bodyOf(server, 1)
    expect(update).toContain('PREVIOUS WORKFLOW (organizes turns 0–3):')
    expect(update).toContain('Choose how many pages')
    expect(update).toContain('NEW TURNS 4–5')
    expect(update).toContain('[4] participant: Add a contact page')
    expect(update).toContain('UPDATE it')

    const slot = await slotOf(store)
    expect(slot?.files.size, 'the slot is recycled, not appended to').toBe(1)
    expect([...slot!.files.keys()][0]).not.toBe(firstFile)
    expect(recordIn(slot)).toMatchObject({ upToTurnCount: 6, upToTurnSig: last })
    expect(store.pools.get(FLOWS_MEANING)!.dirs.size).toBe(1)
  })

  it('a record at another version, a corrupt one, or one about another history reads as absent and is minted again', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    const file = [...(await slotOf(store))!.files.values()][0]!
    const record = JSON.parse(new TextDecoder().decode(file.bytes)) as { v: number; upToTurnSig: string }

    file.bytes = new TextEncoder().encode(JSON.stringify({ ...record, v: record.v + 1 }))
    expect((await m.route.readRoute(CONVO)).flow).toBeUndefined()
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(bodyOf(server, 1)).not.toContain('PREVIOUS WORKFLOW')

    const again = [...(await slotOf(store))!.files.values()][0]!
    again.bytes = new TextEncoder().encode(JSON.stringify({ ...record, upToTurnSig: SIG('f') }))
    expect((await m.route.readRoute(CONVO)).flow).toBeUndefined()
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(bodyOf(server, 2), 'a flow about another history is not updated from').not.toContain('PREVIOUS WORKFLOW')

    const third = [...(await slotOf(store))!.files.values()][0]!
    third.bytes = new TextEncoder().encode('{not json')
    expect((await m.route.readRoute(CONVO)).flow).toBeUndefined()
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(server).toHaveBeenCalledTimes(3 + 1)
    expect((await slotOf(store))?.files.size).toBe(1)
  })

  it('leaves the last exchange alone while it is recent, outstanding, live or waited on', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await seedTurn(store, pool, 'user', 'Lay out the site', OLD_AT + 100)
    await seedTurn(store, pool, 'assistant', QUESTION_REPLY, OLD_AT + 200)
    await seedTurn(store, pool, 'user', 'Several', OLD_AT + 300)
    await seedTurn(store, pool, 'assistant', 'Several pages it is.', OLD_AT + 400)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)

    // An ask outstanding for this conversation holds its last exchange open.
    store.optimizations.set(SIG('9'), { kind: 'ask', payload: { mode: 'chat', convoId: CONVO } })
    store.optimizations.set(SIG('8'), { kind: 'ask', payload: { mode: 'chat', convoId: 'chat:tile:/elsewhere' } })
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(recordIn(await slotOf(store))).toMatchObject({ upToTurnCount: 2 })
    expect(bodyOf(server, 0)).not.toContain('[2] ')

    // The shell's own wait and live run hold it too.
    store.optimizations.clear()
    expect(await m.route.organizeRoute(CONVO, 'ask:' + '7'.repeat(32))).toBe(0)
    expect(await m.route.organizeRoute(CONVO, undefined, true)).toBe(0)
    expect(server).toHaveBeenCalledTimes(1)

    // Nothing outstanding and long quiet: now it closes.
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(recordIn(await slotOf(store))).toMatchObject({ upToTurnCount: 4 })

    // A reply seconds old is not closed.
    await seedTurn(store, pool, 'user', 'And a blog?', Date.now() - 4_000)
    await seedTurn(store, pool, 'assistant', 'Yes.', Date.now() - 3_000)
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(server).toHaveBeenCalledTimes(2)
  })

  it('an answer it cannot organize writes nothing and is not asked for again soon', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer(() => completion('I would group these into two phases.'))
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(server, 'backed off for the same history').toHaveBeenCalledTimes(1)
    expect(await slotOf(store)).toBeUndefined()
  })

  it('reads an answer wrapped in reasoning and a fence', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer(() => completion(`<think>group by the site</think>\n\`\`\`json\n${FLOW_ANSWER}\n\`\`\``))
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect((recordIn(await slotOf(store))?.['nodes'] as unknown[])).toHaveLength(2)
  })

  it('names the local provider explicitly and never falls back — a refused call writes nothing and reaches no other vendor', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const OTHER = 'https://elsewhere.example.test/v1/chat/completions'
    m.registry.register({
      id: 'elsewhere', label: 'Elsewhere', vendor: 'local', transport: 'browser-http',
      endpoint: 'https://elsewhere.example.test', requiresKey: false,
      models: [{ name: 'elsewhere', id: 'elsewhere-model', tier: 'fast' }], defaultModel: 'elsewhere-model',
      docsUrl: 'https://example.test',
      toRequest: () => ({ url: OTHER, init: { method: 'POST' } }),
      fromResponse: () => ({ text: FLOW_ANSWER, stopReason: 'stop', inputTokens: 1, outputTokens: 1, model: 'elsewhere-model' }),
    })
    const server = localServer(() => { throw new TypeError('connection refused') })
    await wake(m, server)

    // The resolver hands back the named provider or throws; an explicit call
    // has exactly one candidate.
    expect(m.dispatch.resolveProvider({ providerId: 'local' }).id).toBe('local')
    expect(m.dispatch.routeCandidates({ providerId: 'local' }).map(p => p.id)).toEqual(['local'])
    expect(() => m.dispatch.resolveProvider({ providerId: 'nobody' })).toThrow()

    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    const urls = server.mock.calls.map(([url]) => url)
    expect(urls.filter(url => url === CHAT_URL), 'one attempt').toHaveLength(1)
    expect(urls).not.toContain(OTHER)
    expect(await slotOf(store)).toBeUndefined()
  })

  it('a "local" provider pointed off this machine, or switched off, is not a labeller', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    expect((await m.route.awakeLocalLabeller())?.id).toBe('local')

    localStorage.setItem(m.local.LOCAL_HOST_STORAGE_KEY, 'https://models.example.test')
    expect(await m.route.awakeLocalLabeller()).toBeNull()
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    localStorage.removeItem(m.local.LOCAL_HOST_STORAGE_KEY)

    m.activation.setEnabled('local', false)
    expect(await m.route.awakeLocalLabeller()).toBeNull()
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(server).not.toHaveBeenCalled()
  })
})

describe('the passive drain — as many conversations as it can reach', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  /** Six conversations nobody has opened: live and archived, old and new, and
   *  one whose last exchange is seconds old. */
  const seedSix = async (store: ReturnType<typeof makeStore>, pool: MockDir, thread: ThreadModule): Promise<void> => {
    const at = (minutesAgo: number): number => Date.now() - minutesAgo * 60_000
    await twoExchanges(store, pool, 'chat:tile:/archived-older', at(50), 'ARCHIVED-OLDER question')
    await twoExchanges(store, pool, 'chat:tile:/live-older', at(40), 'LIVE-OLDER question')
    await twoExchanges(store, pool, 'chat:tile:/archived-newer', at(30), 'ARCHIVED-NEWER question')
    await twoExchanges(store, pool, 'chat:tile:/live-newer', at(20), 'LIVE-NEWER question')
    // Recent: its first exchange is closed by the second, which is seconds old.
    await seedTurn(store, pool, 'user', 'RECENT first question', at(30), 'chat:tile:/recent')
    await seedTurn(store, pool, 'assistant', 'An answer.', at(29), 'chat:tile:/recent')
    await seedTurn(store, pool, 'user', 'RECENT second question', Date.now() - 6_000, 'chat:tile:/recent')
    await seedTurn(store, pool, 'assistant', 'RECENT second answer', Date.now() - 5_000, 'chat:tile:/recent')
    // Too fresh to hold anything closed at all.
    await seedTurn(store, pool, 'user', 'FRESH question', Date.now() - 3_000, 'chat:tile:/fresh')
    await seedTurn(store, pool, 'assistant', 'FRESH answer', Date.now() - 2_000, 'chat:tile:/fresh')
    await thread.setConversationArchived('chat:tile:/archived-older', true)
    await thread.setConversationArchived('chat:tile:/archived-newer', true)
  }

  const whoWasAsked = (server: ReturnType<typeof localServer>): string[] =>
    server.mock.calls
      .filter(([url]) => url === CHAT_URL)
      .map(([, init]) => /(ARCHIVED-OLDER|LIVE-OLDER|ARCHIVED-NEWER|LIVE-NEWER|RECENT|FRESH)/.exec(String(init?.body ?? ''))?.[1] ?? '?')

  it('visits live threads newest first, then archived, and leaves a recent last exchange alone', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    const server = localServer()
    await wake(m, server)

    const pass = await m.route.drainRouteFlows({ limit: 10 })
    expect(whoWasAsked(server)).toEqual(['RECENT', 'LIVE-NEWER', 'LIVE-OLDER', 'ARCHIVED-NEWER', 'ARCHIVED-OLDER'])
    expect(pass.organized).toBe(5)
    expect(pass.stopped).toBeUndefined()
    // The recent thread's flow stops before its quiet-less last exchange…
    expect(recordIn(await slotOf(store, 'chat:tile:/recent'))).toMatchObject({ upToTurnCount: 2 })
    expect(bodyOf(server, 0)).not.toContain('RECENT second question')
    // …and says when that exchange will close.
    expect(pass.dueIn).toBeGreaterThan(0)
    expect(pass.dueIn).toBeLessThanOrEqual(ROUTE_FLOW_IDLE_MS)
    expect(await slotOf(store, 'chat:tile:/fresh')).toBeUndefined()
    // One slot each.
    expect(store.pools.get(FLOWS_MEANING)!.dirs.size).toBe(5)
  })

  it('stops starting conversations at its budget and picks up where it left off', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    const server = localServer()
    await wake(m, server)

    expect(await m.route.drainRouteFlows({ limit: 2 })).toMatchObject({ organized: 2, stopped: 'budget' })
    expect(whoWasAsked(server)).toEqual(['RECENT', 'LIVE-NEWER'])
    expect(await m.route.drainRouteFlows({ limit: 2 })).toMatchObject({ organized: 2, stopped: 'budget' })
    expect(await m.route.drainRouteFlows({ limit: 2 })).toMatchObject({ organized: 1 })
    expect(whoWasAsked(server)).toEqual(['RECENT', 'LIVE-NEWER', 'LIVE-OLDER', 'ARCHIVED-NEWER', 'ARCHIVED-OLDER'])

    // A time budget stops it too.
    let clock = Date.now()
    const slow = await m.route.drainRouteFlows({ now: () => (clock += 60_000), budgetMs: 90_000 })
    expect(slow.stopped).toBe('budget')
  })

  it('re-reads the gate between conversations — a model gone mid-pass ends it with nothing more read or called', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    const server = localServer(() => {
      // The participant switches the local tier off while the first answer
      // is on its way.
      m.activation.setEnabled('local', false)
      return completion(FLOW_ANSWER)
    })
    await wake(m, server)

    const pass = await m.route.drainRouteFlows({ limit: 10 })
    expect(pass).toMatchObject({ organized: 1, stopped: 'gate' })
    expect(server.mock.calls.filter(([url]) => url === CHAT_URL)).toHaveLength(1)
    expect(store.pools.get(FLOWS_MEANING)!.dirs.size).toBe(1)
  })

  it('never mints the same flow twice — the attended call and the drain share one guard', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const server = localServer(async () => { await held; return completion(FLOW_ANSWER) })
    await wake(m, server)

    const attended = m.route.organizeRoute(CONVO)
    await vi.waitFor(() => expect(server).toHaveBeenCalledTimes(1))
    expect(await m.route.drainRouteFlows(), 'the drain sees the conversation busy').toEqual({ organized: 0, behind: 1 })
    release()
    expect(await attended).toBe(1)
    expect(await m.route.drainRouteFlows()).toEqual({ organized: 0, behind: 0 })
    expect(server).toHaveBeenCalledTimes(1)
    expect((await slotOf(store))?.files.size).toBe(1)
  })

  it('a refused call ends the pass as a fault', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    const server = localServer(() => { throw new TypeError('connection refused') })
    await wake(m, server)
    expect(await m.route.drainRouteFlows({ limit: 10 })).toMatchObject({ organized: 0, stopped: 'fault' })
    expect(server.mock.calls.filter(([url]) => url === CHAT_URL)).toHaveLength(1)
  })
})

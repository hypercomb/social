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
  buildFlowTree,
  cardKey,
  checkFlowSession,
  checkFlowSummary,
  checkFlowTitle,
  closedFlowEnd,
  deriveRoute,
  extractRouteFlow,
  flowIsBehind,
  flowMatches,
  IN_PROGRESS_MS,
  parseFlowRecord,
  planFlowWindow,
  ROUTE_FLOW_CARD_VERSION,
  ROUTE_FLOW_IDLE_MS,
  ROUTE_FLOW_SESSION_VERSION,
  ROUTE_FLOW_MAX_NODES,
  ROUTE_FLOW_VERSION,
  routeExchanges,
  routeFlowCardPrompt,
  routeFlowSessionInputs,
  routeFlowStructurePrompt,
  sessionDue,
  sessionKey,
  type RouteFlowExchange,
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
    expect(await route.readRoute('chat:never')).toMatchObject({ rows: [], unfinished: [] })
    expect(await route.readRoute('')).toMatchObject({ rows: [], unfinished: [] })

    await thread.appendTurn(CONVO, 'user', 'hello')
    expect((await bucketOf(pool, CONVO))!.dirs.size, 'no ledger was minted by reading').toBe(0)
    // No work, and no flow: the exchange is a dormant stage. Reading never
    // created the flows pool.
    const noLedger = await route.readRoute(CONVO)
    expect(noLedger).toMatchObject({ rows: [], unfinished: [] })
    expect(noLedger.flow).toBeUndefined()
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

describe('extracting a flow answer', () => {
  it('extracts the JSON value, not the prose — a think block, a fence, prose around it, a trailing comma', () => {
    expect(extractRouteFlow('ok ```\n[1, 2]\n``` done')).toEqual([1, 2])
    expect(extractRouteFlow('<think>group them</think>\n```json\n{"exchanges":[{"e":1,},]}\n```')).toEqual({ exchanges: [{ e: 1 }] })
    expect(extractRouteFlow('Here it is:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 })
    expect(extractRouteFlow('```json\n{"a":1}')).toEqual({ a: 1 })
    expect(extractRouteFlow('nothing here')).toBeNull()
    expect(extractRouteFlow('<think>maybe {"a":1}')).toBeNull()
    expect(extractRouteFlow('')).toBeNull()
  })
})

// ── stage 1: the model tags exchanges, code builds the tree ─────────────

const entry = (e: number, task: string, extra: Partial<{ title: string; from: string; state: string; drops: string }> = {}) =>
  ({ e, task, title: '', from: '', state: 'open', drops: '', ...extra })
const answer = (entries: unknown[]): string => JSON.stringify({ exchanges: entries })
/** Exchanges whose words never meet, so the re-home never fires unless a test wants it to. */
const plain = (count: number): Pick<RouteFlowExchange, 'participant' | 'replies'>[] =>
  Array.from({ length: count }, (_, k) => ({ participant: `topic${k + 1}`, replies: [`reply${k + 1}`] }))
const fresh = (count: number) => ({ previous: null, from: 0, upto: count, texts: plain(count) })

describe('buildFlowTree — the model tags exchanges, code builds the tree', () => {
  it('the Lisbon example: a reuse keeps the id, a part and a detour branch, a reversal drops its target — in preorder', () => {
    const tree = buildFlowTree(answer([
      entry(1, 't1', { title: 'Plan a week in Lisbon' }),
      entry(2, 't2', { title: 'Book the morning flight to Lisbon', from: 't1', state: 'done' }),
      entry(3, 't3', { title: 'Check passport expiry for the flight', from: 't2', state: 'done' }),
      entry(4, 't2', { state: 'done' }),
      entry(5, 't4', { title: 'Book the Alfama guesthouse', from: 't1', state: 'decided' }),
      entry(6, 't5', { title: 'Book a hotel in Baixa instead', from: 't1', state: 'done', drops: 't4' }),
      entry(7, 't5', { state: 'done' }),
    ]), fresh(7))!
    expect(tree.exchanges).toEqual(['t1', 't2', 't3', 't2', 't4', 't5', 't5'])
    expect(tree.nodes.map(n => [n.id, n.parent, n.state, n.title])).toEqual([
      ['t1', undefined, 'open', 'Plan a week in Lisbon'],
      ['t2', 't1', 'done', 'Book the morning flight to Lisbon'],
      ['t3', 't2', 'done', 'Check passport expiry for the flight'],
      ['t4', 't1', 'dropped', 'Book the Alfama guesthouse'],
      ['t5', 't1', 'done', 'Book a hotel in Baixa instead'],
    ])
  })

  it("the model's ids are aliases: a first-seen t7 is canonical t1, and the alias is reused within the window", () => {
    const tree = buildFlowTree(answer([entry(1, 't7', { title: 'Plan the garden beds' }), entry(2, 't7', { state: 'done' })]), fresh(2))!
    expect(tree.exchanges).toEqual(['t1', 't1'])
    expect(tree.nodes.map(n => [n.id, n.state])).toEqual([['t1', 'done']])
  })

  it('a missing entry continues the previous task, and an exchange 1 with nothing usable is an untitled task', () => {
    const tree = buildFlowTree(answer([entry(1, 't1', { title: 'Plan the site' }), entry(3, 't1')]), fresh(3))!
    expect(tree.exchanges).toEqual(['t1', 't1', 't1'])
    const untitled = buildFlowTree(answer([entry(1, 'a'), entry(2, 'a')]), fresh(2))!
    expect(untitled.nodes).toEqual([{ id: 't1', title: '', state: 'open' }])
    expect(untitled.exchanges).toEqual(['t1', 't1'])
  })

  it('deeper than three levels re-hangs on the ancestor at depth two', () => {
    const tree = buildFlowTree(answer([
      entry(1, 't1', { title: 'Build the landing page' }),
      entry(2, 't2', { title: 'Add the gallery section', from: 't1' }),
      entry(3, 't3', { title: 'Size the gallery thumbnails', from: 't2' }),
      entry(4, 't4', { title: 'Pick the thumbnail border', from: 't3' }),
    ]), fresh(4))!
    expect(tree.nodes.map(n => [n.id, n.parent])).toEqual([['t1', undefined], ['t2', 't1'], ['t3', 't2'], ['t4', 't2']])
  })

  it('a drop marks an earlier task dropped — never itself or its own ancestor', () => {
    const tree = buildFlowTree(answer([
      entry(1, 't1', { title: 'Plan the site' }),
      entry(2, 't2', { title: 'Write the about page', from: 't1', drops: 't1' }),
      entry(3, 't3', { title: 'Write the contact page', from: 't1', drops: 't2' }),
      entry(4, 't3', { drops: 't3' }),
    ]), fresh(4))!
    expect(tree.nodes.map(n => [n.id, n.state])).toEqual([['t1', 'open'], ['t2', 'dropped'], ['t3', 'open']])
  })

  it('settled assignments never change; a released node not issued again goes, and its number is issued again', () => {
    const previous = {
      nodes: [{ id: 't1', title: 'Plan the site', state: 'open' as const }, { id: 't2', title: 'Fix the header', state: 'open' as const, parent: 't1' }],
      exchanges: ['t1', 't2', 't2'],
    }
    const tree = buildFlowTree(answer([entry(2, 't1'), entry(3, 'new', { title: 'Add a footer', from: 't1' })]),
      { previous, from: 1, upto: 3, texts: plain(3) })!
    expect(tree.exchanges).toEqual(['t1', 't1', 't2'])
    expect(tree.nodes.map(n => [n.id, n.title, n.parent])).toEqual([['t1', 'Plan the site', undefined], ['t2', 'Add a footer', 't1']])
  })

  it('fewer than half the window answered is unusable; entries outside the window are ignored', () => {
    expect(buildFlowTree(answer([entry(1, 't1', { title: 'Plan the site' })]), fresh(4))).toBeNull()
    expect(buildFlowTree('I would group these into two phases.', fresh(2))).toBeNull()
    const outside = buildFlowTree(answer([entry(9, 't1', { title: 'Plan the site' }), entry(1, 't1', { title: 'Plan the site' }), entry(2, 't1')]), fresh(2))!
    expect(outside.exchanges).toEqual(['t1', 't1'])
  })

  it(`node ${ROUTE_FLOW_MAX_NODES + 1} folds into the task before it`, () => {
    const many = Array.from({ length: ROUTE_FLOW_MAX_NODES + 1 }, (_, i) => entry(i + 1, `n${i + 1}`, { title: `Build section ${i + 1}` }))
    const tree = buildFlowTree(answer(many), fresh(ROUTE_FLOW_MAX_NODES + 1))!
    expect(tree.nodes).toHaveLength(ROUTE_FLOW_MAX_NODES)
    expect(tree.exchanges[ROUTE_FLOW_MAX_NODES]).toBe(`t${ROUTE_FLOW_MAX_NODES}`)
  })

  it('re-homes by words: the test for the fold anchoring goes to the node whose covered text says fold and anchor', () => {
    const texts = [
      { participant: 'The sidebar jumps when folding a branch', replies: ['Anchored the fold so the sidebar stays put.'] },
      { participant: 'Rename the project to Hypercomb', replies: ['Renamed it everywhere.'] },
      { participant: 'Write a test for the fold anchoring from earlier.', replies: ['Wrote the test.'] },
    ]
    const tree = buildFlowTree(answer([
      entry(1, 't1', { title: 'Fix sidebar jump' }),
      entry(2, 't2', { title: 'Rename the project' }),
      entry(3, 't2'),
    ]), { previous: null, from: 0, upto: 3, texts })!
    expect(tree.exchanges).toEqual(['t1', 't2', 't1'])
  })
})

describe('parseFlowRecord v2 — what a stored record must be', () => {
  const CARD = {
    key: SIG('c'), cv: ROUTE_FLOW_CARD_VERSION, goal: 'Lay out the site pages.', done: 'Chose several pages for the site.',
    outcome: 'Several pages it is.', exchanges: 1, model: 'qwen', at: 5,
  }
  const RECORD = {
    kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId: CONVO, upToTurnCount: 4, upToTurnSig: SIG('d'), at: 1, model: 'qwen',
    exchanges: ['t1', 't2'], settled: 0, pending: 0,
    nodes: [
      { id: 't1', title: 'Lay out the site', state: 'open', named: true, card: CARD },
      { id: 't2', title: 'Choose how many pages', state: 'decided', parent: 't1', card: { ...CARD, key: SIG('e') } },
    ],
  }

  it('reads a whole record back, recomputing pending', () => {
    expect(parseFlowRecord({ ...RECORD, pending: 7 }, CONVO)).toEqual(RECORD)
  })

  it('a v1 record, another conversation, no sig, or an exchange naming no node reads as absent', () => {
    expect(parseFlowRecord({ ...RECORD, v: 1 }, CONVO)).toBeNull()
    expect(parseFlowRecord(RECORD, 'chat:tile:/elsewhere')).toBeNull()
    expect(parseFlowRecord({ ...RECORD, upToTurnSig: '' }, CONVO)).toBeNull()
    expect(parseFlowRecord({ ...RECORD, exchanges: ['t1', 't9'] }, CONVO)).toBeNull()
    expect(parseFlowRecord('junk', CONVO)).toBeNull()
  })

  it('a bad card removes the card only; a card at an older cv reads stale; both count as pending', () => {
    const bad = parseFlowRecord({ ...RECORD, nodes: [{ ...RECORD.nodes[0], card: { ...CARD, key: 'not-a-sig' } }, RECORD.nodes[1]] }, CONVO)!
    expect(bad.nodes[0]).toEqual({ id: 't1', title: 'Lay out the site', named: true, state: 'open' })
    expect(bad.pending).toBe(1)
    const old = parseFlowRecord({ ...RECORD, nodes: [RECORD.nodes[0], { ...RECORD.nodes[1], card: { ...CARD, key: SIG('e'), cv: 0 } }] }, CONVO)!
    expect(old.nodes[1]!.card).toMatchObject({ cv: 0, stale: true })
    expect(old.pending).toBe(1)
  })

  it('repairs settled, states, parents and depth', () => {
    const seven = { ...RECORD, exchanges: ['t1', 't2', 't1', 't1', 't1', 't1', 't1'] }
    expect(parseFlowRecord({ ...seven, settled: 99 }, CONVO)!.settled).toBe(2)
    expect(parseFlowRecord({ ...seven, settled: -1 }, CONVO)!.settled).toBe(2)
    expect(parseFlowRecord({ ...seven, settled: 3 }, CONVO)!.settled).toBe(3)
    const repaired = parseFlowRecord({
      ...RECORD, exchanges: ['t1', 't2', 't3', 't4', 't5'], nodes: [
        { id: 't1', title: 'Plan the site', state: 'whatever' },
        { id: 't2', title: 'Write a part', state: 'open', parent: 't9' },
        { id: 't3', title: 'Go deeper', state: 'open', parent: 't2' },
        { id: 't4', title: 'Deeper still', state: 'open', parent: 't3' },
        { id: 't5', title: 'Too deep', state: 'open', parent: 't4' },
      ],
    }, CONVO)!
    expect(repaired.nodes.map(n => [n.id, n.state, n.parent])).toEqual([
      ['t1', 'done', undefined], ['t2', 'open', undefined], ['t3', 'open', 't2'], ['t4', 'open', 't3'], ['t5', 'open', 't3'],
    ])
    expect(repaired.pending).toBe(5)
  })
})

const QUESTION_REPLY = 'Two ways.\n\n```hypercomb-question\n{"prompt":"How many pages?","options":["One","Several"]}\n```'

describe('what the model is given', () => {
  const exchange = (participant: string, replies: string[], extra: Partial<RouteFlowExchange> = {}): RouteFlowExchange =>
    ({ participant, replies, attempts: [], decided: [], ...extra })

  it('a fresh window numbers every exchange, with its work and decisions, and asks for all of it', () => {
    const prompt = routeFlowStructurePrompt({
      exchanges: [exchange('Lay it out', ['Two ways.'], {
        attempts: [{ verb: 'note-add', cell: 'site', outcome: 'ok' }, { verb: 'update', cell: 'gone', outcome: 'failed' }],
        decided: ['How many pages? → Several'],
      }), exchange('Several', ['Several pages it is.'])],
      from: 0, upto: 2, tasks: [], assigned: [],
    })
    expect(prompt).toContain('EXCHANGES E1–E2:')
    expect(prompt).toContain('E1:\n  participant: Lay it out\n  reply: Two ways.\n  work: note-add site ok · update gone FAILED\n  decided: How many pages? → Several')
    expect(prompt).toContain('E2:\n  participant: Several\n  reply: Several pages it is.')
    expect(prompt).toContain('Map every exchange, E1 to E2.')
    expect(prompt).not.toContain('TASKS SO FAR')
  })

  it('a later window lists the tasks so far, repeats the last mapped exchange, and asks for the window only', () => {
    const prompt = routeFlowStructurePrompt({
      exchanges: [exchange('Lay it out', ['Two ways.']), exchange('Several', ['Several pages it is.']), exchange('Add a contact page', ['Added.'])],
      from: 1, upto: 3,
      tasks: [{ id: 't1', title: 'Lay out the site', state: 'open' }, { id: 't3', title: 'Choose how many pages', state: 'decided', parent: 't1' }],
      assigned: ['t1'],
    })
    expect(prompt).toContain('TASKS SO FAR (E1–E1 are already mapped):\n- t1 [open]: Lay out the site\n- t3 (branch of t1) [decided]: Choose how many pages')
    expect(prompt).toContain('THE LAST MAPPED EXCHANGE, for context:\nE1:\n  participant: Lay it out\n  reply: Two ways.\n  → t1')
    expect(prompt).toContain('EXCHANGES E2–E3:')
    expect(prompt).toContain('E3:\n  participant: Add a contact page')
    expect(prompt).toContain('Map only E2 to E3. Reuse an id above when an exchange continues or returns to that task; the next new id is t4.')
  })

  it('a long reply keeps its head and tail, the middle replies fold to a count, and work past six folds too', () => {
    const long = 'x'.repeat(500) + ' the end'
    const prompt = routeFlowStructurePrompt({
      exchanges: [exchange('Go', [long, 'second', 'third', 'fourth'], {
        attempts: Array.from({ length: 8 }, (_, i) => ({ verb: `verb${i}`, cell: `c${i}`, outcome: 'ok' as const })),
      })],
      from: 0, upto: 1, tasks: [], assigned: [],
    })
    expect(prompt).toContain(`  reply: ${'x'.repeat(120)} … ${long.slice(-240)}\n  (+2 more replies)\n  reply: fourth`)
    expect(prompt).toContain('  work: verb0 c0 ok · verb1 c1 ok · verb2 c2 ok · verb3 c3 ok · verb4 c4 ok · verb5 c5 ok · +2 more')
    expect(prompt).not.toContain('second')
  })

  it('the window: nothing new means no call; the provisional five are mapped again with the new ones', () => {
    const seven = Array.from({ length: 7 }, (_, k) => exchange(`topic${k + 1}`, [`reply${k + 1}`]))
    const previous = { nodes: [{ id: 't1', title: 'Plan the beds', state: 'open' as const }], exchanges: Array<string>(7).fill('t1'), settled: 2 }
    expect(planFlowWindow(seven, previous)).toBeNull()
    const nine = [...seven, exchange('topic8', ['reply8']), exchange('topic9', ['reply9'])]
    const window = planFlowWindow(nine, previous)!
    expect([window.from, window.upto, window.tight]).toEqual([2, 9, false])
    expect(window.prompt).toContain('TASKS SO FAR (E1–E2 are already mapped)')
    expect(window.prompt).toContain('EXCHANGES E3–E9:')
    expect(planFlowWindow(nine, null)).toMatchObject({ from: 0, upto: 9 })
  })

  it('a card is asked with the status, the name, its part-of, its branches and the numbered messages', () => {
    const prompt = routeFlowCardPrompt({
      state: 'open', title: 'Lay out the site', partOf: 'Build the studio site',
      branches: [{ title: 'Choose how many pages', state: 'decided', outcome: 'Several pages it is.' }, { title: 'Pick a colour', state: 'open' }],
      messages: [
        { index: 0, role: 'user', text: 'Lay it out', work: [{ verb: 'note-add', cell: 'site', outcome: 'ok' }] },
        { index: 1, role: 'assistant', text: 'Two ways.', decided: 'How many pages? → Several' },
      ],
    })
    expect(prompt).toContain('STATUS: open\nWORKING NAME: Lay out the site\nPART OF: Build the studio site')
    expect(prompt).toContain('ITS BRANCHES (each already has its own card):\n- Choose how many pages [decided]: Several pages it is.\n- Pick a colour [open]')
    expect(prompt).toContain('MESSAGES:\n[1] participant: Lay it out\n    work: note-add site ok\n[2] reply: Two ways.\n    decided: How many pages? → Several')
    expect(prompt.endsWith('Write the card as JSON.')).toBe(true)
    expect(routeFlowCardPrompt({ state: 'done', title: 'Named', named: true, branches: [], messages: [] })).toContain('CURRENT NAME: Named')
  })
})

describe('the card validators', () => {
  const covered = 'Add the contact section now please\nAdded the contact section with opening hours.'

  it('checkFlowTitle accepts a grounded verb-first title and sentence-cases it the way the conversation writes', () => {
    expect(checkFlowTitle('"Add the contact section."', { covered })).toEqual({ ok: true, title: 'Add the contact section' })
    const shadow = 'The Ollama host is shadowing the port'
    expect(checkFlowTitle('Fix Ollama host Shadowing', { covered: shadow, corpus: shadow })).toEqual({ ok: true, title: 'Fix Ollama host shadowing' })
  })

  it('checkFlowTitle refuses the vague, the long, a question, a role word, an ungrounded title, a copied opening and a branch name', () => {
    const why = (raw: string, context: Parameters<typeof checkFlowTitle>[1] = { covered }): string => {
      const result = checkFlowTitle(raw, context)
      return result.ok ? 'ok' : result.why
    }
    expect(why('Discussion')).toBe('too-short')
    expect(why('Handle the request')).toBe('generic')
    expect(why('Add one two three four five six seven eight')).toBe('too-long')
    expect(why('Assign plots fairly: waitlist or lottery?')).toBe('question')
    expect(why('Help the user with contact')).toBe('role-word')
    expect(why('Tune the hyperdrive')).toBe('ungrounded')
    expect(why('Add the contact section now', { covered, participants: ['Add the contact section now please'] })).toBe('copied')
    expect(why('Add the contact section', { covered, childTitles: ['add the contact section'] })).toBe('names-a-branch')
  })

  it("checkFlowSummary clips, then refuses a short part, a role word, meta talk, a repeat, a copied branch and another step's facts", () => {
    const given = 'MESSAGES: [1] participant: make the gallery thumbnails larger [2] reply: Thumbnails are larger now.'
    const others = 'Added opening hours under the contact form.'
    const good = { goal: 'Make the gallery thumbnails larger.', done: 'Thumbnails were enlarged.', outcome: 'Thumbnails are larger now.' }
    expect(checkFlowSummary(good, { given, others })).toEqual({ ok: true, summary: good })
    const why = (card: Record<string, string>, context: Parameters<typeof checkFlowSummary>[1] = { given, others }): string => {
      const result = checkFlowSummary(card, context)
      return result.ok ? 'ok' : `${result.why}${result.word ? ':' + result.word : ''}`
    }
    expect(why({ ...good, goal: 'Bigger.' })).toBe('short-goal')
    expect(why({ ...good, done: 'The user asked for larger thumbnails.' })).toBe('role-done')
    expect(why({ ...good, outcome: 'This task is finished.' })).toBe('meta-outcome')
    expect(why({ ...good, done: good.goal })).toBe('repeated')
    expect(why({ ...good, outcome: 'Hours went under the contact form.' })).toBe('ungrounded-outcome:hours')
    expect(why(good, { given, others, childCards: [{ done: 'Thumbnails were enlarged.' }] })).toBe('copies-a-branch')
    const long = checkFlowSummary({ ...good, done: 'Enlarged the thumbnails. '.repeat(20) }, { given, others })
    const clipped = long.ok ? long.summary.done.length : -1
    expect(clipped).toBeGreaterThan(0)
    expect(clipped).toBeLessThanOrEqual(280)
  })
})

describe('the session card — a name and where it stands, from the steps', () => {
  const CARD = { key: SIG('c'), cv: ROUTE_FLOW_CARD_VERSION, goal: 'Lay out the site pages.', done: 'Chose several pages for the site.', outcome: 'Several pages it is.', exchanges: 1, model: 'qwen', at: 5 }
  const NODES = [
    { id: 't1', title: 'Lay out the site', state: 'open' as const, card: CARD },
    { id: 't2', title: 'Choose how many pages', state: 'decided' as const, parent: 't1', card: { ...CARD, key: SIG('e') } },
    { id: 't3', title: 'Pick a colour', state: 'open' as const, parent: 't1' },
  ]

  it('asks with the steps in order, branches indented, outcomes where a card is current, and the counts', () => {
    const inputs = routeFlowSessionInputs({ nodes: NODES })
    expect(inputs.prompt).toContain('STEPS, in order (a step under another is a branch of it):\n- [open] Lay out the site: Several pages it is.\n  - [decided] Choose how many pages: Several pages it is.\n  - [open] Pick a colour\n\n0 done, 2 open, 1 decided, 0 dropped.')
    expect(inputs.covered).toContain('Pick a colour')
  })

  it('checks the name like a title and clips where it stands at a sentence', () => {
    const { covered } = routeFlowSessionInputs({ nodes: NODES })
    expect(checkFlowSession({ name: '"Lay out the studio site."', stands: 'Several pages are chosen; the colour is still open.' }, { covered }))
      .toEqual({ ok: true, session: { name: 'Lay out the studio site', stands: 'Several pages are chosen; the colour is still open.' } })
    const why = (card: Record<string, string>): string => { const r = checkFlowSession(card, { covered }); return r.ok ? 'ok' : r.why }
    expect(why({ name: 'Discussion', stands: 'Several pages are chosen.' })).toBe('name rejected (too-short)')
    expect(why({ name: 'Tune the hyperdrive', stands: 'Several pages are chosen.' })).toBe('name rejected (ungrounded)')
    expect(why({ name: 'Lay out the site', stands: 'Done.' })).toBe('short-stands')
    expect(why({ name: 'Lay out the site', stands: 'The user still has to pick a colour.' })).toBe('role-stands')
    expect(why({ name: 'Lay out the site', stands: 'This conversation is nearly finished.' })).toBe('meta-stands')
    const long = checkFlowSession({ name: 'Lay out the site', stands: 'Several pages are chosen. '.repeat(20) }, { covered })
    expect(long.ok ? long.session.stands.length : -1).toBeLessThanOrEqual(200)
  })

  it('is keyed by the steps: due when absent, stale, at an old version or when any step or card changed; never while a card is pending', async () => {
    const key = await sessionKey({ nodes: NODES })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    const session = { key, sv: ROUTE_FLOW_SESSION_VERSION, name: 'Lay out the site', stands: 'Several pages are chosen.', model: 'qwen', at: 1 }
    expect(await sessionDue({ nodes: NODES, pending: 0, session })).toBe(false)
    expect(await sessionDue({ nodes: NODES, pending: 0 })).toBe(true)
    expect(await sessionDue({ nodes: NODES, pending: 0, session: { ...session, stale: true } })).toBe(true)
    expect(await sessionDue({ nodes: NODES, pending: 0, session: { ...session, sv: 0 } })).toBe(true)
    expect(await sessionDue({ nodes: [{ ...NODES[0]!, state: 'done' }, ...NODES.slice(1)], pending: 0, session })).toBe(true)
    expect(await sessionDue({ nodes: NODES, pending: 1, session: { ...session, key: SIG('0') } }), 'a pending card comes first').toBe(false)
  })

  it('parseFlowRecord keeps a valid session card, drops a bad one, and reads an old version as stale', () => {
    const base = {
      kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId: CONVO, upToTurnCount: 4, upToTurnSig: SIG('d'), at: 1, model: 'qwen',
      exchanges: ['t1', 't2'], settled: 0, pending: 0, nodes: NODES.slice(0, 2),
    }
    const session = { key: SIG('a'), sv: ROUTE_FLOW_SESSION_VERSION, name: 'Lay out the site', stands: 'Several pages are chosen.', model: 'qwen', at: 2 }
    expect(parseFlowRecord({ ...base, session }, CONVO)?.session).toEqual(session)
    expect(parseFlowRecord({ ...base, session: { ...session, key: 'nope' } }, CONVO)?.session).toBeUndefined()
    expect(parseFlowRecord({ ...base, session: { ...session, sv: 0 } }, CONVO)?.session).toMatchObject({ sv: 0, stale: true })
    expect(parseFlowRecord({ ...base, nodes: [{ ...NODES[0], card: { ...CARD, kind: 'fix' } }, NODES[1]] }, CONVO)?.nodes[0]?.card?.kind).toBe('fix')
    expect(parseFlowRecord({ ...base, nodes: [{ ...NODES[0], card: { ...CARD, kind: 'party' } }, NODES[1]] }, CONVO)?.nodes[0]?.card?.kind).toBeUndefined()
  })
})

describe('cardKey — a card is keyed by its inputs, never by the model', () => {
  it('is stable for equal inputs and changes with the state, a turn, work, a decision or a branch key', async () => {
    const base = {
      state: 'open' as const, turnSigs: [SIG('a'), SIG('b')],
      work: [{ verb: 'note-add', cell: 'site', outcome: 'ok' as const }],
      decided: [{ prompt: 'How many pages?', chosen: 'Several' }], childKeys: [SIG('c')],
    }
    const key = await cardKey(base)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await cardKey({ ...base })).toBe(key)
    expect(await cardKey({ ...base, state: 'done' })).not.toBe(key)
    expect(await cardKey({ ...base, turnSigs: [SIG('a')] })).not.toBe(key)
    expect(await cardKey({ ...base, work: [] })).not.toBe(key)
    expect(await cardKey({ ...base, decided: [] })).not.toBe(key)
    expect(await cardKey({ ...base, childKeys: [] })).not.toBe(key)
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
/** The model of the participant's last own local chat — the one that organizes. */
const MODEL = 'qwen2.5-coder:7b'
/** An hour ago: every exchange here is long quiet unless a test says not. */
const OLD_AT = Date.now() - 60 * 60_000

const FLOW_STATE = Symbol.for('hypercomb.chat-route.flow-state')
/** The pinned coordination state (lane, guards, back-offs) survives module
 *  reloads on purpose — so every case starts it over. */
const resetFlowState = (): void => { delete (globalThis as Record<symbol, unknown>)[FLOW_STATE] }

const answered = (json: unknown) => ({
  ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json),
})
const completion = (content: string) => answered({
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
})

/** The request as the model reads it: the wire body with its newlines back. */
const asked = (body: string): string => body.replace(/\\n/g, '\n')
const isCardCall = (body: string): boolean => /You write the card for ONE task/.test(body)
const isSessionCall = (body: string): boolean => /You name ONE conversation/.test(body)
const isStructureCall = (body: string): boolean => /EXCHANGES E\d+–E\d+:/.test(asked(body))

/** STAGE 1, as a well-behaved model answers it: exchange 1 opens t1, exchange
 *  2 is a decided branch of it, every later exchange returns to t1. */
const structureAnswer = (body: string): string => {
  const [, from = '1', upto = '1'] = /EXCHANGES E(\d+)–E(\d+):/.exec(asked(body)) ?? []
  const entries: unknown[] = []
  for (let e = Number(from); e <= Number(upto); e++) {
    entries.push(e === 1 ? { e, task: 't1', title: 'Lay out the site', from: '', state: 'open', drops: '' }
      : e === 2 ? { e, task: 't2', title: 'Choose how many pages', from: 't1', state: 'decided', drops: '' }
        : { e, task: 't1', title: '', from: '', state: 'open', drops: '' })
  }
  return JSON.stringify({ exchanges: entries })
}
/** STAGE 2: a card grounded in the node's own first participant message. */
const cardAnswer = (body: string): string => {
  const said = (/\[\d+\] participant: ([^\n]+)/.exec(asked(body))?.[1] ?? 'the work')
    .split(' ').slice(0, 5).join(' ').replace(/[.?!]+$/, '')
  return JSON.stringify({
    title: `Settle ${said}`,
    goal: `Set out to settle ${said}.`,
    done: `Worked through ${said} in the replies given.`,
    outcome: `Ended with ${said} settled.`,
    kind: 'build',
  })
}
/** THE SESSION CARD: a name grounded in the first step's title, and where it stands. */
const sessionAnswer = (body: string): string => {
  const first = /- \[\w+\] Settle ([^:\n]+)/.exec(asked(body))?.[1] ?? 'the work'
  return JSON.stringify({ name: `Finish ${first}`, stands: `Every part of ${first} is settled; nothing is waiting.` })
}
const answerByShape = (body: string): string =>
  isSessionCall(body) ? sessionAnswer(body) : isCardCall(body) ? cardAnswer(body) : structureAnswer(body)

/** A machine-local server as fetch sees it: `/v1/models` names one model,
 *  completions answer through `reply` (by request shape), anything else is refused. */
const localServer = (reply: (body: string) => unknown = body => completion(answerByShape(body))) =>
  vi.fn(async (url: string, init?: { body?: unknown }): Promise<unknown> => {
    if (url === MODELS_URL) return answered({ data: [{ id: MODEL }] })
    if (url === CHAT_URL) return reply(String(init?.body ?? ''))
    throw new TypeError(`refused: ${url}`)
  })
type LocalServer = ReturnType<typeof localServer>

const chatCalls = (server: LocalServer): number => server.mock.calls.filter(([url]) => url === CHAT_URL).length
/** The structure prompts sent, in order, as the model read them. */
const structureCalls = (server: LocalServer): string[] => server.mock.calls
  .filter(([url, init]) => url === CHAT_URL && isStructureCall(String(init?.body ?? '')))
  .map(([, init]) => asked(String(init?.body ?? '')))

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

/** Somebody ELSE's probe found the server awake — the console, a call — and
 *  the participant's last own local chat named the model. The fetch log is
 *  cleared afterwards, so every later call is the flow's. */
const wake = async (m: Flows, server: LocalServer): Promise<void> => {
  vi.stubGlobal('fetch', server)
  localStorage.setItem(m.dispatch.LOCAL_MODEL_STORAGE_KEY, JSON.stringify({ providerId: 'local', model: MODEL, at: Date.now() }))
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

const bodyOf = (server: LocalServer, call: number): string =>
  String(server.mock.calls[call]?.[1]?.body ?? '')

const tick = (ms = 20): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('organizing a conversation — only the machine-local model, never a knock', () => {
  beforeEach(() => { localStorage.clear(); resetFlowState(); localStorage.setItem('hc:llm:orchestrator-provider', 'local') })
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
    expect(await m.route.drainRouteFlows()).toMatchObject({ organized: 0, behind: 0, stopped: 'gate' })
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
    expect(await m.route.awakeOrganizerLabeller(MODEL)).toBeNull()
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

  it('an awake local model organizes the conversation — one structure call, a card per node, silently, into its one slot — and the route reads it back', async () => {
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

      // The structure call, a card per node, then the session card, all on the
      // local server — no probe rode along. Thinking is off and the shape is constrained.
      expect(server.mock.calls.map(([url]) => url)).toEqual([CHAT_URL, CHAT_URL, CHAT_URL, CHAT_URL])
      const body = JSON.parse(bodyOf(server, 0)) as { model: string; reasoning_effort?: string; response_format?: { type?: string } }
      expect(body.model).toBe(MODEL)
      expect(body.reasoning_effort).toBe('none')
      expect(body.response_format?.type).toBe('json_schema')
      const wire = asked(bodyOf(server, 0))
      expect(wire).toContain('You map a conversation onto the TASKS')
      expect(wire).toContain('E1:\n  participant: Lay out the site')
      expect(wire).toContain('decided: How many pages? → Several')
      expect(wire).not.toContain('hypercomb-question')
      const cards = [1, 2].map(call => asked(bodyOf(server, call)))
      expect(cards.every(isCardCall)).toBe(true)
      expect(cards[0], 'post-order: the branch is carded before its parent').toContain('WORKING NAME: Choose how many pages')
      expect(cards[1]).toContain('WORKING NAME: Lay out the site')
      expect(cards[1], "the parent is told its branch's card").toContain('ITS BRANCHES (each already has its own card):\n- Settle Several [decided]: Ended with Several settled.')
      const session = asked(bodyOf(server, 3))
      expect(isSessionCall(session)).toBe(true)
      expect(session).toContain('STEPS, in order (a step under another is a branch of it):\n- [open] Settle Lay out the site: Ended with Lay out the site settled.\n  - [decided] Settle Several: Ended with Several settled.')
      expect(session).toContain('0 done, 1 open, 1 decided, 0 dropped.')

      // SILENT: no resource minted, so no content:wrote for a host to pick up;
      // announced once per write — the structure, then each card.
      expect(store.minted.length).toBe(minted)
      expect(wrote).not.toHaveBeenCalled()
      expect(changed).toHaveBeenCalledTimes(4)
      expect(changed).toHaveBeenLastCalledWith({ convoId: CONVO })

      // ONE slot: the pool holds one sub-bucket for the conversation, and it
      // holds one document.
      const flows = store.pools.get(FLOWS_MEANING)!
      expect(flows.files.size).toBe(0)
      expect(flows.dirs.size).toBe(1)
      const slot = await slotOf(store)
      expect(slot?.files.size).toBe(1)
      expect(recordIn(slot)).toMatchObject({
        kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId: CONVO, model: MODEL,
        upToTurnCount: 4, upToTurnSig: sigs[3], exchanges: ['t1', 't2'], settled: 0, pending: 0,
        nodes: [
          {
            id: 't1', title: 'Settle Lay out the site', named: true, state: 'open',
            card: { cv: ROUTE_FLOW_CARD_VERSION, model: MODEL, exchanges: 1, outcome: 'Ended with Lay out the site settled.', kind: 'build' },
          },
          { id: 't2', parent: 't1', title: 'Settle Several', named: true, state: 'decided', card: { exchanges: 1, kind: 'build' } },
        ],
        session: { sv: ROUTE_FLOW_SESSION_VERSION, name: 'Finish Lay out the site', stands: 'Every part of Lay out the site is settled; nothing is waiting.', model: MODEL },
      })
      const route = await m.route.readRoute(CONVO)
      expect(route.flow?.upToTurnCount).toBe(4)
      expect(route.flow?.nodes.map(n => [n.id, n.parent, n.exchanges, n.turns])).toEqual([['t1', undefined, [1], [0, 1]], ['t2', 't1', [2], [2, 3]]])
      expect(route.flow?.nodes[0]?.card?.outcome).toBe('Ended with Lay out the site settled.')
      expect(route.flow?.nodes[0]?.card?.kind).toBe('build')
      expect(route.flow?.session).toMatchObject({ name: 'Finish Lay out the site', model: MODEL })
      expect(route.flow?.session?.stale).toBeUndefined()
      expect(route.flow?.counts, 'the parent rolls up to done over its settled branch').toEqual({ done: 1, open: 0, decided: 1, dropped: 0 })
      expect(route.organizerState).toBe('awake')

      // Nothing closed beyond it: a second pass calls nothing, announces nothing.
      expect(await m.route.organizeRoute(CONVO)).toBe(0)
      expect((await m.route.drainRouteFlows()).organized).toBe(0)
      expect(chatCalls(server)).toBe(4)
      expect(changed).toHaveBeenCalledTimes(4)
    } finally {
      for (const off of offs) off()
    }
  })

  it('re-derives in place when a new exchange closes — still one file, and only the node whose inputs changed is carded again', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    const firstFile = [...(await slotOf(store))!.files.keys()][0]
    const before = chatCalls(server)

    await seedTurn(store, pool, 'user', 'Add a contact page', OLD_AT + 500)
    const last = await seedTurn(store, pool, 'assistant', 'Added.', OLD_AT + 600)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)

    const structures = structureCalls(server)
    expect(structures).toHaveLength(2)
    expect(structures[1]).toContain('EXCHANGES E1–E3:')
    expect(structures[1]).toContain('E3:\n  participant: Add a contact page\n  reply: Added.')
    // t1 gained an exchange, so its card key changed; t2's did not — and a
    // changed step makes the session card due again.
    expect(chatCalls(server) - before).toBe(3)

    const slot = await slotOf(store)
    expect(slot?.files.size, 'the slot is recycled, not appended to').toBe(1)
    expect([...slot!.files.keys()][0]).not.toBe(firstFile)
    expect(recordIn(slot)).toMatchObject({ upToTurnCount: 6, upToTurnSig: last, exchanges: ['t1', 't2', 't1'], settled: 0, pending: 0 })
    expect(store.pools.get(FLOWS_MEANING)!.dirs.size).toBe(1)
  })

  it('a long conversation is mapped window by window: the settled prefix is frozen and only the provisional tail is mapped again', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    for (let k = 1; k <= 6; k++) {
      await seedTurn(store, pool, 'user', `Question ${k} about the beds`, OLD_AT + k * 1_000)
      await seedTurn(store, pool, 'assistant', `Answer ${k} about the beds.`, OLD_AT + k * 1_000 + 500)
    }
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(structureCalls(server)).toHaveLength(1)
    expect(structureCalls(server)[0]).toContain('EXCHANGES E1–E6:')
    expect(recordIn(await slotOf(store))).toMatchObject({ exchanges: ['t1', 't2', 't1', 't1', 't1', 't1'], settled: 1 })

    await seedTurn(store, pool, 'user', 'Question 7 about the beds', OLD_AT + 7_000)
    await seedTurn(store, pool, 'assistant', 'Answer 7 about the beds.', OLD_AT + 7_500)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    const update = structureCalls(server)[1]!
    expect(update).toContain('TASKS SO FAR (E1–E1 are already mapped):\n- t1 [open]: ')
    expect(update).toContain('THE LAST MAPPED EXCHANGE, for context:\nE1:\n  participant: Question 1 about the beds\n  reply: Answer 1 about the beds.\n  → t1')
    expect(update).toContain('EXCHANGES E2–E7:')
    expect(update.split('E1:').length - 1, 'E1 appears once — as context, never in the window').toBe(1)
    expect(update).toContain('the next new id is t2.')
    expect(recordIn(await slotOf(store))).toMatchObject({ upToTurnCount: 14, exchanges: ['t1', 't2', 't1', 't1', 't1', 't1', 't1'], settled: 2 })
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
    expect(structureCalls(server)).toHaveLength(2)
    expect(structureCalls(server)[1]).not.toContain('TASKS SO FAR')

    const again = [...(await slotOf(store))!.files.values()][0]!
    again.bytes = new TextEncoder().encode(JSON.stringify({ ...record, upToTurnSig: SIG('f') }))
    expect((await m.route.readRoute(CONVO)).flow).toBeUndefined()
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(structureCalls(server)[2], 'a flow about another history is not updated from').not.toContain('TASKS SO FAR')

    const third = [...(await slotOf(store))!.files.values()][0]!
    third.bytes = new TextEncoder().encode('{not json')
    expect((await m.route.readRoute(CONVO)).flow).toBeUndefined()
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(structureCalls(server)).toHaveLength(4)
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
    expect(recordIn(await slotOf(store))).toMatchObject({ upToTurnCount: 2, exchanges: ['t1'] })
    expect(structureCalls(server)[0]).not.toContain('E2:')
    const held = chatCalls(server)

    // The shell's own wait and live run hold it too.
    store.optimizations.clear()
    expect(await m.route.organizeRoute(CONVO, 'ask:' + '7'.repeat(32))).toBe(0)
    expect(await m.route.organizeRoute(CONVO, undefined, true)).toBe(0)
    expect(chatCalls(server)).toBe(held)

    // Nothing outstanding and long quiet: now it closes.
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(recordIn(await slotOf(store))).toMatchObject({ upToTurnCount: 4, exchanges: ['t1', 't2'] })
    const closed = chatCalls(server)

    // A reply seconds old is not closed.
    await seedTurn(store, pool, 'user', 'And a blog?', Date.now() - 4_000)
    await seedTurn(store, pool, 'assistant', 'Yes.', Date.now() - 3_000)
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(chatCalls(server)).toBe(closed)
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

  it('a refused card in back-off does not hold the session card: it is written from what is carded', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    // t2's card answers are prose, twice: rejected, backed off. t1 and the session are fine.
    const server = localServer(body => completion(isCardCall(body) && /WORKING NAME: Choose how many pages/.test(asked(body)) ? 'I cannot say.' : answerByShape(body)))
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    const record = recordIn(await slotOf(store))!
    expect(record['pending']).toBe(1)
    expect(record['session']).toMatchObject({ name: expect.stringContaining('Lay out the site') })
    expect((await m.route.readRoute(CONVO)).cardBackoff).toEqual(['t2'])
  })

  it('reads answers wrapped in reasoning and a fence — the structure and every card', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer(body => completion(`<think>group by the site</think>\n\`\`\`json\n${answerByShape(body)}\n\`\`\``))
    await wake(m, server)
    expect(await m.route.organizeRoute(CONVO)).toBe(1)
    expect(recordIn(await slotOf(store))).toMatchObject({ pending: 0 })
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
      fromResponse: () => ({ text: structureAnswer(''), stopReason: 'stop', inputTokens: 1, outputTokens: 1, model: 'elsewhere-model' }),
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
    expect((await m.route.awakeOrganizerLabeller(MODEL))?.id).toBe('local')
    expect(await m.route.awakeOrganizerLabeller('not-installed:1b'), 'an uninstalled model is no labeller').toBeNull()

    localStorage.setItem(m.local.LOCAL_HOST_STORAGE_KEY, 'https://models.example.test')
    expect(await m.route.awakeOrganizerLabeller(MODEL)).toBeNull()
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    localStorage.removeItem(m.local.LOCAL_HOST_STORAGE_KEY)

    m.activation.setEnabled('local', false)
    expect(await m.route.awakeOrganizerLabeller(MODEL)).toBeNull()
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(server).not.toHaveBeenCalled()
  })

  it('with no stored choice and no conversation that a local model answered, nothing runs and the route says no-model', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    const server = localServer()
    await wake(m, server)
    localStorage.removeItem(m.dispatch.LOCAL_MODEL_STORAGE_KEY)
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect((await m.route.drainRouteFlows()).stopped).toBe('gate')
    expect(server).not.toHaveBeenCalled()
    expect((await m.route.readRoute(CONVO)).organizerState).toBe('no-model')
  })
})

describe('the passive drain — as many conversations as it can reach', () => {
  beforeEach(() => { localStorage.clear(); resetFlowState(); localStorage.setItem('hc:llm:orchestrator-provider', 'local') })
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

  /** The participant opened five of the six — in this order, oldest visit
   *  first. FRESH was never opened. */
  const visitFive = (m: Flows): void => {
    const base = Date.now() - 60_000
    ;['chat:tile:/archived-older', 'chat:tile:/archived-newer', 'chat:tile:/live-older', 'chat:tile:/live-newer', 'chat:tile:/recent']
      .forEach((id, i) => m.route.markRouteVisited(id, base + i * 1_000))
  }

  /** Which conversation each STRUCTURE call was about, in order. */
  const whoWasAsked = (server: LocalServer): string[] =>
    structureCalls(server).map(body => /(ARCHIVED-OLDER|LIVE-OLDER|ARCHIVED-NEWER|LIVE-NEWER|RECENT|FRESH)/.exec(body)?.[1] ?? '?')

  it('visits only the conversations you opened, most recently opened first, and leaves a recent last exchange alone', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    const server = localServer()
    await wake(m, server)

    // Nothing opened yet: the drain organizes nothing, and reads no thread.
    expect(await m.route.drainRouteFlows()).toMatchObject({ organized: 0, behind: 0 })
    expect(server).not.toHaveBeenCalled()
    visitFive(m)
    expect(JSON.parse(localStorage.getItem(m.route.ROUTE_VISITED_KEY)!)).toHaveProperty(['chat:tile:/recent'])

    const pass = await m.route.drainRouteFlows()
    expect(whoWasAsked(server)).toEqual(['RECENT', 'LIVE-NEWER', 'LIVE-OLDER', 'ARCHIVED-NEWER', 'ARCHIVED-OLDER'])
    expect(pass).toMatchObject({ organized: 5, behind: 0 })
    expect(pass.stopped).toBeUndefined()
    expect(pass.elapsedMs).toBeGreaterThanOrEqual(0)
    // The recent thread's flow stops before its quiet-less last exchange…
    expect(recordIn(await slotOf(store, 'chat:tile:/recent'))).toMatchObject({ upToTurnCount: 2, exchanges: ['t1'] })
    expect(structureCalls(server)[0]).not.toContain('RECENT second question')
    // …and the next pass, with nothing else to do, says when that exchange
    // will close. FRESH was never opened, so it is not waited on at all.
    const again = await m.route.drainRouteFlows()
    expect(again).toMatchObject({ organized: 0, behind: 0 })
    expect(again.dueIn).toBeGreaterThan(0)
    expect(again.dueIn).toBeLessThanOrEqual(ROUTE_FLOW_IDLE_MS)
    expect(await slotOf(store, 'chat:tile:/fresh')).toBeUndefined()
    // One slot each; a structure call, a card per node and a session card.
    expect(store.pools.get(FLOWS_MEANING)!.dirs.size).toBe(5)
    expect(chatCalls(server)).toBe(3 + 4 * 4)
  })

  it('stops at its call budget between conversations and picks up where it left off; a time budget stops it too', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    visitFive(m)
    const server = localServer()
    await wake(m, server)

    expect(await m.route.drainRouteFlows({ calls: 7 })).toMatchObject({ organized: 2, stopped: 'budget' })
    expect(whoWasAsked(server)).toEqual(['RECENT', 'LIVE-NEWER'])
    expect(await m.route.drainRouteFlows({ calls: 8 })).toMatchObject({ organized: 2, stopped: 'budget' })
    expect(await m.route.drainRouteFlows({ calls: 8 })).toMatchObject({ organized: 1 })
    expect(whoWasAsked(server)).toEqual(['RECENT', 'LIVE-NEWER', 'LIVE-OLDER', 'ARCHIVED-NEWER', 'ARCHIVED-OLDER'])

    let clock = Date.now()
    const slow = await m.route.drainRouteFlows({ now: () => (clock += 60_000), budgetMs: 90_000 })
    expect(slow.stopped).toBe('budget')
  })

  it('re-reads the gate between calls — a model gone mid-pass ends it with nothing more read or called', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    visitFive(m)
    const server = localServer(body => {
      // The participant switches the local tier off while the first answer
      // is on its way.
      m.activation.setEnabled('local', false)
      return completion(answerByShape(body))
    })
    await wake(m, server)

    const pass = await m.route.drainRouteFlows()
    expect(pass).toMatchObject({ organized: 1, stopped: 'gate' })
    expect(chatCalls(server)).toBe(1)
    expect(store.pools.get(FLOWS_MEANING)!.dirs.size).toBe(1)
  })

  it('the attended call is a visit: the conversation on screen joins the queue, whatever the gate says', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    for (const provider of m.registry.all()) m.registry.unregister(provider.id)
    expect(await m.route.organizeRoute(CONVO)).toBe(0)
    expect(m.route.routeVisited().has(CONVO)).toBe(true)
  })

  it('never mints the same flow twice — the drain yields to an attended call in flight, and finds the flow current after it', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    await twoExchanges(store, pool)
    const m = await loadFlows(store)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const server = localServer(async body => { await held; return completion(answerByShape(body)) })
    await wake(m, server)

    const attended = m.route.organizeRoute(CONVO)
    await vi.waitFor(() => expect(server).toHaveBeenCalledTimes(1))
    // The participant's own call holds the lane: the drain yields before it
    // reads a thing, and says when to come back.
    const yielded = await m.route.drainRouteFlows()
    expect(yielded).toMatchObject({ organized: 0, behind: 0, stopped: 'yield' })
    expect(yielded.resumeAt).toBeGreaterThan(Date.now())
    release()
    expect(await attended).toBe(1)
    expect(await m.route.drainRouteFlows()).toMatchObject({ organized: 0, behind: 0 })
    expect(chatCalls(server)).toBe(4)
    expect((await slotOf(store))?.files.size).toBe(1)
  })

  it('a refused call ends the pass as a fault', async () => {
    const pool = new MockDir('threads')
    const store = makeStore(pool)
    const m = await loadFlows(store)
    await seedSix(store, pool, m.thread)
    visitFive(m)
    const server = localServer(() => { throw new TypeError('connection refused') })
    await wake(m, server)
    expect(await m.route.drainRouteFlows()).toMatchObject({ organized: 0, stopped: 'fault' })
    expect(chatCalls(server)).toBe(1)
  })
})

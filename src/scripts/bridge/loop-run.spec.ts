// loop-run.spec.ts — the responder's half of the run ledger.
//
// Everything guarded here fails SILENTLY if it drifts, and each failure looks
// exactly like success:
//
//   • A run id that is not stable across a restart makes the whole mechanism
//     a no-op that still appears to work — the resume reads an empty ledger
//     and honestly reports that this run has done nothing.
//   • The derivation is necessarily written TWICE (a .cjs script cannot
//     import the TypeScript). If the two spellings drift, the responder
//     writes into one bucket and the agent panel reads another: the ledger
//     fills, every read stays empty, and nothing anywhere reports a fault.
//     So the two implementations are compared directly, not trusted.
//   • A responder that forgets to attach the run records nothing, which is
//     indistinguishable from a run that did nothing.
//   • A resume that reads the WRONG bucket returns an empty ledger for a run
//     that did the work. The renderer files a chat ask's run in the chat's own
//     bucket, so resume must resolve the bucket from the ask record the same
//     way — and throw, never guess, when the record is gone.

import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

// chat-steps imports chat-thread, which registers an IoC surface at module
// scope; it only needs the shell globals to exist, not to work — nothing here
// reaches the store.
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
})

type Step = Record<string, unknown>

interface Run {
  convoId: string | null
  runId: string
  act: (op: string, fields?: Record<string, unknown>) => Promise<unknown>
  resume: () => Promise<{ turns: unknown[]; steps: Step[]; settled: Step[]; landed: Step[]; nextSeq: number }>
  alreadyDid: (verb: string, predicate?: (request: unknown, step: Step) => boolean) => Promise<boolean>
  resolveConvoId: () => Promise<string>
}

const require_ = createRequire(import.meta.url)
const loop = require_('./loop-run.cjs') as {
  runIdForAsk: (askSig: string) => string
  runConvoForAsk: (askSig: string) => string
  runConvoForAskRecord: (askSig: string, record: unknown) => string
  runRefForAsk: (askSig: string) => { convoId: string; id: string }
  runFromEnv: (env?: Record<string, string | undefined>) => { ask: string } | null
  openRun: (opts: Record<string, unknown>) => Run
}

type Req = Record<string, unknown> & { id: string; op: string }
type Res = { ok: boolean; data?: unknown; error?: string }

/** A broker. With no handler it answers every request with the request echoed
 *  back, so a test can see exactly what `act` put on the wire; with one, it
 *  answers the way the renderer would. Every request is kept, in order. */
const listen = async (handler?: (req: Req) => Res): Promise<{ url: string; received: Req[]; close: () => Promise<void> }> => {
  const { WebSocketServer } = await import('ws')
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  const received: Req[] = []
  server.on('connection', socket => {
    socket.on('message', raw => {
      const req = JSON.parse(String(raw)) as Req
      received.push(req)
      const res = handler ? handler(req) : { ok: true, data: { echoed: req } }
      socket.send(JSON.stringify({ id: req.id, ...res }))
    })
  })
  await new Promise<void>(resolve => server.on('listening', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `ws://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

const ASK = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const CHAT = 'chat:tile:/dolphin'

/** The two ops a resume makes, answered from fixed records: the pending asks
 *  (`optimization-list kind:'ask'`) and one ledger per conversation
 *  (`thread-read`). */
const renderer = (records: readonly { sig: string; payload?: unknown }[], ledgers: Record<string, Step[]>) =>
  (req: Req): Res => {
    if (req.op === 'optimization-list') {
      return { ok: true, data: { items: records.map(record => ({ kind: 'ask', ...record })), count: records.length } }
    }
    if (req.op === 'thread-read') {
      return { ok: true, data: { convoId: req['cell'], turns: [], steps: ledgers[String(req['cell'])] ?? [] } }
    }
    return { ok: false, error: `no ${req.op} in this fake` }
  }

const LANDED: Step = { seq: 0, verb: 'note-add', at: 1, outcome: 'ok' }

describe('the run id is derived, never invented', () => {
  it('is the same string every time, so a restarted responder finds its run', () => {
    expect(loop.runIdForAsk(ASK)).toBe(loop.runIdForAsk(ASK))
  })

  it('separates two asks', () => {
    expect(loop.runIdForAsk(ASK)).not.toBe(loop.runIdForAsk(OTHER))
  })
})

describe('the run reference has exactly one input', () => {
  it('addresses the ask, so every party computes the same bucket', () => {
    // Deriving the conversation from the target tile instead reads better and
    // is wrong: the responder knows that path from the command line and a
    // reader can only infer it from the ask record. For a multi-target ask
    // the two disagree, and the reader shows an empty ledger.
    expect(loop.runRefForAsk(ASK)).toEqual({
      convoId: `agent:${ASK}`,
      id: loop.runIdForAsk(ASK),
    })
  })

  it('stays outside the chat list', async () => {
    const { isHumanConversation } = await import('../../hypercomb-essentials/src/assistant/chat-thread.js')
    expect(isHumanConversation(loop.runConvoForAsk(ASK))).toBe(false)
  })
})

describe('the script and the app derive the same address', () => {
  it('agrees with chat-steps on both halves', async () => {
    const steps = await import('../../hypercomb-essentials/src/assistant/chat-steps.js')
    for (const sig of [ASK, OTHER, '', 'not-a-sig']) {
      expect(loop.runIdForAsk(sig), `id for ${JSON.stringify(sig)}`)
        .toBe(await steps.runIdForAsk(sig))
      expect(loop.runConvoForAsk(sig), `convo for ${JSON.stringify(sig)}`)
        .toBe(steps.runConvoForAsk(sig))
    }
  })

  it('resolves an ask RECORD to the bucket the renderer files the run in', async () => {
    // The renderer resolves `run: { ask }` with chat-steps' runForAsk; resume
    // reads with runConvoForAskRecord. Every record shape must agree, or a
    // resume reads a bucket nothing was written to.
    const steps = await import('../../hypercomb-essentials/src/assistant/chat-steps.js')
    const records: unknown[] = [
      undefined,
      null,
      {},
      { payload: null },
      { payload: { mode: 'chat', convoId: CHAT } },
      { payload: { mode: 'chat', convoId: `  ${CHAT}  ` } },
      { payload: { mode: 'chat', convoId: '   ' } },
      { payload: { mode: 'chat', convoId: 7 } },
      { payload: { mode: 'chat' } },
      { payload: { convoId: CHAT } },
      { payload: { mode: 'note', convoId: CHAT } },
    ]
    for (const record of records) {
      expect(loop.runConvoForAskRecord(ASK, record), JSON.stringify(record) ?? 'undefined')
        .toBe((await steps.runForAsk(ASK, record)).convoId)
    }
  })
})

describe('the environment is a fallback that names the ask, nothing more', () => {
  it('yields the { ask } form — the renderer resolves the bucket, never this script', () => {
    // An older shape resolved `agent:<sig>` HERE, which put a chat ask's
    // run in a bucket the chat window cannot find, and a second variable
    // naming the conversation could not fix it: a fresh shell per command
    // loses it, and a persistent shell keeps a stale one.
    expect(loop.runFromEnv({ HYPERCOMB_RUN_ASK: ASK })).toEqual({ ask: ASK })
  })

  it('is null when nothing was declared — nothing is recorded, as before', () => {
    expect(loop.runFromEnv({})).toBeNull()
    expect(loop.runFromEnv({ HYPERCOMB_RUN_ASK: '   ' })).toBeNull()
  })
})

describe('the ask form — one input, resolved by the renderer', () => {
  it('opens on the ask alone and sends run: { ask } on every act', async () => {
    const broker = await listen()
    try {
      const run = loop.openRun({ ask: ASK, bridge: broker.url })
      // The id is still derived locally; the conversation is NOT guessed —
      // it is unknown until resume reads the ask record.
      expect(run.runId).toBe(loop.runIdForAsk(ASK))
      expect(run.convoId).toBeNull()

      const res = await run.act('put-resource', { text: 'x' }) as { data: { echoed: Record<string, unknown> } }
      expect(res.data.echoed['run']).toEqual({ ask: ASK })
      expect(res.data.echoed['op']).toBe('put-resource')
      expect(res.data.echoed['text']).toBe('x')
    } finally { await broker.close() }
  })

  it('still sends { ask } when a convoId is given for resume — the record decides, not the caller', async () => {
    const broker = await listen()
    try {
      const run = loop.openRun({ ask: ASK, convoId: CHAT, bridge: broker.url })
      expect(run.convoId).toBe(CHAT)
      const res = await run.act('note-add', { cell: 'x' }) as { data: { echoed: Record<string, unknown> } }
      expect(res.data.echoed['run']).toEqual({ ask: ASK })
    } finally { await broker.close() }
  })

  it('keeps the explicit { convoId, id } form for runs that answer no ask', async () => {
    const broker = await listen()
    try {
      const run = loop.openRun({ convoId: 'chat:x', runId: 'run-7', bridge: broker.url })
      const res = await run.act('update', {}) as { data: { echoed: Record<string, unknown> } }
      expect(res.data.echoed['run']).toEqual({ convoId: 'chat:x', id: 'run-7' })
    } finally { await broker.close() }
  })
})

describe('resume reads the bucket the renderer filed the run in', () => {
  it('a chat ask: the chat\'s own bucket, found from the ask record — not agent:<sig>', async () => {
    // The ledger exists ONLY under the chat's convoId, as the renderer files
    // it. A resume that guessed `agent:<askSig>` would come back empty for a
    // run that did the work.
    const broker = await listen(renderer(
      [{ sig: ASK, payload: { mode: 'chat', convoId: CHAT } }],
      { [CHAT]: [LANDED], [`agent:${ASK}`]: [] },
    ))
    try {
      const run = loop.openRun({ ask: ASK, bridge: broker.url })
      const { landed } = await run.resume()
      expect(landed.map(step => step['verb'])).toEqual(['note-add'])

      const read = broker.received.find(req => req.op === 'thread-read')!
      expect(read['cell']).toBe(CHAT)
      expect(read['runId']).toBe(loop.runIdForAsk(ASK))
      expect(run.convoId).toBe(CHAT)

      // Held once found: a later guard does not look the record up again,
      // and still answers after the ask has been retired.
      expect(await run.alreadyDid('note-add')).toBe(true)
      expect(broker.received.filter(req => req.op === 'optimization-list')).toHaveLength(1)
    } finally { await broker.close() }
  })

  it('a note-mode ask: agent:<askSig>, as the renderer files it', async () => {
    const broker = await listen(renderer(
      [{ sig: ASK, payload: { prompt: 'summarise this' } }],
      { [`agent:${ASK}`]: [LANDED] },
    ))
    try {
      const run = loop.openRun({ ask: ASK, bridge: broker.url })
      expect(await run.resolveConvoId()).toBe(`agent:${ASK}`)
      expect((await run.resume()).landed).toHaveLength(1)
    } finally { await broker.close() }
  })

  it('a convoId given: read there, no lookup', async () => {
    const broker = await listen(renderer([], { [CHAT]: [LANDED] }))
    try {
      const run = loop.openRun({ ask: ASK, convoId: CHAT, bridge: broker.url })
      expect((await run.resume()).landed).toHaveLength(1)
      expect(broker.received.map(req => req.op)).toEqual(['thread-read'])
    } finally { await broker.close() }
  })

  it('THROWS when the ask record is gone and no convoId was given — never an empty ledger', async () => {
    const broker = await listen(renderer(
      [{ sig: OTHER, payload: { mode: 'chat', convoId: CHAT } }],
      { [CHAT]: [], [`agent:${ASK}`]: [] },
    ))
    try {
      const run = loop.openRun({ ask: ASK, bridge: broker.url })
      await expect(run.resume()).rejects.toThrow(/gone/)
      await expect(run.alreadyDid('note-add')).rejects.toThrow(/gone/)
      // It never read a ledger on a guess.
      expect(broker.received.some(req => req.op === 'thread-read')).toBe(false)
    } finally { await broker.close() }
  })

  it('THROWS when the lookup itself fails', async () => {
    const broker = await listen(() => ({ ok: false, error: 'no renderer' }))
    try {
      const run = loop.openRun({ ask: ASK, bridge: broker.url })
      await expect(run.resume()).rejects.toThrow(/no renderer/)
    } finally { await broker.close() }
  })
})

describe('openRun refuses a run it cannot address', () => {
  it('will not open on an invented-looking blank id', () => {
    expect(() => loop.openRun({ convoId: 'chat:x' })).toThrow(/ask/)
  })

  it('will not open on a bare run id with nowhere to read it back from', () => {
    expect(() => loop.openRun({ runId: 'run-7' })).toThrow(/convoId/)
  })
})

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

const require_ = createRequire(import.meta.url)
const loop = require_('./loop-run.cjs') as {
  runIdForAsk: (askSig: string) => string
  runConvoForAsk: (askSig: string) => string
  runRefForAsk: (askSig: string) => { convoId: string; id: string }
  runFromEnv: (env?: Record<string, string | undefined>) => { ask: string } | null
  openRun: (opts: Record<string, unknown>) => { convoId: string; runId: string; act: (op: string, fields?: Record<string, unknown>) => Promise<unknown> }
}

/** A broker that answers every request with its own request echoed back,
 *  so a test can see exactly what `act` put on the wire. */
const listen = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const { WebSocketServer } = await import('ws')
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  server.on('connection', socket => {
    socket.on('message', raw => {
      const req = JSON.parse(String(raw)) as { id: string }
      socket.send(JSON.stringify({ id: req.id, ok: true, data: { echoed: req } }))
    })
  })
  await new Promise<void>(resolve => server.on('listening', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

const ASK = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

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
      // The id is still derived locally (resume() reads by it); the address
      // defaults to the note-mode bucket until the caller says otherwise.
      expect(run.runId).toBe(loop.runIdForAsk(ASK))
      expect(run.convoId).toBe(`agent:${ASK}`)

      const res = await run.act('put-resource', { text: 'x' }) as { data: { echoed: Record<string, unknown> } }
      expect(res.data.echoed['run']).toEqual({ ask: ASK })
      expect(res.data.echoed['op']).toBe('put-resource')
      expect(res.data.echoed['text']).toBe('x')
    } finally { await broker.close() }
  })

  it('still sends { ask } when a convoId is given for resume — the record decides, not the caller', async () => {
    const broker = await listen()
    try {
      const run = loop.openRun({ ask: ASK, convoId: 'chat:tile:/dolphin', bridge: broker.url })
      expect(run.convoId).toBe('chat:tile:/dolphin')
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

describe('openRun refuses a run it cannot address', () => {
  it('will not open on an invented-looking blank id', () => {
    expect(() => loop.openRun({ convoId: 'chat:x' })).toThrow(/ask/)
  })

  it('will not open on a bare run id with nowhere to read it back from', () => {
    expect(() => loop.openRun({ runId: 'run-7' })).toThrow(/convoId/)
  })
})

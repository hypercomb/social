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
  runFromEnv: (env?: Record<string, string | undefined>) => { convoId: string; id: string } | null
  openRun: (opts: Record<string, unknown>) => unknown
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

describe('a parked session declares the run once', () => {
  it('reads the ask out of the environment', () => {
    expect(loop.runFromEnv({ HYPERCOMB_RUN_ASK: ASK }))
      .toEqual({ convoId: `agent:${ASK}`, id: loop.runIdForAsk(ASK) })
  })

  it('is null when nothing was declared — nothing is recorded, as before', () => {
    expect(loop.runFromEnv({})).toBeNull()
    expect(loop.runFromEnv({ HYPERCOMB_RUN_ASK: '   ' })).toBeNull()
  })
})

describe('openRun refuses a run it cannot address', () => {
  it('will not open without a conversation', () => {
    expect(() => loop.openRun({ ask: ASK })).toThrow(/convoId/)
  })

  it('will not open on an invented-looking blank id', () => {
    expect(() => loop.openRun({ convoId: 'chat:x' })).toThrow(/ask/)
  })
})

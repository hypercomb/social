// loop-run.spec.ts — the responder's half of the run ledger.
//
// Everything guarded here fails SILENTLY if it drifts, and each failure looks
// exactly like success:
//
//   • A run id that is not stable across a restart makes the whole mechanism
//     a no-op that still appears to work — the resume reads an empty ledger
//     and honestly reports that this run has done nothing.
//   • A tile path spelled differently here than in `chat-thread.ts` sends a
//     run's steps to a DIFFERENT bucket than the one the app reads, so the
//     ledger fills and the resume stays empty forever. The rule is
//     necessarily written twice (a .cjs script cannot import the TypeScript),
//     so the two spellings are compared here rather than trusted.
//   • A responder that forgets to attach the run records nothing, which is
//     indistinguishable from a run that did nothing.

import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

// chat-thread registers an IoC surface at module scope; it only needs the
// shell globals to exist, not to work — nothing here calls the store.
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
  runRefForAsk: (askSig: string, segments?: unknown) => { convoId: string; id: string }
  runFromEnv: (env?: Record<string, string | undefined>) => { convoId: string; id: string } | null
  tilePathOfSegments: (segments: unknown) => string
  openRun: (opts: Record<string, unknown>) => unknown
}

const ASK = 'a'.repeat(64)

describe('the run id is derived, never invented', () => {
  it('is the same string every time, so a restarted responder finds its run', () => {
    expect(loop.runIdForAsk(ASK)).toBe(loop.runIdForAsk(ASK))
  })

  it('separates two asks', () => {
    expect(loop.runIdForAsk(ASK)).not.toBe(loop.runIdForAsk('b'.repeat(64)))
  })
})

describe('the run reference names where a person would look', () => {
  it('puts an ask about a tile in that tile own conversation', () => {
    const ref = loop.runRefForAsk(ASK, ['dolphin', 'site'])
    expect(ref.convoId).toBe('chat:tile:/dolphin/site')
    expect(ref.id).toBe(loop.runIdForAsk(ASK))
  })

  it('falls back to a headless conversation when no tile is named', () => {
    // `agent:` is outside isHumanConversation's allowlist, so a headless run
    // never turns up in the chat window.
    expect(loop.runRefForAsk(ASK, []).convoId).toBe(`agent:${ASK}`)
    expect(loop.runRefForAsk(ASK, undefined).convoId).toBe(`agent:${ASK}`)
  })
})

describe('the tile path is spelled the same as the app spells it', () => {
  it('agrees with chat-thread.tilePath on every shape that reaches it', async () => {
    const { tilePath } = await import('../../hypercomb-essentials/src/assistant/chat-thread.js')
    const cases: string[][] = [
      ['dolphin', 'site'],
      ['dolphin'],
      [],
      ['  spaced  ', 'name'],
      ['', 'skip', ''],
      ['a', 'b', 'c', 'd'],
    ]
    for (const segments of cases) {
      expect(loop.tilePathOfSegments(segments), JSON.stringify(segments))
        .toBe(tilePath(segments))
    }
  })
})

describe('a parked session declares the run once', () => {
  it('reads the ask (and its target) out of the environment', () => {
    const ref = loop.runFromEnv({
      HYPERCOMB_RUN_ASK: ASK,
      HYPERCOMB_RUN_SEGMENTS: JSON.stringify(['dolphin', 'site']),
    })
    expect(ref).toEqual({ convoId: 'chat:tile:/dolphin/site', id: loop.runIdForAsk(ASK) })
  })

  it('accepts a plain path as well as JSON, because a shell will hand it one', () => {
    expect(loop.runFromEnv({ HYPERCOMB_RUN_ASK: ASK, HYPERCOMB_RUN_SEGMENTS: 'dolphin/site' })?.convoId)
      .toBe('chat:tile:/dolphin/site')
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

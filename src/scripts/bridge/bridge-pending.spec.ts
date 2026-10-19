// bridge-pending.spec.ts — AN OP THE TAB NEVER FINISHED IS ANSWERED.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { failPendingVia, DROPPED } = createRequire(import.meta.url)('./bridge-pending.cjs') as {
  failPendingVia: (pending: Map<string, { client: unknown; via: unknown }>, socket: unknown) => number
  DROPPED: string
}

const client = (readyState = 1) => {
  const sent: unknown[] = []
  return { readyState, send: (json: string) => { sent.push(JSON.parse(json)) }, sent }
}

describe('a tab that drops mid-op', () => {
  it('answers every client still waiting on that tab, once, and forgets them', () => {
    const gone = {}
    const a = client(), b = client()
    const pending = new Map<string, { client: unknown; via: unknown }>([['a', { client: a, via: gone }], ['b', { client: b, via: gone }]])
    expect(failPendingVia(pending, gone)).toBe(2)
    expect(a.sent).toEqual([{ id: 'a', ok: false, error: DROPPED }])
    expect(b.sent).toEqual([{ id: 'b', ok: false, error: DROPPED }])
    expect(pending.size).toBe(0)
  })

  it('leaves the ops that went to another tab alone', () => {
    const gone = {}, other = {}
    const a = client(), b = client()
    const pending = new Map<string, { client: unknown; via: unknown }>([['a', { client: a, via: gone }], ['b', { client: b, via: other }]])
    expect(failPendingVia(pending, gone)).toBe(1)
    expect(b.sent).toEqual([])
    expect([...pending.keys()]).toEqual(['b'])
  })

  it('forgets a waiting client that has gone too, without throwing', () => {
    const gone = {}
    const closed = client(3)
    const broken = { readyState: 1, send: () => { throw new Error('socket gone') } }
    const pending = new Map<string, { client: unknown; via: unknown }>([['a', { client: closed, via: gone }], ['b', { client: broken, via: gone }]])
    expect(() => failPendingVia(pending, gone)).not.toThrow()
    expect(closed.sent).toEqual([])
    expect(pending.size).toBe(0)
  })

  it('says it plainly enough for a caller to ask again', () => {
    expect(DROPPED).toMatch(/dropped/)
    expect(DROPPED).toMatch(/ask again/)
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('ioc', { register: () => {}, get: () => undefined })
const { findArgs, findLines } = await import('./find.queen.js')

describe('find — the word', () => {
  it('reads the word and the route the way the chat read does', () => {
    expect(findArgs(['dolphin'], 'betz')).toEqual({ word: 'betz', segments: ['dolphin'] })
    expect(findArgs(['dolphin'], 'betz /')).toEqual({ word: 'betz', segments: [] })
    expect(findArgs([], 'betz /dolphin/associates')).toEqual({ word: 'betz', segments: ['dolphin', 'associates'] })
    expect(findArgs([], '')).toBeNull()
    expect(findArgs([], '/dolphin')).toBeNull()
  })

  it('says a whole walk was whole, and how long it took', () => {
    const lines = findLines('betz', '/', {
      ok: true, root: '/', query: 'betz', truncated: false, walked: 6368, snapshot: 's',
      matches: [{ name: 'betz', path: '/people/betz' }, { name: 'betz', path: '/dolphin/associates/betz' }],
    }, 240)
    expect(lines[0]).toBe('Find "betz" under /: 2 tiles — /people/betz, /dolphin/associates/betz')
    expect(lines[1]).toBe('  Walked every tile under /: 6,368 in 0.2 s.')
  })

  it('says why a walk stopped short, and where others may be', () => {
    const lines = findLines('betz', '/', {
      ok: true, root: '/', query: 'betz', truncated: true, walked: 2000, stoppedBy: 'time', snapshot: 's',
      matches: [], unfinished: ['/games'], unfinishedCount: 3,
    }, 30_000)
    expect(lines[0]).toBe('Find "betz" under /: no tile\'s name holds it')
    expect(lines[1]).toBe('  Walked 2,000 tiles in 30 s and stopped — its time ran out; there may be others under /games and 2 more.')
  })

  it('says a failed walk answered from the index only', () => {
    const lines = findLines('betz', '/', {
      ok: true, root: '/', query: 'betz', truncated: true, walkFailed: 'stale-read', snapshot: 's',
      matches: [{ name: 'betz', path: '/people/betz' }],
    }, 900)
    expect(lines[1]).toContain('The walk failed (stale-read)')
  })
})

const { isJobConversation } = await import('./chat-tidy.js')

describe('chats tidy — which conversations are jobs', () => {
  // 2026-10-15: `chat:tile:/::<ms>-<id>` is also a conversation the
  // participant starts on the root tile; only a `job-` seed marks a job.
  it('takes only the job seed, never a root-tile chat, a tile chat or a free chat', () => {
    expect(isJobConversation('chat:tile:/::job-1792124451798-wnikrq')).toBe(true)
    expect(isJobConversation('chat:tile:/::1792057391491-dsutwo')).toBe(false)
    expect(isJobConversation('chat:tile:/dolphin/site')).toBe(false)
    expect(isJobConversation('chat:1792057391491-x1y2z3')).toBe(false)
  })
})

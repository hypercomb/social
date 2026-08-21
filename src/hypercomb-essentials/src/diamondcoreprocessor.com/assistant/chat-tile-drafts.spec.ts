// chat-tile-drafts.spec.ts — a conversation per tile, and thinking that
// survives being left.
//
// TWO FACTS THIS FREEZES:
//
//   1. A tile's conversation id is DERIVED from its path. Nothing mints it,
//      so every tile has one and a tile nobody has spoken to costs nothing —
//      the id resolves, the bucket simply does not exist yet.
//   2. What is typed is stored and ACTIVATES NOTHING. No turn, no ask, no
//      agent: it is held under the tile's path until it is sent or deleted,
//      and the whole set is readable at once — which is what lets the rail
//      mark where thinking is waiting, and what an orchestrator coming
//      through later will read.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The module reaches the store through the bare `get` global and registers
// its IoC surface at module scope — both stood up before the import.
const store = {
  doc: null as ArrayBuffer | null,
  getPool: async () => ({}),
  getPoolDoc: async () => store.doc,
  putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => { store.doc = bytes; return 'ok' },
  getResource: async () => null,
  putResource: async () => 'sig',
}

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = (key: string) => (key === '@hypercomb.social/Store' ? store : undefined)
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {}, onRegister: () => () => {},
  }
})

const {
  tileConvoId, tilePath, tilePathOf, isHumanConversation,
  saveTileDraft, readTileDraft, listTileDrafts,
} = await import('./chat-thread.js')

describe('a conversation per tile', () => {
  it('derives the id from the path — same tile, same thread, every time', () => {
    expect(tileConvoId(['dolphin', 'site'])).toBe('chat:tile:/dolphin/site')
    expect(tileConvoId(['dolphin', 'site'])).toBe(tileConvoId(['dolphin', 'site']))
    expect(tileConvoId([])).toBe('chat:tile:/')
  })

  it('says which tile it belongs to, and lists as a person’s chat', () => {
    expect(tilePathOf(tileConvoId(['revolucion']))).toBe('/revolucion')
    expect(tilePathOf('chat:1785-ab12')).toBe('')
    expect(isHumanConversation(tileConvoId(['revolucion']))).toBe(true)
  })

  it('ignores empty segments so one tile can never have two threads', () => {
    expect(tilePath(['dolphin', '', '  ', 'site'])).toBe('/dolphin/site')
  })
})

describe('sticky drafts', () => {
  beforeEach(() => { store.doc = null })

  it('holds what was typed, and hands it back on return', async () => {
    expect(await saveTileDraft('/dolphin', 'ask about the fins')).toBe(true)
    expect(await readTileDraft('/dolphin')).toBe('ask about the fins')
  })

  it('keeps each tile’s thinking apart', async () => {
    await saveTileDraft('/dolphin', 'one')
    await saveTileDraft('/revolucion/wholesale', 'two')

    expect(await readTileDraft('/dolphin')).toBe('one')
    expect(await readTileDraft('/revolucion/wholesale')).toBe('two')
    expect(await readTileDraft('/never-typed-here')).toBe('')
  })

  it('lists every tile holding thinking, newest first, each naming its tile', async () => {
    await saveTileDraft('/dolphin', 'one')
    await saveTileDraft('/revolucion', 'two')

    const held = await listTileDrafts()
    expect(held.map(d => d.path).sort()).toEqual(['/dolphin', '/revolucion'])
    expect(held.every(d => d.kind === 'chat-draft')).toBe(true)
    expect(held[0].at).toBeGreaterThanOrEqual(held[1].at)
  })

  it('emptying the box forgets the draft rather than holding a blank one', async () => {
    await saveTileDraft('/dolphin', 'one')
    await saveTileDraft('/dolphin', '')

    expect(await readTileDraft('/dolphin')).toBe('')
    expect(await listTileDrafts()).toEqual([])
  })

  it('reports false when there is nowhere to write, never a silent loss', async () => {
    const pool = store.getPool
    store.getPool = async () => null as unknown as Record<string, never>
    try {
      expect(await saveTileDraft('/dolphin', 'unstorable')).toBe(false)
    } finally {
      store.getPool = pool
    }
  })
})

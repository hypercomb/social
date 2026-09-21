// A conversation written before the pool was respelled must still open, and
// the next write must land in the new pool — data never heals, but it is also
// never stranded.
import { describe, expect, it } from 'vitest'

type Doc = { subKey: string; bytes: ArrayBuffer }

/** Two pools that can tell each other apart, keyed by meaning. */
const makeStore = () => {
  const pools = new Map<string, Doc[]>()
  return {
    pools,
    getPool: async (meaning: string) => {
      if (!pools.has(meaning)) pools.set(meaning, [])
      return { meaning } as unknown as FileSystemDirectoryHandle
    },
    getPoolDoc: async (pool: unknown, subKey?: string) => {
      const held = pools.get((pool as { meaning: string })?.meaning ?? '') ?? []
      return held.find(doc => doc.subKey === subKey)?.bytes ?? null
    },
    putPoolDoc: async (pool: unknown, bytes: ArrayBuffer, subKey?: string) => {
      const meaning = (pool as { meaning: string })?.meaning ?? ''
      const held = pools.get(meaning) ?? []
      pools.set(meaning, [...held.filter(doc => doc.subKey !== subKey), { subKey: subKey ?? '', bytes }])
      return 'written'
    },
  }
}

const load = async (store: unknown) => {
  ;(globalThis as Record<string, unknown>)['get'] =
    (key: string) => key === '@hypercomb.social/Store' ? store : undefined
  return await import('./resident-chat.js')
}

const talkBytes = (residentId: string, text: string): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify({
    kind: 'resident-talk', residentId, turns: [{ role: 'user', text, at: 1 }],
  })).buffer as ArrayBuffer

describe('the respelled Solomon talk pool', () => {
  it('opens a conversation written under the retired spelling', async () => {
    const store = makeStore()
    const { readResidentTalk, RETIRED_RESIDENT_TALK_POOL } = await load(store)
    store.pools.set(RETIRED_RESIDENT_TALK_POOL, [{ subKey: 'mara', bytes: talkBytes('mara', 'hello from before') }])

    const talk = await readResidentTalk('mara')
    expect(talk.turns).toHaveLength(1)
    expect(talk.turns[0]?.text).toBe('hello from before')
  })

  it('prefers the new pool when both hold something', async () => {
    const store = makeStore()
    const { readResidentTalk, RESIDENT_TALK_POOL, RETIRED_RESIDENT_TALK_POOL } = await load(store)
    store.pools.set(RETIRED_RESIDENT_TALK_POOL, [{ subKey: 'mara', bytes: talkBytes('mara', 'old') }])
    store.pools.set(RESIDENT_TALK_POOL, [{ subKey: 'mara', bytes: talkBytes('mara', 'new') }])

    expect((await readResidentTalk('mara')).turns[0]?.text).toBe('new')
  })

  it('is empty for a resident nobody has spoken to, in either pool', async () => {
    const store = makeStore()
    const { readResidentTalk } = await load(store)
    expect((await readResidentTalk('nobody')).turns).toEqual([])
  })

  it('NEVER writes the retired pool — the next turn lands in the new one', async () => {
    const store = makeStore()
    const { appendResidentTurn, RESIDENT_TALK_POOL, RETIRED_RESIDENT_TALK_POOL } = await load(store)
    const before = talkBytes('mara', 'old')
    store.pools.set(RETIRED_RESIDENT_TALK_POOL, [{ subKey: 'mara', bytes: before }])

    const settled = await appendResidentTurn('mara', 'user', 'said something new')

    // The old conversation was carried forward, not lost...
    expect(settled.turns.map(turn => turn.text)).toEqual(['old', 'said something new'])
    // ...written to the NEW pool...
    expect(store.pools.get(RESIDENT_TALK_POOL)).toHaveLength(1)
    // ...and the retired pool is exactly as it was.
    expect(store.pools.get(RETIRED_RESIDENT_TALK_POOL)).toEqual([{ subKey: 'mara', bytes: before }])
  })
})

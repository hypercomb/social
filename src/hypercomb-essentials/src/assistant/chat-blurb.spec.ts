// assistant/chat-blurb.spec.ts
//
// THE TWO THINGS A STICKY SUMMARY HAS TO GET RIGHT, frozen mechanically:
//
//   1. IT RECYCLES. A conversation holds exactly ONE blurb however many times
//      it is re-derived. This is the whole reason the record is keyed by the
//      conversation and not by the hash of its turns — a growing thread keyed
//      by content would leave one orphan per turn behind it, and THAT is how a
//      derived pool turns into a landfill.
//
//   2. IT INVALIDATES. Keyed-by-input is not self-invalidating: the turns do
//      not change, the deriving function does. A record stamped with a
//      different BLURB_VERSION must read as ABSENT so the drain re-derives it,
//      rather than serving an answer this code would no longer produce.
//
// And the property that makes both safe: NEVER LOAD-BEARING. Missing pool,
// unreadable record, no provider configured, model returning junk — every one
// of them yields null, and no caller is entitled to more.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

// The blurb module talks to exactly two collaborators. Both are faked, so
// these tests are about the RECORD and never about a thread walk or a vendor.
const llm = vi.hoisted(() => ({
  calls: [] as Array<{ system?: string; content: string }>,
  providers: 1,
  reply: 'a line about the thread\n- first point\n- second point',
}))

vi.mock('./llm-dispatch.js', () => ({
  activeProviders: () => Array.from({ length: llm.providers }, (_, i) => ({ id: `p${i}` })),
  callModel: async (call: { system?: string; messages: Array<{ content: string }> }) => {
    llm.calls.push({ system: call.system, content: call.messages[0]?.content ?? '' })
    return { text: llm.reply, stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, model: 'fast' }
  },
}))

const threads = vi.hoisted(() => ({
  conversations: [] as Array<{ convoId: string; title: string; turnCount: number; lastAt: number; archived: boolean }>,
  turns: new Map<string, Array<{ kind: 'chat-turn'; convoId: string; role: 'user' | 'assistant'; text: string; at: number }>>(),
}))

vi.mock('./chat-thread.js', () => ({
  listConversations: async () => threads.conversations,
  readTurns: async (convoId: string) => threads.turns.get(convoId) ?? [],
}))

// ---- the slice of OPFS a document pool touches -----------------------

const hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
const signOf = (text: string): Promise<string> => hex(new TextEncoder().encode(text))
const isSig = (name: string): boolean => /^[0-9a-f]{64}$/.test(name)

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  get size(): number { return this.bytes.byteLength }
  async getFile() {
    const slice = this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength)
    return { size: this.bytes.byteLength, arrayBuffer: async () => slice as ArrayBuffer } as unknown as File
  }
}

class MockDir {
  kind = 'directory' as const
  files = new Map<string, MockFile>()
  dirs = new Map<string, MockDir>()
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    let file = this.files.get(name)
    if (!file) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      file = new MockFile(); this.files.set(name, file)
    }
    return file
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      dir = new MockDir(); this.dirs.set(name, dir)
    }
    return dir
  }
  async removeEntry(name: string): Promise<void> {
    if (!(this.files.delete(name) || this.dirs.delete(name))) {
      throw new DOMException('NotFoundError', 'NotFoundError')
    }
  }
  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const entry of this.files) yield entry
    for (const entry of this.dirs) yield entry
  }
}

/** Store.putPoolDoc / getPoolDoc, reproduced faithfully — including the rule
 *  this whole design leans on: writing a member DROPS every other sig-named
 *  file in the same sub-bucket, so a document pool holds exactly one. */
const makeStore = (pool: MockDir) => ({
  getPool: async () => pool as unknown as FileSystemDirectoryHandle,
  putPoolDoc: async (root: unknown, bytes: ArrayBuffer, subKey?: string) => {
    const target = subKey
      ? await (root as MockDir).getDirectoryHandle(await signOf(subKey), { create: true })
      : root as MockDir
    const sig = await hex(new Uint8Array(bytes))
    const handle = await target.getFileHandle(sig, { create: true })
    handle.bytes = new Uint8Array(bytes)
    for (const [name, entry] of [...target.files]) {
      if (entry.kind === 'file' && name !== sig && isSig(name)) target.files.delete(name)
    }
    return sig
  },
  getPoolDoc: async (root: unknown, subKey?: string) => {
    try {
      const target = subKey
        ? await (root as MockDir).getDirectoryHandle(await signOf(subKey), { create: false })
        : root as MockDir
      for (const [name, entry] of target.files) {
        if (!isSig(name) || entry.size === 0) continue
        return entry.bytes.buffer.slice(0, entry.bytes.byteLength) as ArrayBuffer
      }
      return null
    } catch { return null }
  },
})

type BlurbModule = typeof import('./chat-blurb.js')

const load = async (store: unknown): Promise<BlurbModule> => {
  ;(globalThis as Record<string, unknown>)['get'] =
    (key: string) => key === '@hypercomb.social/Store' ? store : undefined
  return import('./chat-blurb.js')
}

/** The sub-bucket a conversation's blurb lives in, so a test can count what
 *  is actually on disk for it. */
const slotOf = async (pool: MockDir, convoId: string): Promise<MockDir | undefined> =>
  pool.dirs.get(await signOf(convoId))

const say = (convoId: string, count: number, at = 1_000): void => {
  threads.turns.set(convoId, Array.from({ length: count }, (_, i) => ({
    kind: 'chat-turn' as const,
    convoId,
    role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
    text: `message ${i}`,
    at: at + i,
  })))
}

describe('chat-blurb — one slot per conversation, recycled and versioned', () => {
  let pool: MockDir
  let store: ReturnType<typeof makeStore>
  let mod: BlurbModule

  beforeEach(async () => {
    pool = new MockDir()
    store = makeStore(pool)
    llm.calls = []
    llm.providers = 1
    llm.reply = 'a line about the thread\n- first point\n- second point'
    threads.conversations = []
    threads.turns = new Map()
    vi.resetModules()
    mod = await load(store)
    vi.setSystemTime(new Date('2026-08-25T12:00:00Z'))
  })

  // ── 1. RECYCLED ────────────────────────────────────────────────────

  it('re-deriving a growing thread leaves ONE blurb, not one per pass', async () => {
    say('chat:a', 2)
    await mod.mintBlurb('chat:a')

    // The thread grows and is summarised again — the case that would mint a
    // new key on every turn if the record were keyed by its content.
    say('chat:a', 9)
    llm.reply = 'a later line\n- a later point'
    await mod.mintBlurb('chat:a')

    say('chat:a', 20)
    llm.reply = 'the latest line\n- the latest point'
    await mod.mintBlurb('chat:a')

    const slot = await slotOf(pool, 'chat:a')
    expect([...(slot?.files.keys() ?? [])]).toHaveLength(1)

    // And the one that survived is the NEWEST, not whichever landed first.
    const blurb = await mod.readBlurb('chat:a')
    expect(blurb?.line).toBe('the latest line')
    expect(blurb?.upToTurnCount).toBe(20)
  })

  it('two conversations do not share a slot', async () => {
    say('chat:a', 3)
    say('chat:b', 3)
    await mod.mintBlurb('chat:a')
    llm.reply = 'the other thread\n- its point'
    await mod.mintBlurb('chat:b')

    expect((await mod.readBlurb('chat:a'))?.line).toBe('a line about the thread')
    expect((await mod.readBlurb('chat:b'))?.line).toBe('the other thread')
    expect([...(await slotOf(pool, 'chat:a'))!.files.keys()]).toHaveLength(1)
    expect([...(await slotOf(pool, 'chat:b'))!.files.keys()]).toHaveLength(1)
  })

  // ── 2. VERSIONED ───────────────────────────────────────────────────

  it('a record from a different derivation reads as ABSENT', async () => {
    say('chat:a', 4)
    await mod.mintBlurb('chat:a')
    expect(await mod.readBlurb('chat:a')).not.toBeNull()

    // Rewrite the stored record with a stale version stamp — exactly what an
    // old blurb becomes the moment BLURB_VERSION is bumped.
    const slot = (await slotOf(pool, 'chat:a'))!
    const [name] = [...slot.files.keys()]
    const held = JSON.parse(new TextDecoder().decode(slot.files.get(name)!.bytes))
    slot.files.get(name)!.bytes = new TextEncoder().encode(
      JSON.stringify({ ...held, v: mod.BLURB_VERSION + 1 }))

    expect(await mod.readBlurb('chat:a')).toBeNull()
    // …and "absent" is what makes the drain pick it up again.
    expect(mod.blurbIsBehind(await mod.readBlurb('chat:a'), 4)).toBe(true)
  })

  // ── 3. NEVER LOAD-BEARING ──────────────────────────────────────────

  it('yields null rather than throwing when there is nothing to read', async () => {
    expect(await mod.readBlurb('chat:never-spoken')).toBeNull()
    expect(await mod.readBlurb('')).toBeNull()

    vi.resetModules()
    const noStore = await load(undefined)
    expect(await noStore.readBlurb('chat:a')).toBeNull()
    expect(await noStore.readBlurbs(['chat:a', 'chat:b'])).toEqual(new Map())
  })

  it('a model that ignored the format still leaves a usable line', async () => {
    say('chat:a', 3)
    llm.reply = 'just one line, no bullets at all.'
    await mod.mintBlurb('chat:a')
    const blurb = await mod.readBlurb('chat:a')
    expect(blurb?.line).toBe('just one line, no bullets at all')
    expect(blurb?.points).toEqual([])
  })

  it('a model that said nothing usable stores nothing', async () => {
    say('chat:a', 3)
    llm.reply = '   '
    expect(await mod.mintBlurb('chat:a')).toBeNull()
    expect(await mod.readBlurb('chat:a')).toBeNull()
  })

  it('keeps at most four points', async () => {
    say('chat:a', 3)
    llm.reply = 'the line\n- one\n- two\n- three\n- four\n- five\n- six'
    await mod.mintBlurb('chat:a')
    expect((await mod.readBlurb('chat:a'))?.points).toEqual(['one', 'two', 'three', 'four'])
  })

  // ── 4. NOTHING TO SAY IT WITH ──────────────────────────────────────

  it('spends no call when no provider is configured', async () => {
    llm.providers = 0
    say('chat:a', 6)
    threads.conversations = [{ convoId: 'chat:a', title: 'a', turnCount: 6, lastAt: 0, archived: false }]

    expect(await mod.mintBlurb('chat:a')).toBeNull()
    expect(await mod.drainBlurbs()).toEqual({ behind: 0, minted: 0 })
    expect(llm.calls).toHaveLength(0)
  })

  it('spends no call on a thread of one turn — its title already shows it', async () => {
    say('chat:a', 1)
    expect(await mod.mintBlurb('chat:a')).toBeNull()
    expect(llm.calls).toHaveLength(0)
  })

  // ── 5. THE DRAIN'S BOUNDS ──────────────────────────────────────────

  it('skips archived and in-flight threads, takes the oldest, and stops at the limit', async () => {
    const now = Date.now()
    const convos = [
      { convoId: 'chat:oldest', title: '', turnCount: 5, lastAt: now - 60 * 60_000, archived: false },
      { convoId: 'chat:older', title: '', turnCount: 5, lastAt: now - 30 * 60_000, archived: false },
      { convoId: 'chat:recent', title: '', turnCount: 5, lastAt: now - 10 * 60_000, archived: false },
      { convoId: 'chat:live', title: '', turnCount: 5, lastAt: now - 1_000, archived: false },
      { convoId: 'chat:filed', title: '', turnCount: 5, lastAt: now - 90 * 60_000, archived: true },
      { convoId: 'chat:lonely', title: '', turnCount: 1, lastAt: now - 90 * 60_000, archived: false },
    ]
    threads.conversations = convos
    for (const convo of convos) say(convo.convoId, convo.turnCount)

    const drain = await mod.drainBlurbs(2)

    // Three candidates stand: live is mid-conversation, filed is put away,
    // lonely has nothing a blurb could add.
    expect(drain).toEqual({ behind: 3, minted: 2 })
    expect(await mod.readBlurb('chat:oldest')).not.toBeNull()
    expect(await mod.readBlurb('chat:older')).not.toBeNull()
    expect(await mod.readBlurb('chat:recent')).toBeNull()
    expect(await mod.readBlurb('chat:live')).toBeNull()
    expect(await mod.readBlurb('chat:filed')).toBeNull()
    expect(await mod.readBlurb('chat:lonely')).toBeNull()
  })

  it('leaves a thread alone until it has moved far enough to be worth re-reading', async () => {
    const lastAt = Date.now() - 60 * 60_000
    say('chat:a', 5)
    threads.conversations = [{ convoId: 'chat:a', title: '', turnCount: 5, lastAt, archived: false }]
    expect((await mod.drainBlurbs()).minted).toBe(1)

    // Two more turns is not a different conversation.
    threads.conversations = [{ convoId: 'chat:a', title: '', turnCount: 7, lastAt, archived: false }]
    expect(await mod.drainBlurbs()).toEqual({ behind: 0, minted: 0 })

    // Six is.
    threads.conversations = [{ convoId: 'chat:a', title: '', turnCount: 11, lastAt, archived: false }]
    say('chat:a', 11)
    llm.reply = 'it moved on\n- somewhere else'
    expect((await mod.drainBlurbs()).minted).toBe(1)
    expect((await mod.readBlurb('chat:a'))?.line).toBe('it moved on')
    expect([...(await slotOf(pool, 'chat:a'))!.files.keys()]).toHaveLength(1)
  })

  // ── 6. WHAT THE MODEL IS SHOWN ─────────────────────────────────────

  it('sends the opening and the end of a long thread, and says the middle was cut', async () => {
    say('chat:a', 40)
    await mod.mintBlurb('chat:a')
    const sent = llm.calls[0]?.content ?? ''
    expect(sent).toContain('message 0')
    expect(sent).toContain('message 39')
    expect(sent).toContain('30 turns omitted')
    expect(sent).not.toContain('message 20')
  })

  it('sends a short thread whole, with no omission marker', async () => {
    say('chat:a', 4)
    await mod.mintBlurb('chat:a')
    const sent = llm.calls[0]?.content ?? ''
    expect(sent).toContain('message 0')
    expect(sent).toContain('message 3')
    expect(sent).not.toContain('omitted')
  })

  it('the pool meaning carries a colon, so it can never collide with a tile', () => {
    expect(mod.CHAT_BLURB_POOL).toContain(':')
  })
})

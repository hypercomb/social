// games/solomon/resident-chat.spec.ts
//
// What a resident's freeform chat has to get right, frozen mechanically:
//
//   1. NEVER BREAKS THE GAME. No provider, an unreadable store, a thrown
//      call — askResident answers null in every case, never throws.
//   2. ONE SLOT PER RESIDENT, RECYCLED. Turns persist and round-trip; the
//      slot holds exactly this resident's record, never one-per-append.
//   3. IT RECYCLES OLD TURNS INTO MEMORY once the raw log passes the cap,
//      rather than growing forever or losing the earlier conversation.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const llm = vi.hoisted(() => ({
  calls: [] as Array<{ system?: string; messages: Array<{ role: string; content: string }> }>,
  providers: 1,
  reply: 'A fine morning to you, traveller.',
}))

vi.mock('../../assistant/llm-dispatch.js', () => ({
  activeProviders: () => Array.from({ length: llm.providers }, (_, i) => ({ id: `p${i}` })),
  callModel: async (call: { system?: string; messages: Array<{ role: string; content: string }> }) => {
    llm.calls.push({ system: call.system, messages: call.messages })
    return { text: llm.reply, stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, model: 'fast' }
  },
}))

// ---- the slice of OPFS a document pool touches ------------------------

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
}

/** Store.putPoolDoc / getPoolDoc — recycled: writing a member drops every
 *  other sig-named file in the same sub-bucket, so a slot holds exactly one. */
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

type ResidentChatModule = typeof import('./resident-chat.js')

const load = async (store: unknown): Promise<ResidentChatModule> => {
  ;(globalThis as Record<string, unknown>)['get'] =
    (key: string) => key === '@hypercomb.social/Store' ? store : undefined
  return import('./resident-chat.js')
}

const resident = {
  kind: 'resident' as const, id: 'tamsin', name: 'Tamsin', x: 0, y: 0,
  role: 'the ferryman’s daughter', color: '#fff',
  lines: ['The tide turns at noon.', 'Mind the wet stones.'],
}

describe('resident-chat — freeform AI conversation, never load-bearing', () => {
  let pool: MockDir
  let store: ReturnType<typeof makeStore>
  let mod: ResidentChatModule

  beforeEach(async () => {
    pool = new MockDir()
    store = makeStore(pool)
    llm.calls = []
    llm.providers = 1
    llm.reply = 'A fine morning to you, traveller.'
    vi.resetModules()
    mod = await load(store)
  })

  it('a resident nobody has spoken to yet has an empty talk record', async () => {
    const talk = await mod.readResidentTalk('tamsin')
    expect(talk).toEqual({ kind: 'resident-talk', residentId: 'tamsin', turns: [] })
  })

  it('appended turns persist and round-trip through the pool', async () => {
    await mod.appendResidentTurn('tamsin', 'assistant', 'The tide turns at noon.')
    await mod.appendResidentTurn('tamsin', 'user', 'What lies past the reef?')
    const talk = await mod.readResidentTalk('tamsin')
    expect(talk.turns.map(t => [t.role, t.text])).toEqual([
      ['assistant', 'The tide turns at noon.'],
      ['user', 'What lies past the reef?'],
    ])
  })

  it('one resident, one recycled slot — never one file per turn', async () => {
    for (let i = 0; i < 5; i++) await mod.appendResidentTurn('tamsin', 'user', `message ${i}`)
    const bucket = pool.dirs.get(await signOf('tamsin'))!
    const sigFiles = [...bucket.files.keys()].filter(isSig)
    expect(sigFiles).toHaveLength(1)
  })

  it('askResident answers null with no provider configured, never throws', async () => {
    llm.providers = 0
    const reply = await mod.askResident(resident, { kind: 'resident-talk', residentId: 'tamsin', turns: [] }, 'Hello?')
    expect(reply).toBeNull()
    expect(llm.calls).toHaveLength(0)
  })

  it('askResident answers null for an empty or whitespace message', async () => {
    expect(await mod.askResident(resident, { kind: 'resident-talk', residentId: 'tamsin', turns: [] }, '   ')).toBeNull()
  })

  it('askResident sends the persona, prior turns and the new message, and returns the reply', async () => {
    const talk = { kind: 'resident-talk' as const, residentId: 'tamsin', turns: [{ role: 'user' as const, text: 'earlier question', at: 1 }] }
    const reply = await mod.askResident(resident, talk, 'What lies past the reef?')
    expect(reply).toBe(llm.reply)
    expect(llm.calls).toHaveLength(1)
    const call = llm.calls[0]!
    expect(call.system).toContain('Tamsin')
    expect(call.system).toContain(resident.role)
    expect(call.messages.at(-1)).toEqual({ role: 'user', content: 'What lies past the reef?' })
    expect(call.messages[0]).toEqual({ role: 'user', content: 'earlier question' })
  })

  it('a resident with a custom persona has it read into the system prompt instead of a derived one', async () => {
    const custom = { ...resident, persona: 'A gruff old smuggler who trusts no one.' }
    await mod.askResident(custom, { kind: 'resident-talk', residentId: 'tamsin', turns: [] }, 'Who are you?')
    expect(llm.calls[0]!.system).toContain('A gruff old smuggler who trusts no one.')
  })

  it('folds old turns into memory once the raw log passes the cap, keeping only the newest few', async () => {
    llm.reply = 'They spoke of the tide and the reef.'
    for (let i = 0; i < 25; i++) await mod.appendResidentTurn('tamsin', i % 2 ? 'assistant' : 'user', `turn ${i}`)
    const talk = await mod.readResidentTalk('tamsin')
    expect(talk.turns.length).toBeLessThan(25)
    expect(talk.memory).toBe('They spoke of the tide and the reef.')
    // The newest turns are the ones kept, not the oldest.
    expect(talk.turns.at(-1)?.text).toBe('turn 24')
  })

  it('a resident’s memory rides into later system prompts', async () => {
    const talk = { kind: 'resident-talk' as const, residentId: 'tamsin', turns: [], memory: 'The player asked about the reef.' }
    await mod.askResident(resident, talk, 'Anything new?')
    expect(llm.calls[0]!.system).toContain('The player asked about the reef.')
  })
})

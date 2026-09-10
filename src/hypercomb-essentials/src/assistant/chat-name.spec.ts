// assistant/chat-name.spec.ts
//
// WHAT NAMING A CONVERSATION HAS TO GET RIGHT, frozen mechanically:
//
//   1. NOT BEFORE THERE IS A SUBJECT. A question that has been sent and not
//      answered has nothing to be named after — the surfaces already say
//      "waiting for reply…" — so no model is called and nothing is written.
//   2. ONCE. A thread that has a name keeps it. The naming write announces
//      itself on the same channel the naming is triggered from, so a second
//      pass over a named thread is the difference between a label and a loop.
//   3. A NAME, NOT A SENTENCE. Whatever the model says comes back as
//      something a rail row can wear: no quotes, no trailing stop, bounded.
//
// And the property underneath all three: it is never load-bearing. No
// provider, an unreadable pool, a model answering junk — every one of them
// leaves the thread named by its opening line, which is where it started.

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

const llm = vi.hoisted(() => ({
  calls: [] as string[],
  providers: 1,
  reply: 'Hexagon shader seams',
}))

vi.mock('./llm-dispatch.js', () => ({
  activeProviders: () => Array.from({ length: llm.providers }, (_, i) => ({ id: `p${i}` })),
  callModel: async (call: { messages: Array<{ content: string }> }) => {
    llm.calls.push(call.messages[0]?.content ?? '')
    return { text: llm.reply, stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, model: 'fast' }
  },
}))

type Summary = {
  convoId: string; title: string; turnCount: number; lastAt: number
  archived: boolean; replied: boolean; named: boolean
}

const threads = vi.hoisted(() => ({
  conversations: [] as Array<Record<string, unknown>>,
  turns: new Map<string, Array<{ role: 'user' | 'assistant'; text: string }>>(),
  written: [] as Array<{ convoId: string; name: string }>,
  names: new Map<string, string>(),
  writeOk: true,
}))

vi.mock('./chat-thread.js', () => ({
  listConversations: async () => threads.conversations,
  readConversationName: async (convoId: string) => threads.names.get(convoId) ?? '',
  readTurns: async (convoId: string) => threads.turns.get(convoId) ?? [],
  setConversationName: async (convoId: string, name: string) => {
    if (!threads.writeOk) return false
    threads.written.push({ convoId, name })
    return true
  },
}))

const { cleanName, drainNames, nameConversation } = await import('./chat-name.js')

const summary = (over: Partial<Summary>): Summary => ({
  convoId: 'chat:a', title: 'what is this', turnCount: 2, lastAt: 100,
  archived: false, replied: true, named: false, ...over,
})

beforeEach(() => {
  llm.calls = []
  llm.providers = 1
  llm.reply = 'Hexagon shader seams'
  threads.conversations = []
  threads.turns = new Map()
  threads.written = []
  threads.names = new Map()
  threads.writeOk = true
})

describe('naming a conversation from its first exchange', () => {
  it('names an answered thread and writes the name down', async () => {
    threads.turns.set('chat:a', [
      { role: 'user', text: 'the seams between hexagons flicker at high zoom' },
      { role: 'assistant', text: 'that is the shader sampling across the atlas edge' },
    ])

    expect(await nameConversation('chat:a')).toBe('Hexagon shader seams')
    expect(threads.written).toEqual([{ convoId: 'chat:a', name: 'Hexagon shader seams' }])
    // BOTH SIDES OF THE EXCHANGE are what it read — the question alone is the
    // thing the opening line already says.
    expect(llm.calls[0]).toContain('the seams between hexagons flicker')
    expect(llm.calls[0]).toContain('that is the shader sampling')
  })

  it('refuses a question that has not been answered — no call, no write', async () => {
    threads.turns.set('chat:a', [{ role: 'user', text: 'is anyone there' }])

    expect(await nameConversation('chat:a')).toBe('')
    expect(llm.calls).toEqual([])
    expect(threads.written).toEqual([])
  })

  it('never renames a thread that already has a name', async () => {
    // The guard has to come from the POOL, not from what this page remembers:
    // naming is driven by turns landing, and opening an old thread announces
    // one. A page that had just loaded would otherwise re-derive — and
    // overwrite — the name of every conversation the participant looked at.
    threads.names.set('chat:a', 'Hexagon shader seams')
    threads.turns.set('chat:a', [
      { role: 'user', text: 'q' }, { role: 'assistant', text: 'a' },
    ])

    expect(await nameConversation('chat:a')).toBe('')
    expect(llm.calls).toEqual([])
    expect(threads.written).toEqual([])
  })

  it('is silent with no provider configured', async () => {
    llm.providers = 0
    threads.turns.set('chat:a', [
      { role: 'user', text: 'q' }, { role: 'assistant', text: 'a' },
    ])

    expect(await nameConversation('chat:a')).toBe('')
    expect(threads.written).toEqual([])
  })

  it('reports nothing when the write does not land', async () => {
    threads.writeOk = false
    threads.turns.set('chat:a', [
      { role: 'user', text: 'q' }, { role: 'assistant', text: 'a' },
    ])

    expect(await nameConversation('chat:a')).toBe('')
  })
})

describe('a name, not a sentence', () => {
  it('strips the shapes a model reaches for', () => {
    expect(cleanName('"Hexagon shader seams."')).toBe('Hexagon shader seams')
    expect(cleanName('  **Flavor wheel taxonomy**  ')).toBe('Flavor wheel taxonomy')
    expect(cleanName('Sure! Here you go:\nOPFS pool drain')).toBe('Sure! Here you go')
  })

  it('is bounded — six words, and never wider than a row', () => {
    expect(cleanName('one two three four five six seven eight')).toBe('one two three four five six')
    expect(cleanName('supercalifragilistic expialidocious antidisestablishmentarianism unquestionably').length)
      .toBeLessThanOrEqual(48)
  })

  it('yields nothing from nothing, rather than a name made of punctuation', () => {
    expect(cleanName('')).toBe('')
    expect(cleanName('"""')).toBe('')
  })
})

describe('the catch-up drain', () => {
  it('takes only threads that are answered, unnamed and still live', async () => {
    threads.conversations = [
      summary({ convoId: 'chat:answered', lastAt: 10 }),
      summary({ convoId: 'chat:waiting', replied: false, lastAt: 20 }),
      summary({ convoId: 'chat:named', named: true, lastAt: 30 }),
      summary({ convoId: 'chat:filed', archived: true, lastAt: 40 }),
    ]
    for (const id of ['chat:answered', 'chat:waiting', 'chat:named', 'chat:filed']) {
      threads.turns.set(id, [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }])
    }

    expect(await drainNames(5)).toBe(1)
    expect(threads.written.map(w => w.convoId)).toEqual(['chat:answered'])
  })

  it('is bounded per pass, oldest first', async () => {
    threads.conversations = [
      summary({ convoId: 'chat:new', lastAt: 300 }),
      summary({ convoId: 'chat:old', lastAt: 100 }),
      summary({ convoId: 'chat:mid', lastAt: 200 }),
    ]
    for (const id of ['chat:new', 'chat:old', 'chat:mid']) {
      threads.turns.set(id, [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }])
    }

    expect(await drainNames(2)).toBe(2)
    expect(threads.written.map(w => w.convoId)).toEqual(['chat:old', 'chat:mid'])
  })

  it('does nothing with no provider configured', async () => {
    llm.providers = 0
    threads.conversations = [summary({})]
    expect(await drainNames(2)).toBe(0)
  })
})

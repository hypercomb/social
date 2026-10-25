import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { EffectBus } = await import('@hypercomb/core')
const { SayQueenBee } = await import('./say.queen.js')

type Ask = { askId: string; convoId: string; text: string; trust: boolean }
const asks: Ask[] = []
const logged: string[] = []

const tiles = (byParent: Record<string, string[]>): void => {
  registrations.set('@diamondcoreprocessor.com/HypercombHiveTreeReader', {
    readNode: async (segments: readonly string[]) => {
      const children = byParent[segments.join('/')]
      return children ? { ok: true, children: children.map(name => ({ name })) } : { ok: false }
    },
  })
}

beforeEach(() => {
  EffectBus.clear()
  asks.length = 0
  logged.length = 0
  EffectBus.on<Ask>('chat:ask', payload => { asks.push(payload) })
  EffectBus.on<{ message: string }>('activity:log', payload => { logged.push(payload.message) })
  tiles({ '': ['work', 'play'] })
})

// 2026-10-25: a harness's way to talk to the hive is a sentence into a tile's
// own conversation — not a bridge op, not a hidden job conversation.
describe('/say', () => {
  it('starts a NEW conversation on the tile, and names it by how it begins', async () => {
    await new SayQueenBee().invoke('on /Work: Tidy the invoices\nFile them under invoices.')
    expect(asks).toHaveLength(1)
    expect(asks[0].convoId).toMatch(/^chat:tile:\/Work::\d+-[a-z0-9]+$/)
    expect(asks[0].convoId).not.toContain('::job-')
    expect(asks[0].text).toBe('Tidy the invoices\nFile them under invoices.')
    expect(logged).toEqual([`Say — ${asks[0].convoId}`])
    // Two sentences are two conversations.
    await new SayQueenBee().invoke('on /work: Another thing')
    expect(asks[1].convoId).not.toBe(asks[0].convoId)
  })

  it('never trusts the conversation: the participant\'s own rules decide what runs', async () => {
    await new SayQueenBee().invoke('on /work: do it')
    expect(asks[0].trust).toBe(false)
  })

  it('carries on a conversation named by its id, whose colons are not the separator', async () => {
    await new SayQueenBee().invoke('in chat:tile:/work::1792-ab12cd: Also the receipts: all of them')
    expect(asks[0]).toMatchObject({ convoId: 'chat:tile:/work::1792-ab12cd', text: 'Also the receipts: all of them' })
  })

  it('reaches the hive itself at /', async () => {
    await new SayQueenBee().invoke('on /: What is in this hive?')
    expect(asks[0].convoId).toMatch(/^chat:tile:\/::\d+-/)
  })

  it('says a tile that is not there, and a line that names no place, and says nothing', async () => {
    await expect(new SayQueenBee().invoke('on /ghost: hello')).rejects.toThrow('there is no tile at /ghost')
    await expect(new SayQueenBee().invoke('on work: hello')).rejects.toThrow('begins with /')
    await expect(new SayQueenBee().invoke('in work: hello')).rejects.toThrow('is not a conversation id')
    await expect(new SayQueenBee().invoke('hello there')).rejects.toThrow('say where')
    await expect(new SayQueenBee().invoke('on /work:   ')).rejects.toThrow('say where')
    expect(asks).toEqual([])
  })

  it('is not offered to a model: there is no machine declaration', () => {
    expect((new SayQueenBee() as unknown as { machine?: unknown }).machine).toBeUndefined()
  })
})

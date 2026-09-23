// @vitest-environment jsdom
// The story word: a bundle under a signature becomes the game's story tile,
// or is refused whole with the reason; `list` says what the game holds.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as unknown as { __reg?: Record<string, unknown> }).__reg?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})
const surface = {
  plugStory: vi.fn(async (_id: string, _bundle: unknown, _seeds: readonly unknown[]) => { /* written */ }),
  readStories: vi.fn(async (): Promise<unknown[] | null> => null),
}
/** The hive's one hidden pool, as a set: what is put away, by signature. */
const hidden = new Map<string, { sig: string; scope: string; label: string; from: string; deletable: boolean; state: 'hidden' }>()
vi.mock('../concealment/concealment.js', () => ({
  conceal: async (item: { sig: string; scope: string; label: string; from: string; deletable: boolean }) => { hidden.set(item.sig, { ...item, state: 'hidden' }); return true },
  reveal: async (sig: string) => hidden.delete(sig),
  listConcealed: async () => [...hidden.values()],
}))
vi.mock('./solomon/tile-surface.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./solomon/tile-surface.js')>()),
  createSolomonTileSurface: () => surface,
}))
const { StoryQueenBee } = await import('./story.queen.js')
const { MOSSBACK_STORY } = await import('./solomon/mossback.story.js')

const SIG = 'a'.repeat(64)
const resources = new Map<string, string>()
const logs: string[] = []
EffectBus.on('activity:log', ({ message }: { message: string }) => logs.push(message))

beforeEach(() => {
  ;(window as unknown as { __reg: Record<string, unknown> }).__reg = {
    '@hypercomb.social/Store': {
      // What the store hands back is read by size and text() only — a blob's face.
      getResource: async (sig: string) => { const text = resources.get(sig); return text === undefined ? null : { size: text.length, text: async () => text } },
    },
  }
  resources.clear()
  hidden.clear()
  surface.plugStory.mockClear()
  surface.readStories.mockReset().mockResolvedValue(null)
  logs.length = 0
})

describe('story plug', () => {
  it('reads the bundle under a signature and writes it as the game’s story tile', async () => {
    resources.set(SIG, JSON.stringify(MOSSBACK_STORY))
    await new StoryQueenBee().invoke(`plug ${SIG}`)
    expect(surface.plugStory).toHaveBeenCalledTimes(1)
    expect(surface.plugStory.mock.calls[0]![0]).toBe('mossback')
    expect(surface.plugStory.mock.calls[0]![1]).toMatchObject({ id: 'mossback' })
    expect(surface.plugStory.mock.calls[0]![2].length).toBeGreaterThan(0) // the worked example rides along as the seed
    expect(logs.at(-1)).toContain('“The Mossback” is plugged in')
    expect(logs.at(-1)).toContain('1 place (mossback), 1 seat')
  })

  it('refuses whole — not a signature, nothing there, not JSON, not a bundle — and writes nothing', async () => {
    const queen = new StoryQueenBee()
    await queen.invoke('plug Not A Sig')
    expect(logs.at(-1)).toContain('64 hex characters')
    await queen.invoke(`plug ${SIG}`)
    expect(logs.at(-1)).toContain('Nothing is stored under')
    resources.set(SIG, '{not json')
    await queen.invoke(`plug ${SIG}`)
    expect(logs.at(-1)).toContain('is not JSON')
    resources.set(SIG, JSON.stringify({ version: 1, id: 'x', name: 'X', worlds: [{ id: 'nowhere' }] }))
    await queen.invoke(`plug ${SIG}`)
    expect(logs.at(-1)).toContain('not a story add-on the game can read')
    expect(surface.plugStory).not.toHaveBeenCalled()
  })

  it('says how it is spoken when the verb is missing', async () => {
    await new StoryQueenBee().invoke('')
    expect(logs.at(-1)).toContain('story plug <sig>')
  })
})

describe('story unplug', () => {
  it('puts an add-on away — hidden, never deleted — list says so, and plug <id> takes it back', async () => {
    surface.readStories.mockResolvedValue([MOSSBACK_STORY])
    const queen = new StoryQueenBee()
    await queen.invoke('unplug mossback')
    expect(logs.at(-1)).toContain('“The Mossback” is unplugged — put away, not deleted')
    expect([...hidden.values()]).toMatchObject([{ scope: 'solomon-story', label: 'The Mossback', deletable: false, state: 'hidden' }])
    await queen.invoke('list')
    expect(logs.at(-1)).toContain('The Mossback (mossback, unplugged)')
    await queen.invoke('plug mossback')
    expect(logs.at(-1)).toContain('“mossback” is plugged in again')
    expect(hidden.size).toBe(0)
    await queen.invoke('plug mossback')
    expect(logs.at(-1)).toContain('is plugged in already')
    await queen.invoke('unplug nobody')
    expect(logs.at(-1)).toContain('No story add-on called “nobody”')
  })

  it('plugging a bundle by signature takes it back out of hiding too', async () => {
    resources.set(SIG, JSON.stringify(MOSSBACK_STORY))
    surface.readStories.mockResolvedValue([MOSSBACK_STORY])
    const queen = new StoryQueenBee()
    await queen.invoke('unplug mossback')
    expect(hidden.size).toBe(1)
    await queen.invoke(`plug ${SIG}`)
    expect(hidden.size).toBe(0)
  })
})

describe('story list', () => {
  it('names each add-on with its places and seats, and what it cannot read', async () => {
    surface.readStories.mockResolvedValue([MOSSBACK_STORY, { nonsense: true }])
    await new StoryQueenBee().invoke('list')
    expect(logs.at(-1)).toContain('The Mossback (mossback): mossback; greenwood/grove-gate-sign → mossback')
    expect(logs.at(-1)).toContain('an add-on the game cannot read')
  })

  it('says so before the layer exists', async () => {
    await new StoryQueenBee().invoke('list')
    expect(logs.at(-1)).toContain('No story add-ons yet')
  })
})

describe('the word’s grammar', () => {
  it('completes its two verbs, and refuses a model a call it cannot make', () => {
    const queen = new StoryQueenBee()
    expect(queen.slashComplete('p')).toEqual(['plug'])
    expect(queen.slashComplete('')).toEqual(['plug', 'unplug', 'list'])
    expect(queen.machine.refuse!('unplug mossback')).toBeUndefined()
    expect(queen.machine.refuse!('unplug Not An Id')).toContain('id of an add-on')
    expect(queen.machine.refuse!('list')).toBeUndefined()
    expect(queen.machine.refuse!(`plug ${SIG}`)).toBeUndefined()
    expect(queen.machine.refuse!('plug Not An Id')).toContain('64-hex')
    expect(queen.machine.refuse!('')).toContain('plug <sig>, unplug <id> or list')
  })
})

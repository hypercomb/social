// slash-raw-args.spec.ts — A WORD THAT KEEPS ITS ARGUMENTS VERBATIM.
//
// `QueenBee.rawArgs` is the one opt-in: everything after the word is the
// word's, exactly as typed. The auto-wrap is where it lands for completion
// and execution — no dot walk is derived for such a queen (a model id ends
// `-4.5`, and the walk cut it to `-4`), no dot is turned back into a space on
// the way in, and the census answers `rawArgs()` so the command line can ask
// before it reads the line as tag grammar or as a sentence. A queen still
// asleep is woken first by `rawArgsAwake()`, for the doors that can wait.
//
// The other half of the rule is as load-bearing as the first: a word that
// does NOT say so is walked and un-dotted exactly as it always was.

import { describe, expect, it } from 'vitest'
import { EffectBus, commandRoot, completeCommandPath } from '@hypercomb/core'

const held = new Map<string, unknown>()
const listeners: ((key: string, value: unknown) => void)[] = []
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { held.set(key, value); for (const listener of listeners) listener(key, value) },
  get: (key: string) => held.get(key),
  list: () => [...held.keys()],
  whenReady: () => void 0,
  onRegister: (listener: (key: string, value: unknown) => void) => { listeners.push(listener) },
}
const ioc = (window as unknown as { ioc: { register(key: string, value: unknown): void; get(key: string): unknown } }).ioc

await import('./slash-behaviour.drone.js')
type Drone = InstanceType<typeof import('./slash-behaviour.drone.js').SlashBehaviourDrone>
const drone = ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as Drone

/** A queen as the auto-wrap sees one: a word, an invoke, a completer. */
const queen = (command: string, over: Record<string, unknown> = {}) => {
  const seen = { invoked: [] as string[], asked: [] as string[] }
  const bee = {
    command,
    description: `the ${command} word`,
    invoke: (args: string) => { seen.invoked.push(args) },
    slashComplete: (args: string) => {
      seen.asked.push(args)
      // Offers what may follow, the way a walked completer does: full args.
      return args.trimStart().startsWith('set') ? ['set steel', 'set some/model-4.5'] : ['set ']
    },
    ...over,
  }
  ioc.register(`@test/${command}`, bee)
  return seen
}

describe('a word that never said so', () => {
  const seen = queen('walked')

  it('is walked with dots, as every behaviour is', () => {
    const root = commandRoot('walked')
    expect(root).toBeDefined()
    expect(completeCommandPath(root!, 'set ')).toContain('set.steel')
  })

  it('has its walk turned back into the spaces its parser reads', async () => {
    await drone.execute('walked', 'set.steel')
    expect(seen.invoked).toEqual(['set steel'])
  })

  it('answers false, and its census row is the row it always was', () => {
    expect(drone.rawArgs('walked')).toBe(false)
    expect(drone.entries().find(entry => entry.name === 'walked')).not.toHaveProperty('rawArgs')
  })
})

describe('a word that keeps its arguments verbatim', () => {
  const seen = queen('verbatim', { rawArgs: true, aliases: ['kept'] })

  it('gets no derived walk, so the command line asks her own completer', () => {
    expect(commandRoot('verbatim')).toBeUndefined()
  })

  it('is asked with the real arguments, and her offers come back whole', () => {
    seen.asked.length = 0
    expect(drone.complete('verbatim', 'set some')).toEqual(['set steel', 'set some/model-4.5'])
    expect(seen.asked).toEqual(['set some'])
  })

  it('is handed a dotted argument exactly as typed — even one that spells a walk', async () => {
    await drone.execute('verbatim', 'drop anthropic/claude-sonnet-4.5')
    await drone.execute('verbatim', 'add deepseek/deepseek-r1:free deep')
    await drone.execute('verbatim', 'set.steel')
    expect(seen.invoked).toEqual([
      'drop anthropic/claude-sonnet-4.5',
      'add deepseek/deepseek-r1:free deep',
      'set.steel',
    ])
  })

  it('says so to the census, under every name that reaches her', () => {
    expect(drone.rawArgs('verbatim')).toBe(true)
    expect(drone.rawArgs('Verbatim ')).toBe(true)
    expect(drone.rawArgs('kept')).toBe(true)
    expect(drone.entries().find(entry => entry.name === 'verbatim')).toMatchObject({ rawArgs: true })
  })
})

describe('everything else', () => {
  it('answers false: a hand-written provider, and a word nobody claims', () => {
    expect(drone.has('help')).toBe(true)
    expect(drone.rawArgs('help')).toBe(false)
    expect(drone.rawArgs('nobody-claims-this')).toBe(false)
    expect(drone.rawArgs('')).toBe(false)
  })

})

describe('a queen still asleep', () => {
  // The runtime's side of the wake, as the drone reaches it: `wakeWord` loads
  // her module, and loading registers her.
  const woken: string[] = []
  const asleep = new Map<string, Record<string, unknown>>()
  ioc.register('@hypercomb.social/ScriptPreloader', {
    wakeWord: async (word: string) => {
      woken.push(word)
      const over = asleep.get(word)
      if (!over) throw new Error(`no module for ${word}`)
      asleep.delete(word)
      queen(word, over)
    },
  })
  const sleeps = (command: string, over: Record<string, unknown>, table: Record<string, unknown> = {}) => {
    asleep.set(command, over)
    EffectBus.emit('loader:sleeping', { words: [{ command, description: 'asleep until her word', ...table }] })
  }

  it('answers false from a table that carries her word only, and true once she wakes', () => {
    // Her stand-in is built from the sleeper table; a table that does not say
    // leaves the flag to arrive with the queen herself.
    sleeps('dozing', { rawArgs: true })
    expect(drone.has('dozing')).toBe(true)
    expect(drone.rawArgs('dozing')).toBe(false)

    queen('dozing', { rawArgs: true })
    expect(drone.rawArgs('dozing')).toBe(true)
    expect(commandRoot('dozing')).toBeUndefined()
  })

  it('is woken before she is asked, by a caller that can wait', async () => {
    // The whole-line doors (add sheet, bridge, recall) run no completion, so
    // nothing woke her — and the plain question took `/word x/y:free` for a tag.
    sleeps('napping', { rawArgs: true })
    expect(drone.rawArgs('napping')).toBe(false)
    woken.length = 0

    expect(await drone.rawArgsAwake('Napping ')).toBe(true)
    expect(woken).toEqual(['napping'])
    expect(drone.rawArgs('napping')).toBe(true)

    // Awake now: asked again, nobody is woken.
    expect(await drone.rawArgsAwake('napping')).toBe(true)
    expect(woken).toEqual(['napping'])
  })

  it('is woken and still answers false when she never said so', async () => {
    sleeps('resting', {})
    woken.length = 0
    expect(await drone.rawArgsAwake('resting')).toBe(false)
    expect(woken).toEqual(['resting'])
    expect(commandRoot('resting')).toBeDefined()   // walked, as every such word is
  })

  it('answers from her stand-in when the table carries the flag — no wake needed', async () => {
    sleeps('slumbering', { rawArgs: true }, { rawArgs: true })
    woken.length = 0
    expect(drone.rawArgs('slumbering')).toBe(true)
    expect(drone.entries().find(entry => entry.name === 'slumbering')).toMatchObject({ rawArgs: true })
    expect(await drone.rawArgsAwake('slumbering')).toBe(true)
    expect(woken).toEqual([])
  })

  it('keeps the stand-in answer when the wake fails, rather than stranding the line', async () => {
    EffectBus.emit('loader:sleeping', { words: [{ command: 'unwakeable', description: 'her module is gone' }] })
    woken.length = 0
    expect(await drone.rawArgsAwake('unwakeable')).toBe(false)
    expect(woken).toEqual(['unwakeable'])
  })

  it('wakes nobody for a word that was never asleep', async () => {
    woken.length = 0
    expect(await drone.rawArgsAwake('verbatim')).toBe(true)
    expect(await drone.rawArgsAwake('walked')).toBe(false)
    expect(await drone.rawArgsAwake('help')).toBe(false)
    expect(await drone.rawArgsAwake('nobody-claims-this')).toBe(false)
    expect(await drone.rawArgsAwake('')).toBe(false)
    expect(woken).toEqual([])
  })
})

// slash-retired.spec.ts — A WORD THAT NO LONGER RUNS says what to say instead.
//
// Retirements are declared in code by the module that retired the word, the
// way a view keeps its `legacyKinds` — never a pool anyone can append to. And
// they are read ONLY on a miss: a word any live provider claims is never
// answered as retired, so a record can explain a missing word but can never
// switch off a live one. That second half is the property worth guarding.

import { describe, expect, it } from 'vitest'

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

// The participant's own names, which the census folds in live.
const given = new Map<string, string[]>()
ioc.register('@diamondcoreprocessor.com/ParticipantAliases', {
  aliasesFor: (command: string) => given.get(command) ?? [],
})

await import('./slash-behaviour.drone.js')
type Drone = InstanceType<typeof import('./slash-behaviour.drone.js').SlashBehaviourDrone>
const drone = ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as Drone

const HISTORY_NOTE = 'archiving the middle of a history publishes less than you had'

describe('the words this census retired', () => {
  it('/delete and /del were renamed: /remove does it now', () => {
    expect(drone.retired('delete')).toEqual({ word: 'delete', by: 'remove' })
    expect(drone.retired('del')).toEqual({ word: 'del', by: 'remove' })
    // Not an alias — no code may declare one — so the word itself does not run.
    expect(drone.has('delete')).toBe(false)
  })

  it('/flatten, /compact and /collapse-history went with their act, and nothing replaces them', () => {
    for (const word of ['flatten', 'compact', 'collapse-history']) {
      expect(drone.retired(word)).toEqual({ word, note: HISTORY_NOTE })
    }
  })

  it('folds the word as the registry folds a name', () => {
    expect(drone.retired('  Delete ')).toEqual({ word: 'delete', by: 'remove' })
  })

  it('answers nothing for a word that was never retired, or no word', () => {
    expect(drone.retired('nobody-said-this')).toBeUndefined()
    expect(drone.retired('')).toBeUndefined()
    expect(drone.retired('   ')).toBeUndefined()
  })
})

describe('live always wins', () => {
  it('a participant who gives the old word back gets it back — the record is never read', () => {
    given.set('remove', ['delete'])
    try {
      expect(drone.has('delete')).toBe(true)
      expect(drone.retired('delete')).toBeUndefined()
    } finally {
      given.delete('remove')
    }
    expect(drone.retired('delete')).toEqual({ word: 'delete', by: 'remove' })
  })

  it('a behaviour that takes a retired word again simply runs under it', () => {
    ioc.register('@test/CompactQueenBee', {
      command: 'compact',
      description: 'a new word that happens to share an old name',
      invoke: () => {},
    })
    expect(drone.has('compact')).toBe(true)
    expect(drone.retired('compact')).toBeUndefined()
  })

  it('so a record can explain a missing word, but cannot switch off a live one', () => {
    drone.retire({ word: 'help', note: 'a record that should never be read' })
    expect(drone.has('help')).toBe(true)
    expect(drone.retired('help')).toBeUndefined()
  })
})

describe('retire', () => {
  it('folds the word it is given, and ignores no word at all', () => {
    drone.retire({ word: '  Vanished ', by: 'remove' })
    expect(drone.retired('vanished')).toEqual({ word: 'vanished', by: 'remove' })
    drone.retire({ word: '   ', by: 'remove' })
    expect(drone.retired('')).toBeUndefined()
  })
})

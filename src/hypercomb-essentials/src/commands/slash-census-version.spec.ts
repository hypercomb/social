// slash-census-version.spec.ts — THE CENSUS IS COMPUTED ONCE PER CHANGE.
//
// Boot adds a provider per queen and the command line reads the lexicon on
// every keystroke. Neither may pay for the whole census each time: the drone
// keeps a version, bumps it when a provider comes or goes (or when it is told
// the census changed shape from outside), and everything derived — the name
// set behind `has`, the entries the utterance reader reads — is rebuilt only
// when the version moved.

import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
  list: () => [],
  onRegister: () => void 0,
}

const { SlashBehaviourDrone } = await import('./slash-behaviour.drone.js')
type Drone = InstanceType<typeof SlashBehaviourDrone>

const provider = (name: string, priority: number, ...words: string[]) => ({
  name,
  priority,
  behaviours: words.map(word => ({ name: word, description: `${word} it` })),
  execute: () => {},
})

let drone: Drone
beforeEach(() => {
  localStorage.clear()
  drone = new SlashBehaviourDrone()
})

describe('the census version', () => {
  it('hands back the same entries until a provider comes or goes', () => {
    drone.addProvider(provider('one', 50, 'alpha'))
    const first = drone.entries()
    expect(drone.entries()).toBe(first)
    expect(drone.version).toBe(1)

    const extra = provider('two', 50, 'beta')
    drone.addProvider(extra)
    const second = drone.entries()
    expect(second).not.toBe(first)
    expect(second.map(e => e.name)).toEqual(['alpha', 'beta'])

    drone.removeProvider(extra)
    expect(drone.entries().map(e => e.name)).toEqual(['alpha'])
    expect(drone.version).toBe(3)
  })

  it('answers has() from one name set per version, and sees a removal at once', () => {
    const standIn = provider('asleep-gamma', 50, 'gamma')
    drone.addProvider(standIn)
    expect(drone.has('gamma')).toBe(true)
    expect(drone.has('GAMMA ')).toBe(true)
    drone.removeProvider(standIn)
    expect(drone.has('gamma')).toBe(false)
  })

  it('sorts once, after the batch: a higher priority added later still wins the name', () => {
    const ran: string[] = []
    drone.addProvider({ ...provider('low', 10, 'shared'), execute: () => { ran.push('low') } })
    drone.addProvider({ ...provider('high', 100, 'shared'), execute: () => { ran.push('high') } })
    drone.execute('shared', '')
    expect(ran).toEqual(['high'])
  })

  it('invalidate() rebuilds the entries without a provider changing', () => {
    drone.addProvider(provider('one', 50, 'alpha'))
    const before = drone.entries()
    drone.invalidate()
    expect(drone.entries()).not.toBe(before)
    expect(drone.entries().map(e => e.name)).toEqual(['alpha'])
  })

  it('the prototypes filter is part of the key: opening it changes what is presented', () => {
    drone.addProvider({
      name: 'shelf', priority: 50, execute: () => {},
      behaviours: [{ name: 'workbench', description: 'in the workshop', prototype: true }],
    })
    expect(drone.entries()[0]?.hidden).toBe(true)
    localStorage.setItem('hc:prototypes-shown', 'on')
    expect(drone.entries()[0]?.hidden).toBeUndefined()
  })
})

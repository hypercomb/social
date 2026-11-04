// hypercomb-core/src/core/hypercomb.latch.spec.ts
//
// The processor is single flight: one pass at a time, one trailing pass that
// carries the union of every grammar asked for meanwhile, one `synchronize`
// per pass. And the first pulse of a bee registered after the first act is
// the processor's — once, in a pass, never by the module that loaded it.

import { beforeEach, describe, expect, it } from 'vitest'
import { register } from '../ioc/ioc.js'
import { BEE_RESOLVER_KEY } from './bee-resolver.js'
import { hypercomb } from './hypercomb.js'

type Listener = (key: string, value: unknown) => void
const listeners = new Set<Listener>()
const fakeIoc = {
  onRegister: (cb: Listener): (() => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
  register: (key: string, value: unknown): void => { for (const cb of [...listeners]) cb(key, value) },
  list: (): string[] => [],
  get: (): unknown => undefined,
}
;(globalThis as { ioc?: unknown }).ioc = fakeIoc

const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** The resolver the processor sees; each test swaps what it answers. */
let answer: (grammar: string) => Promise<unknown[]> = async () => []
const finds: string[] = []
register(BEE_RESOLVER_KEY, {
  find: async (grammar: string) => { finds.push(grammar); return answer(grammar) },
})

const pulses: Array<[string, string]> = []
const bee = (name: string, fail = false) => ({
  iocKey: `@test.com/${name}`,
  pulse: async (grammar: string) => {
    pulses.push([name, grammar])
    if (fail) throw new Error(`boom:${name}`)
  },
})

let synchronized = 0
window.addEventListener('synchronize', () => { synchronized++ })

beforeEach(async () => {
  // Let any pass from the previous test drain before counting again.
  await tick(5)
  finds.length = 0
  pulses.length = 0
  synchronized = 0
  answer = async () => []
})

describe('hypercomb.act — the latch', () => {
  it('calls landing mid-pass share ONE trailing pass carrying the union of grammars', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const bees = [bee('a'), bee('b')]
    answer = async (grammar) => { if (grammar === 'one') await gate; return bees }

    const first = new hypercomb().act('one')
    await tick()
    const second = new hypercomb().act('two')
    const third = new hypercomb().act('three')
    const again = new hypercomb().act('two')
    expect(finds).toEqual(['one'])

    release()
    await Promise.all([first, second, third, again])

    // one pass for `one`, one trailing pass for the rest — each grammar once
    expect(finds).toEqual(['one', 'two', 'three'])
    expect(synchronized).toBe(2)
    // (a first pulse is always '' — see below — so the first pass gives each
    // newcomer '' before 'one')
    expect(pulses).toEqual([
      ['a', ''], ['a', 'one'], ['b', ''], ['b', 'one'],
      ['a', 'two'], ['b', 'two'],
      ['a', 'three'], ['b', 'three'],
    ])
  })

  it('await act(g) resolves only once a pass that carried g has pulsed the bees', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const bees = [bee('a')]
    answer = async (grammar) => { if (grammar === 'slow') await gate; return bees }

    const slow = new hypercomb().act('slow')
    await tick()
    let seenAtResolve: Array<[string, string]> = []
    const mine = new hypercomb().act('mine').then(() => { seenAtResolve = [...pulses] })

    release()
    await Promise.all([slow, mine])
    expect(seenAtResolve).toContainEqual(['a', 'mine'])
  })

  it('a bee that throws neither silences the bees after it nor skips synchronize — the pass still rejects', async () => {
    answer = async () => [bee('first', true), { iocKey: '@test.com/Plain' }, bee('last')]
    await expect(new hypercomb().act('x')).rejects.toThrow('boom:first')
    expect(pulses).toEqual([['first', ''], ['first', 'x'], ['last', ''], ['last', 'x']])
    expect(synchronized).toBe(1)
  })

  it('a bee registered while the processor is idle gets exactly one first pulse, in a pass of its own', async () => {
    const late = bee('late')
    fakeIoc.register('@test.com/late', late)
    fakeIoc.register('@test.com/plain', { iocKey: '@test.com/Plain' })   // no pulse: ignored
    expect(pulses).toEqual([])

    await tick(80)
    expect(pulses).toEqual([['late', '']])
    expect(synchronized).toBe(1)

    // the processor remembers it: another registration of the same bee is not an arrival
    fakeIoc.register('@test.com/late-again', late)
    await tick(80)
    expect(pulses).toEqual([['late', '']])
    expect(synchronized).toBe(1)
  })

  it('a bee registered during a pass is pulsed inside that pass; one the resolver returned is not pulsed twice', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const found = bee('found')
    const during = bee('during')
    answer = async () => {
      // what a loading resolver does: modules register as they evaluate
      fakeIoc.register('@test.com/found', found)
      fakeIoc.register('@test.com/during', during)
      await gate
      return [found]
    }

    const pass = new hypercomb().act('g')
    await tick()
    release()
    await pass
    await tick(80)

    expect(pulses).toEqual([['found', ''], ['found', 'g'], ['during', '']])
    expect(synchronized).toBe(1)
  })

  it("a bee's first pulse is the empty grammar, even when it first meets the processor under a word", async () => {
    const newcomer = bee('newcomer')
    answer = async () => [newcomer]
    await new hypercomb().act('word')
    await new hypercomb().act('other')
    expect(pulses).toEqual([['newcomer', ''], ['newcomer', 'word'], ['newcomer', 'other']])
    expect(synchronized).toBe(2)
  })

  it('the census counts pulses per bee per grammar and passes', () => {
    const census = hypercomb.census()
    expect(census.passes).toBeGreaterThan(0)
    expect(census.synchronizes).toBe(census.passes)
    expect(census.pulses['@test.com/a']?.['one']).toBe(1)
  })
})

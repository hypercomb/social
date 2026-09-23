// ui/command-line/word-arrival.spec.ts — a word still loading is not an
// unknown word, and a line that leads with one waits for it.
//
// 2026-09-23: `module commit …` said right after a reload, while the module
// bee was still loading, became a tile named after the whole line.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { leadWordOf, WordArrival } from './word-arrival'

const CENSUS_KEY = '@diamondcoreprocessor.com/SlashBehaviourDrone'
const PATIENCE = 1_000

/** An EffectBus with last-value replay, private to one test. */
const fakeBus = () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const last = new Map<string, unknown>()
  return {
    on<T>(effect: string, handler: (payload: T) => void): () => void {
      let set = handlers.get(effect)
      if (!set) handlers.set(effect, set = new Set())
      set.add(handler as (payload: unknown) => void)
      if (last.has(effect)) handler(last.get(effect) as T)
      return () => { set!.delete(handler as (payload: unknown) => void) }
    },
    emit(effect: string, payload: unknown = {}): void {
      last.set(effect, payload)
      for (const fn of [...(handlers.get(effect) ?? [])]) fn(payload)
    },
    listening(effect: string): number { return handlers.get(effect)?.size ?? 0 },
  }
}

/** An IoC whose census claims `claimed`; `register` is a bee arriving and its
 *  queen joining the census, as SlashBehaviourDrone does on onRegister, and
 *  `provide` is any other service registering. */
const fakeHive = (claimed: readonly string[] = []) => {
  const words = new Set(claimed)
  const services = new Map<string, unknown>()
  const listeners: ((key: string, value: unknown) => void)[] = []
  const census = { has: (name: string): boolean => words.has(name.trim().toLowerCase()) }
  const announce = (key: string): void => { for (const cb of [...listeners]) cb(key, {}) }
  return {
    ioc: {
      get: (key: string): unknown => key === CENSUS_KEY ? census : services.get(key),
      onRegister: (cb: (key: string, value: unknown) => void): (() => void) => {
        listeners.push(cb)
        return () => { const at = listeners.indexOf(cb); if (at >= 0) listeners.splice(at, 1) }
      },
    },
    register(word: string, claims = true): void {
      if (claims) words.add(word)
      announce(`@test/${word}`)
    },
    provide(key: string): void {
      services.set(key, {})
      announce(key)
    },
    listening: (): number => listeners.length,
  }
}

const setup = (claimed: readonly string[] = [], emitted: readonly string[] = []) => {
  const bus = fakeBus()
  for (const effect of emitted) bus.emit(effect)
  const hive = fakeHive(claimed)
  const clock = { now: 0 }
  const arrival = new WordArrival({ bus, ioc: () => hive.ioc, now: () => clock.now, patienceMs: PATIENCE })
  return { bus, hive, clock, arrival }
}

/** Resolves true when `promise` has settled by the time the queue drains. */
const settledNow = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false
  void promise.then(() => { done = true })
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return done
}

afterEach(() => { vi.useRealTimers() })

describe('leadWordOf — the name a behaviour would answer to', () => {
  it('reads the first word, through one slash, a call paren or a bracket', () => {
    expect(leadWordOf('module commit proof-x-mine @content.localhost:4291')).toBe('module')
    expect(leadWordOf('/module commit x')).toBe('module')
    expect(leadWordOf('  Module list')).toBe('module')
    expect(leadWordOf('/move(5)')).toBe('move')
    expect(leadWordOf('/delete[a,b]')).toBe('delete')
    expect(leadWordOf('push-to-talk on')).toBe('push-to-talk')
    expect(leadWordOf('help?')).toBe('help')
  })

  it('is empty for a line in a register of its own, which never looks a word up', () => {
    for (const line of ['', '   ', '~tile', '[a,b]/cut', '#tag', '?where', '>', '..', '.hidden',
      'name:tag', 'abc@gallery', 'https://example.com/a', 'www.example.com', '//x']) {
      expect(leadWordOf(line), line).toBe('')
    }
  })
})

describe('WordArrival — is a miss final yet?', () => {
  it('lets an unclaimed word wait while bees load, and never a claimed word or a non-word', () => {
    const { arrival } = setup(['create'])
    expect(arrival.mayStillArrive('module')).toBe(true)
    expect(arrival.mayStillArrive('create')).toBe(false)
    expect(arrival.mayStillArrive('')).toBe(false)
    expect(arrival.mayStillArrive('~tile')).toBe(false)
  })

  it('makes every miss final once the loader has settled, and open again when a new wave starts', () => {
    const { bus, arrival } = setup()
    bus.emit('loader:bees-progress')
    expect(arrival.mayStillArrive('module')).toBe(true)
    bus.emit('loader:bees-done')
    expect(arrival.mayStillArrive('module')).toBe(false)
    bus.emit('loader:bees-progress')
    expect(arrival.mayStillArrive('module')).toBe(true)
  })

  it('starts where the loader already is when built late (last values replay)', () => {
    expect(setup([], ['loader:bees-progress']).arrival.mayStillArrive('module')).toBe(true)
    expect(setup([], ['loader:bees-progress', 'loader:bees-done']).arrival.mayStillArrive('module')).toBe(false)
  })

  it('does not know a claimed word at a door until what that door reads it through is there too', () => {
    // Remote prose is read by the utterance reader: the census knowing `module`
    // is not enough while the reader has not registered.
    const { hive, arrival } = setup(['module'])
    expect(arrival.mayStillArrive('module')).toBe(false)
    expect(arrival.mayStillArrive('module', ['@test/Reader'])).toBe(true)
    hive.provide('@test/Reader')
    expect(arrival.mayStillArrive('module', ['@test/Reader'])).toBe(false)
  })

  it('stops waiting once the patience since the loader started has run out', () => {
    const { bus, clock, arrival } = setup()
    clock.now = PATIENCE - 1
    expect(arrival.mayStillArrive('module')).toBe(true)
    clock.now = PATIENCE
    expect(arrival.mayStillArrive('module')).toBe(false)
    bus.emit('loader:bees-progress') // a new wave restarts the patience
    expect(arrival.mayStillArrive('module')).toBe(true)
  })
})

describe('WordArrival.arrival — the line is decided again when there is news', () => {
  it('resolves at once for a word that is already claimed', async () => {
    const { arrival } = setup(['create'])
    await expect(arrival.arrival('create')).resolves.toBe(true)
  })

  it('waits through other registrations and resolves when its own word registers', async () => {
    const { hive, arrival } = setup()
    const waiting = arrival.arrival('module')
    hive.register('paint', true)
    expect(await settledNow(waiting)).toBe(false)
    hive.register('module')
    expect(await settledNow(waiting)).toBe(true)
    await expect(waiting).resolves.toBe(true)
    expect(hive.listening()).toBe(0)
  })

  it('waits for what the door reads the word through, once the word itself is claimed', async () => {
    const { hive, arrival } = setup()
    const waiting = arrival.arrival('module', ['@test/Reader'])
    hive.register('module')
    expect(await settledNow(waiting)).toBe(false)
    hive.provide('@test/Reader')
    await expect(waiting).resolves.toBe(true)
  })

  it('resolves when the loader settles without the word ever arriving', async () => {
    const { bus, hive, arrival } = setup()
    const waiting = arrival.arrival('zebra')
    expect(await settledNow(waiting)).toBe(false)
    bus.emit('loader:bees-done')
    await expect(waiting).resolves.toBe(true)
    expect(hive.listening()).toBe(0)
  })

  it('resolves when the patience runs out, and not before', async () => {
    vi.useFakeTimers()
    const { clock, arrival } = setup()
    const waiting = arrival.arrival('zebra')
    clock.now = PATIENCE - 10
    await vi.advanceTimersByTimeAsync(PATIENCE - 10)
    expect(await settledNow(waiting)).toBe(false)
    clock.now = PATIENCE + 1
    await vi.advanceTimersByTimeAsync(20)
    await expect(waiting).resolves.toBe(true)
  })

  it('re-arms when a new wave moves the patience', async () => {
    vi.useFakeTimers()
    const { bus, clock, arrival } = setup()
    const waiting = arrival.arrival('zebra')
    clock.now = PATIENCE / 2
    bus.emit('loader:bees-progress') // patience now runs to 1.5 × PATIENCE
    clock.now = PATIENCE + 1
    await vi.advanceTimersByTimeAsync(PATIENCE + 1)
    expect(await settledNow(waiting)).toBe(false)
    clock.now = PATIENCE * 1.5 + 1
    await vi.advanceTimersByTimeAsync(PATIENCE)
    await expect(waiting).resolves.toBe(true)
  })

  it('lets every waiting line go without running when disposed', async () => {
    const { bus, hive, arrival } = setup()
    const waiting = arrival.arrival('module')
    arrival.dispose()
    await expect(waiting).resolves.toBe(false)
    expect(arrival.mayStillArrive('module')).toBe(false)
    await expect(arrival.arrival('module')).resolves.toBe(false)
    expect(hive.listening()).toBe(0)
    expect(bus.listening('loader:bees-done') + bus.listening('loader:bees-progress')).toBe(0)
  })
})

describe('the command line waits where a word is looked up', () => {
  const src = readFileSync(join(process.cwd(), 'hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts'), 'utf8')
  const between = (from: string, to: string): string => {
    const start = src.indexOf(from)
    expect(start, from).toBeGreaterThan(-1)
    return src.slice(start, src.indexOf(to, start))
  }

  it('the remote door waits BEFORE the admission gate, so the gate judges the real census row', () => {
    const door = between('REMOTE_SUBMIT, ({ text, accept, complete })', '// voice active state sync')
    const wait = door.indexOf('this.#remoteLineWaits(')
    expect(wait).toBeGreaterThan(-1)
    expect(wait).toBeLessThan(door.indexOf('admitMachineCall('))
    // …and nothing it hands on may wait AFTER the gate
    expect(door.includes('#preprocessTagsThenExecute(text, true)')).toBe(true)
    expect(between('#remoteLineWaits(text: string', '#sayItWaits(word: string')).toContain('mayStillArrive(')
  })

  it('the slash executor waits before its unknown-command door can make a tile', () => {
    const slash = between('readonly #executeSlashBehaviour = async', '// /select[...] command execution')
    const wait = slash.indexOf('mayStillArrive(')
    expect(wait).toBeGreaterThan(-1)
    expect(wait).toBeLessThan(slash.indexOf('this.commitCreateCellInPlace()'))
  })

  it('the reader waits before it reads a line against a census still filling', () => {
    const reader = between('#commitUtterance(text: string', '/** The sentence is the transaction')
    const wait = reader.indexOf('mayStillArrive(')
    expect(wait).toBeGreaterThan(-1)
    expect(wait).toBeLessThan(reader.indexOf('reading.spans.find('))
  })
})

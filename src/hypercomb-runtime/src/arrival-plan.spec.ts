// arrival-plan.spec.ts — a published arrival loads what its plan names, and
// what those bees declare they read; nothing else.

import { afterEach, describe, expect, it } from 'vitest'
import { arrivalNames, beeClassesOfDocs, classOfKey, guardArrival, resolveArrival, type BeeClass } from './arrival-plan'

const sig = (c: string): string => c.repeat(64)

const docs = {
  bees: {
    [`${sig('a')}.js`]: { className: 'SiteViewDrone', deps: { store: '@hypercomb.social/Store', links: '@diamondcoreprocessor.com/LinkService' } },
    [sig('b')]: { className: 'LinkService', deps: {} },
    [sig('c')]: { className: 'ShowCellDrone', deps: { site: '@diamondcoreprocessor.com/SiteViewDrone' } },
    [sig('d')]: { className: 'GameViewDrone' },
    'not-a-sig': { className: 'Broken' },
  },
}

const index = (): Map<string, BeeClass> => new Map(beeClassesOfDocs(docs))
const all = new Set([sig('a'), sig('b'), sig('c'), sig('d')])

describe('arrival plan', () => {
  afterEach(() => { delete (globalThis as { __hcArrival?: unknown }).__hcArrival })

  it('reads the class index from layer docs, stripping .js and skipping non-signatures', () => {
    const classes = index()
    expect(classes.get('SiteViewDrone')?.sig).toBe(sig('a'))
    expect(classes.get('SiteViewDrone')?.needs).toEqual(['@hypercomb.social/Store', '@diamondcoreprocessor.com/LinkService'])
    expect(classes.has('Broken')).toBe(false)
  })

  it('names by IoC key or class; the key survives a rebuild, the signature does not', () => {
    expect(classOfKey('@diamondcoreprocessor.com/SiteViewDrone')).toBe('SiteViewDrone')
    expect(classOfKey('SiteViewDrone')).toBe('SiteViewDrone')
  })

  it('loads the named faces and what they declare they read — transitively, nothing more', () => {
    const { bees, missing } = resolveArrival(['@diamondcoreprocessor.com/SiteViewDrone'], index(), all)
    expect([...bees].sort()).toEqual([sig('a'), sig('b')])
    // The Store is a shell service, not a bee: a need, not a gap.
    expect(missing).toEqual([])
  })

  it('reports a named face the package does not carry', () => {
    const { bees, missing } = resolveArrival(['GameViewDrone', 'ArcadeDrone'], index(), all)
    expect([...bees]).toEqual([sig('d')])
    expect(missing).toEqual(['ArcadeDrone'])
  })

  it('never reaches outside the package inventory', () => {
    const { bees } = resolveArrival(['ShowCellDrone'], index(), new Set([sig('c')]))
    expect([...bees]).toEqual([sig('c')])
  })

  it('reads the plan the shell started fetching; absent, empty or slow is no plan', async () => {
    expect(await arrivalNames()).toBeNull()
    ;(globalThis as { __hcArrival?: unknown }).__hcArrival = Promise.resolve(['@x.com/A', ' ', 'B'])
    expect(await arrivalNames()).toEqual(['@x.com/A', 'B'])
    ;(globalThis as { __hcArrival?: unknown }).__hcArrival = Promise.resolve([])
    expect(await arrivalNames()).toBeNull()
    ;(globalThis as { __hcArrival?: unknown }).__hcArrival = new Promise(() => {})
    expect(await arrivalNames(20)).toBeNull()
  })
})

describe('a planned arrival that stalls wakes the rest', () => {
  // A bus with last-value replay, like the real one, and a clock the test turns.
  const harness = () => {
    const last = new Map<string, unknown>()
    const subs = new Map<string, Set<(p: unknown) => void>>()
    const bus = {
      on<T>(effect: string, handler: (payload: T) => void): () => void {
        const set = subs.get(effect) ?? new Set()
        subs.set(effect, set)
        const h = handler as (p: unknown) => void
        set.add(h)
        if (last.has(effect)) h(last.get(effect))
        return () => { set.delete(h) }
      },
    }
    const emit = (effect: string, payload: unknown): void => { last.set(effect, payload); for (const h of [...(subs.get(effect) ?? [])]) h(payload) }
    let pending: { run: () => void; at: number } | null = null
    let now = 0
    const timers = { set: (run: () => void, ms: number) => (pending = { run, at: now + ms }), clear: () => { pending = null } }
    const advance = (ms: number): void => { now += ms; if (pending && pending.at <= now) { const p = pending; pending = null; p.run() } }
    const listeners = (): number => [...subs.values()].reduce((n, set) => n + set.size, 0)
    return { bus, emit, timers, advance, listeners }
  }

  it('a view opening is the plan working: nothing wakes, and the watch lets go', () => {
    const h = harness(), woke: string[] = []
    guardArrival(h.bus, r => woke.push(r), 2500, h.timers)
    h.emit('loader:bees-done', { loaded: 3 })
    h.advance(1000)
    h.emit('view:arrival', { view: 'website' })
    h.advance(5000)
    expect(woke).toEqual([])
    expect(h.listeners()).toBe(0)
  })

  it('opening as hexagons wakes everything at once', () => {
    const h = harness(), woke: string[] = []
    guardArrival(h.bus, r => woke.push(r), 2500, h.timers)
    h.emit('view:arrival', { view: '' })
    expect(woke).toEqual(['hexagons'])
  })

  it('no verdict within the grace after the planned bees are in wakes everything, once', () => {
    const h = harness(), woke: string[] = []
    guardArrival(h.bus, r => woke.push(r), 2500, h.timers)
    h.advance(10_000)
    expect(woke).toEqual([])                   // the grace counts from the bees being in, not from the start
    h.emit('loader:bees-done', { loaded: 3 })
    h.advance(2400)
    expect(woke).toEqual([])
    h.advance(200)
    expect(woke).toEqual(['stalled'])
    h.emit('view:arrival', { view: '' })
    expect(woke).toEqual(['stalled'])
    expect(h.listeners()).toBe(0)
  })

  it('a verdict replayed as the watch subscribes settles it, and leaves nothing subscribed', () => {
    const h = harness(), woke: string[] = []
    h.emit('view:arrival', { view: 'website' })
    guardArrival(h.bus, r => woke.push(r), 2500, h.timers)
    h.emit('loader:bees-done', { loaded: 3 })
    h.advance(5000)
    expect(woke).toEqual([])
    expect(h.listeners()).toBe(0)
  })
})

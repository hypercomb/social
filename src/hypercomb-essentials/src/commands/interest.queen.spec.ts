// commands/interest.queen.spec.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as any).__reg?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const known: string[] = []
vi.mock('../pheromones/pheromone-deposits.js', () => ({
  knownPheromoneKinds: async () => known,
}))

const { InterestQueenBee } = await import('./interest.queen.js')

/** A minimal double of InterestRegistry — real enough that the queen's own
 *  add/remove logic (which role a mark lands in, whether a role auto-creates)
 *  is what's under test, not a mock's canned answers. */
class FakeRegistry {
  #interests = new Map<string, string[]>()
  roles: { keep?: string; drop?: string } = {}
  async ensureLoaded(): Promise<void> { /* already "loaded" */ }
  marks(name: string): string[] { return this.#interests.get(name) ?? [] }
  async save(name: string, marks: string[]): Promise<string> {
    this.#interests.set(name, marks)
    return name
  }
  async setRole(role: 'keep' | 'drop', name: string): Promise<boolean> {
    this.roles[role] = name
    return true
  }
}

let reg: FakeRegistry
let logs: string[] = []

beforeEach(() => {
  reg = new FakeRegistry()
  ;(window as any).__reg = { '@hypercomb.social/InterestRegistry': reg }
  logs = []
  known.length = 0
  EffectBus.on('activity:log', ({ message }: { message: string }) => logs.push(message))
})

describe('/interest', () => {
  it('adding a mark with no role yet creates one and sets KEEP', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('cigars')
    expect(reg.roles.keep).toBe('keep')
    expect(reg.marks('keep')).toEqual(['cigars'])
  })

  it('adding is idempotent', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('cigars')
    await queen.invoke('cigars')
    expect(reg.marks('keep')).toEqual(['cigars'])
  })

  it('several comma-separated marks land in one call', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('cigars, travel')
    expect(reg.marks('keep')).toEqual(['cigars', 'travel'])
  })

  it('! adds to DROP, a separate role from KEEP', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('!malicious')
    expect(reg.roles.drop).toBe('drop')
    expect(reg.marks('drop')).toEqual(['malicious'])
    expect(reg.roles.keep).toBeUndefined()
  })

  it('~ removes a mark from whichever role holds it', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('cigars')
    await queen.invoke('~cigars')
    expect(reg.marks('keep')).toEqual([])
  })

  it('~ finds a mark in DROP just as well as KEEP', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('!malicious')
    await queen.invoke('~malicious')
    expect(reg.marks('drop')).toEqual([])
  })

  it('respects an existing custom-named role instead of creating a new one', async () => {
    await reg.save('my-filter', ['existing'])
    await reg.setRole('keep', 'my-filter')
    const queen = new InterestQueenBee()
    await queen.invoke('cigars')
    expect(reg.marks('my-filter')).toEqual(['existing', 'cigars'])
    expect(reg.roles.keep).toBe('my-filter') // unchanged, not overwritten
  })

  it('lists watching/never-want/available with no args', async () => {
    known.push('cigars', 'travel', 'malicious')
    const queen = new InterestQueenBee()
    await queen.invoke('cigars')
    await queen.invoke('!malicious')
    logs.length = 0
    await queen.invoke('')
    expect(logs.at(-1)).toContain('Watching for: cigars')
    expect(logs.at(-1)).toContain('Never want: malicious')
    expect(logs.at(-1)).toContain('Available to add')
    expect(logs.at(-1)).toContain('travel')
    expect(logs.at(-1)).not.toMatch(/Available[^:]*:.*cigars/) // already watched, not "available"
  })

  it('an empty registry lists cleanly with no roles set', async () => {
    const queen = new InterestQueenBee()
    await queen.invoke('')
    expect(logs.at(-1)).toContain('Watching for: nothing yet')
  })

  it('does nothing and logs plainly when no registry is present', async () => {
    ;(window as any).__reg = {}
    const queen = new InterestQueenBee()
    await queen.invoke('cigars')
    expect(logs.at(-1)).toMatch(/not available/)
  })
})

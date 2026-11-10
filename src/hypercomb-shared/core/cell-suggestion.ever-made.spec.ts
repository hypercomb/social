// core/cell-suggestion.ever-made.spec.ts — the provider's half of "every name
// ever made": nothing is read until a name is typed, a hive whose census is not
// minted is asked for it exactly once, and once wanted the list follows each
// census pass.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const CENSUS = '@diamondcoreprocessor.com/RecentsCensus'

type Registry = Map<string, unknown>
let registry: Registry
let asked: number
let offAsk: () => void

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

const load = async (): Promise<InstanceType<typeof import('./cell-suggestion.provider').CellSuggestionProvider>> => {
  vi.resetModules()
  const { CellSuggestionProvider } = await import('./cell-suggestion.provider')
  return new CellSuggestionProvider()
}

beforeEach(() => {
  registry = new Map<string, unknown>([['@hypercomb.social/Lineage', new EventTarget()]])
  asked = 0
  Object.assign(globalThis, {
    get: (key: string) => registry.get(key),
    register: (key: string, value: unknown) => { registry.set(key, value) },
  })
  offAsk = EffectBus.on('recents:wanted', () => { asked++ })
})

afterEach(() => { offAsk() })

describe('CellSuggestionProvider — every name ever made', () => {
  it('reads nothing until a name is wanted, then answers from the census newest first', async () => {
    const atoms = vi.fn(async () => [{ label: 'Music' }, { label: 'jazz' }, { label: 'music' }])
    registry.set(CENSUS, { atoms })
    const provider = await load()
    await flush()
    expect(atoms).not.toHaveBeenCalled()
    expect(provider.everMade()).toEqual([])

    const changed = vi.fn()
    provider.addEventListener('change', changed)
    provider.wantEverMade()
    await flush()

    expect(provider.everMade()).toEqual(['Music', 'jazz'])
    expect(changed).toHaveBeenCalled()
    expect(asked).toBe(0)
  })

  it('asks a hive with no census for it — once — and fills when the census lands', async () => {
    let held: { label: string }[] = []
    const atoms = vi.fn(async () => held)
    registry.set(CENSUS, { atoms })
    const provider = await load()

    provider.wantEverMade()
    provider.wantEverMade()
    await flush()
    expect(asked).toBe(1)
    expect(provider.everMade()).toEqual([])

    held = [{ label: 'cigars' }, { label: 'lounge' }]
    EffectBus.emit('recents:census-changed', { sig: 'x', count: 2 })
    await flush()
    expect(provider.everMade()).toEqual(['cigars', 'lounge'])
    expect(asked).toBe(1)
  })

  it('does not follow the census until someone has wanted it', async () => {
    registry.set(CENSUS, { atoms: async () => [{ label: 'jazz' }] })
    const provider = await load()

    // A pass is announced with names to read — this provider has not been asked
    // for the vocabulary, so it stays empty. (Judged on the provider itself, not
    // on the census mock: EffectBus is process-wide, so providers built by the
    // earlier cases are still listening and do read it.)
    EffectBus.emit('recents:census-changed', { sig: 'x', count: 1 })
    await flush()
    expect(provider.everMade()).toEqual([])

    provider.wantEverMade()
    await flush()
    expect(provider.everMade()).toEqual(['jazz'])
  })

  it('survives a census that is absent or throws — the line just completes from the level', async () => {
    const provider = await load()
    expect(() => provider.wantEverMade()).not.toThrow()
    await flush()
    expect(provider.everMade()).toEqual([])

    registry.set(CENSUS, { atoms: async () => { throw new Error('cold') } })
    const second = await load()
    expect(() => second.wantEverMade()).not.toThrow()
    await flush()
    expect(second.everMade()).toEqual([])
  })
})

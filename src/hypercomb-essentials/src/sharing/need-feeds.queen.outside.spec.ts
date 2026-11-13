// @vitest-environment jsdom
//
// `explore`, said by a call from outside, answers aloud and leaves the
// participant's surface as it is: no view opens.

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ saying: null as string | null, modes: [] as string[], asked: [] as string[] }))

vi.hoisted(() => {
  const viewMode = Object.assign(new EventTarget(), { mode: 'hexagons', setMode: (next: string) => { state.modes.push(next) } })
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
    get: (key: string) => key === '@diamondcoreprocessor.com/ExternalCallDrone' ? { saying: state.saying }
      : key === '@hypercomb.social/ViewMode' ? viewMode
      : key === '@hypercomb.social/Lineage' ? { explorerSegments: () => ['kitchen'] }
      : key === '@diamondcoreprocessor.com/ContentBrokerDrone' ? { knownContentHosts: () => ['one.test'] }
      : undefined,
  }
})

vi.mock('../assistant/hive-explore-read.js', () => ({
  readExplore: async (name: string) => {
    state.asked.push(name)
    return { ok: true, root: `explore ${name}`, name, hosts: [{ host: 'one.test', state: 'answered', values: 1, publishers: 1 }],
      values: [{ text: 'soup', hosts: ['one.test'], publishers: 1, via: ['offer'] }], total: 1, tiles: [], truncated: false }
  },
}))

import { EffectBus } from '@hypercomb/core'
const { ExploreQueenBee } = await import('./need-feeds.queen.js')

const heard: string[] = []
EffectBus.on<{ message?: string }>('activity:log', entry => { if (entry?.message) heard.push(entry.message) })

const say = (args: string): Promise<void> =>
  (new ExploreQueenBee() as unknown as { execute(args: string): Promise<void> }).execute(args)

describe('explore, by who says it', () => {
  it('answers a call from outside aloud and opens no view', async () => {
    state.saying = 'explore recipes'
    heard.length = 0
    await say('recipes')
    expect(state.asked).toEqual(['recipes'])
    expect(heard[0]).toBe('Explore "recipes": 1 value from 1 of 1 host — soup')
    expect(state.modes).toEqual([])
  })

  it('opens the view for the participant and says nothing aloud', async () => {
    state.saying = null
    heard.length = 0
    state.asked.length = 0
    await say('recipes')
    expect(state.modes).toEqual(['explore'])
    expect(state.asked).toEqual([])
    expect(heard).toEqual([])
  })
})

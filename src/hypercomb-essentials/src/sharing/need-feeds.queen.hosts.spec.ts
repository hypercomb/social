// @vitest-environment jsdom
//
// The explore VIEW asks the hosts a model's `explore` asks (reach A8): one
// list, network-hosts.ts, never the broker's known hosts alone.

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ asked: [] as string[][], network: vi.fn(async () => ['door.test', 'hypercomb.com']) }))

vi.hoisted(() => {
  const target = new EventTarget()
  const viewMode = Object.assign(target, {
    mode: 'hexagons',
    setMode: (next: string) => { viewMode.mode = next; target.dispatchEvent(new Event('change')) },
  })
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
    get: (key: string) => key === '@hypercomb.social/ViewMode' ? viewMode
      : key === '@hypercomb.social/Lineage' ? { explorerSegments: () => ['kitchen'] }
      // The broker alone would say only this.
      : key === '@diamondcoreprocessor.com/ContentBrokerDrone' ? { knownContentHosts: () => ['only-broker.test'] }
      : undefined,
  }
})

vi.mock('./network-hosts.js', () => ({ networkHosts: state.network }))
vi.mock('./need-feeds.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./need-feeds.js')>()),
  feedNeed: async (_name: string, _onFeed: unknown, deps: { hosts(): readonly string[] }) => {
    state.asked.push([...deps.hosts()])
    return []
  },
}))

const { ExploreQueenBee } = await import('./need-feeds.queen.js')

describe('the explore view, by its hosts', () => {
  it('asks the network hosts, the same list a model is given', async () => {
    const queen = new ExploreQueenBee() as unknown as { execute(args: string): Promise<void> }
    await queen.execute('recipes')
    await vi.waitFor(() => expect(state.asked.length).toBeGreaterThan(0), { timeout: 2_000 })
    expect(state.network).toHaveBeenCalled()
    expect(state.asked[0]).toEqual(['door.test', 'hypercomb.com'])
  })
})

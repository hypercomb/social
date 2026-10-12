// sharing/discover.community.spec.ts — `discover` alone reads the hosts you
// carry; carrying none (a fresh install — nothing seeds the hosts pool any
// more, jwize 2026-10-11) it READS the public content host instead, and never
// writes that host into the pool.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const wired = vi.hoisted(() => {
  const state = { carried: [] as string[], adds: [] as string[] }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => undefined,
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => undefined,
  }
  return state
})

vi.mock('./community-hosts.js', () => ({
  addCommunityHost: async (raw: string) => { wired.adds.push(String(raw)); return '' },
  listCommunityHosts: async () => [...wired.carried],
}))
vi.mock('./publications-ledger.js', () => ({ fetchPublicationCards: async () => [] }))

import { DiscoverQueenBee } from './discover.queen.js'
import { DISCOVER_EFFECT } from './discover-effects.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import type { DiscoverPayload } from './discover.queen.js'

const run = async (): Promise<{ pages: DiscoverPayload[]; toasts: unknown[] }> => {
  const pages: DiscoverPayload[] = []
  const toasts: unknown[] = []
  const offPage = EffectBus.on<DiscoverPayload>(DISCOVER_EFFECT, p => { if (p) pages.push(p) })
  const offToast = EffectBus.on('toast:show', p => { toasts.push(p) })
  // Late subscribers replay the last value — only what this run emits counts.
  pages.length = 0
  toasts.length = 0
  const bee = new DiscoverQueenBee() as unknown as { execute(args: string): Promise<void> }
  await bee.execute('')
  offPage?.(); offToast?.()
  return { pages, toasts }
}

describe('discover alone — the community page', () => {
  beforeEach(() => { wired.carried = []; wired.adds = [] })

  it('carrying no hosts, reads the public content host — and writes nothing into the pool', async () => {
    const { pages, toasts } = await run()
    expect(toasts).toEqual([])
    expect(pages).toHaveLength(1)
    expect(pages[0]!.origins).toEqual(PUBLIC_CONTENT_HOSTS.map(h => `https://${h}`))
    expect(wired.adds).toEqual([])
  })

  it('carrying hosts, reads exactly those — the public content host is not added', async () => {
    wired.carried = ['friend.example']
    const { pages } = await run()
    expect(pages).toHaveLength(1)
    expect(pages[0]!.origins).toEqual(['https://friend.example'])
    expect(wired.adds).toEqual([])
  })
})

// sharing/arrival-derive.spec.ts — a branch's arrival is derived from what it
// opens as: the view arbiter, the view's queen and what the view declares.
// No declaration, or hexagons, is no plan — the whole package loads.

import { beforeEach, describe, expect, it, vi } from 'vitest'

let opensAs = ''
vi.mock('../commands/view-default.js', () => ({ defaultViewWithinAt: async () => opensAs }))

const views = new Map<string, { queenKey?: string; arrival?: readonly string[] }>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => key === '@diamondcoreprocessor.com/VisualBeeRegistry' ? { get: (view: string) => views.get(view) } : undefined,
}

const { derivedArrival, derivedArrivalRecord } = await import('./arrival-derive.js')

beforeEach(() => {
  opensAs = ''
  views.clear()
  views.set('website', { queenKey: '@diamondcoreprocessor.com/WebsiteQueenBee', arrival: ['@diamondcoreprocessor.com/SiteViewDrone'] })
  views.set('game', { queenKey: '@diamondcoreprocessor.com/GameQueenBee' })
})

describe('the arrival a publish derives', () => {
  it('a branch opening as a view that declares its arrival: the arbiter, the queen, and what it declares', async () => {
    opensAs = 'website'
    expect(await derivedArrival(['jaime-weise'])).toEqual([
      '@diamondcoreprocessor.com/SiteViewDrone',
      '@diamondcoreprocessor.com/ViewBee',
      '@diamondcoreprocessor.com/WebsiteQueenBee',
    ])
  })

  it('a view that declares no arrival is no plan — it may need more than its face', async () => {
    opensAs = 'game'
    expect(await derivedArrival(['games', 'arkanoid'])).toBeNull()
  })

  it('opening as hexagons is no plan — the hive itself is the arrival', async () => {
    expect(await derivedArrival(['notes'])).toBeNull()
  })

  it('a view nobody registered here is no plan', async () => {
    opensAs = 'lounge'
    expect(await derivedArrival(['lounge'])).toBeNull()
  })

  it('the record names its keys and says no hand made it', () => {
    expect(JSON.parse(derivedArrivalRecord(['@a.com/A', '@b.com/B']))).toEqual({ arrive: ['@a.com/A', '@b.com/B'], derived: true })
  })
})

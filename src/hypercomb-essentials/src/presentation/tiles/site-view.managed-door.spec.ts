// site-view.managed-door.spec.ts — on a managed site door the card is the
// managed view's (sharing/site-manage.view.ts), so this surface stands aside.
//
// 2026-11-14: a managed site door always stands on its site's tile, and the
// page has no view mode. Once the owner's replica landed there as an adopted
// root, this drone read the tile as a site to open. An adopted root is
// foreign, so "Feature not enabled" rose over the owner's own card, and its
// button opens a panel that page does not have: nothing could be done there.

import { beforeEach, describe, expect, it } from 'vitest'

const PAGE = 'c'.repeat(64)
let segments: string[] = []
/** The layer at each route: only /business-card holds a website page. */
const layers: Record<string, Record<string, unknown>> = { 'business-card': { name: 'business-card', website: [PAGE] } }

class FakeLineage extends EventTarget {
  explorerSegments = (): string[] => segments
}
const lineage = new FakeLineage()

const registered = new Map<string, unknown>()
const services = new Map<string, unknown>([
  // No ViewMode: the framework-free page a site door serves registers none.
  ['@hypercomb.social/Lineage', lineage],
  ['@hypercomb.social/Store', { hypercombRoot: {}, getResource: async () => null }],
  ['@diamondcoreprocessor.com/HistoryService', {
    sign: async (at: { explorerSegments?: () => readonly string[] }) => (at.explorerSegments?.() ?? []).join('/'),
    currentLayerAt: async (where: string) => layers[where] ?? null,
  }],
])
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => services.get(key) ?? registered.get(key),
  whenReady: () => {},
}

// The replica was adopted: its root is foreign by position.
localStorage.setItem('hc:adopted-roots', JSON.stringify([['business-card']]))

await import('./site-view.drone.js')
const drone = registered.get('@diamondcoreprocessor.com/SiteViewDrone') as { pulse(g: string): Promise<void> }
await drone.pulse('')

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)) }
const walkTo = async (next: string[]): Promise<void> => {
  segments = [...next]
  lineage.dispatchEvent(new CustomEvent('change'))
  await settle()
}
const gate = (): Element | null => document.getElementById('hc-feature-review')

/** The worker's record, as it is served: a JSON script, a direct child of <head>. */
const serveManaged = (on: boolean): void => {
  document.getElementById('hc-manage')?.remove()
  if (!on) return
  const record = document.createElement('script')
  record.id = 'hc-manage'
  record.type = 'application/json'
  record.textContent = JSON.stringify({ lineage: 'business-card', title: 'business-card' })
  document.head.appendChild(record)
}

beforeEach(async () => {
  serveManaged(false)
  await walkTo([])
})

describe('the review gate and a managed site door', () => {
  it('elsewhere, an adopted page that was never reviewed is gated', async () => {
    await walkTo(['business-card'])
    expect(gate()).not.toBeNull()
  })

  it('on a managed site door nothing is gated: the card is the managed view\'s', async () => {
    serveManaged(true)
    await walkTo(['business-card'])
    expect(gate()).toBeNull()
    expect(document.getElementById('hc-site-exit')).toBeNull()
  })

  it('a gate already up comes down when the page turns out to be a managed door', async () => {
    await walkTo(['business-card'])
    expect(gate()).not.toBeNull()
    serveManaged(true)
    await walkTo(['business-card'])
    expect(gate()).toBeNull()
  })

  it('a planted element is not the worker\'s record: the gate stays', async () => {
    const planted = document.createElement('div')
    planted.id = 'hc-manage'
    planted.textContent = JSON.stringify({ lineage: 'business-card' })
    document.body.appendChild(planted)
    try {
      await walkTo(['business-card'])
      expect(gate()).not.toBeNull()
    } finally {
      planted.remove()
    }
  })

  it('the gate goes when the hive walks onto a tile with no page', async () => {
    await walkTo(['business-card'])
    expect(gate()).not.toBeNull()
    await walkTo([])
    expect(gate()).toBeNull()
  })
})

// agent-tiles-rail.spec.ts — the hive list: three gestures and a search box.
//
// EVERY ROW IS A CONVERSATION. Click enters the tile's chat and never moves
// the list; hold goes inside it (the hive's own hold-to-enter); right-click
// comes back out. A row holding unsent thinking wears a mark, so the list
// shows where you left off thinking as well as what is there.
//
// The rail shows one level at a time and a real level runs to dozens of
// tiles, so the box under the title filters the rows already in hand: no
// walk, no wait, plain case-insensitive containment on the name. Moving to
// another level empties it — a filter held over fresh children reads as an
// empty tile — and Escape empties it before the escape cascade sees the key.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlacementLayer } from '../history/layer-placement.js'

const sig = (n: number): string => String(n).padStart(64, '0')

const ROOT = sig(1)
const WORKFLOW = sig(2)
const DIAGRAMS = sig(3)
const VIDEOS = sig(4)
const NESTED = sig(5)

const layers = new Map<string, PlacementLayer>([
  [ROOT, { name: 'hive', children: [WORKFLOW, DIAGRAMS, VIDEOS] }],
  [WORKFLOW, { name: 'pheromone-workflow', children: [NESTED] }],
  [DIAGRAMS, { name: 'diagrams', children: [] }],
  [VIDEOS, { name: 'ai-videos', children: [] }],
  [NESTED, { name: 'inside', children: [] }],
])

/** Location sigs are opaque keys here — what matters is that each PATH
 *  resolves to its own layer, the way the real history service does. */
const locate = (segments: readonly string[]): string => `location:${segments.join('/')}`
const heads = new Map<string, string>([
  [locate([]), ROOT],
  [locate(['pheromone-workflow']), WORKFLOW],
])

const services: Record<string, unknown> = {
  '@hypercomb.social/Lineage': { explorerSegments: () => [] },
  '@diamondcoreprocessor.com/HistoryService': {
    sign: async (lineage: { explorerSegments: () => readonly string[] }) => locate(lineage.explorerSegments()),
    currentLayerAt: async (s: string) => layers.get(heads.get(s) ?? '') ?? null,
    getLayerBySig: async (s: string) => layers.get(s) ?? null,
  },
  '@hypercomb.social/Store': { getResource: async () => null },
}

/** A drafts pool holding one tile's unsent thinking, so the rail's mark has
 *  something real to read. chat-thread reaches the store through the bare
 *  `get` global, so both seams are stood up. */
const draftDoc = new TextEncoder().encode(JSON.stringify({
  '/pheromone-workflow': { kind: 'chat-draft', path: '/pheromone-workflow', text: 'half a thought', at: 7 },
})).buffer

services['@hypercomb.social/Store'] = {
  getResource: async () => null,
  getPool: async () => ({}),
  getPoolDoc: async () => draftDoc,
  putPoolDoc: async () => 'ok',
}

;(globalThis as unknown as { get: unknown }).get = (key: string) => services[key]
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => {},
  get: (key: string) => services[key],
  whenReady: () => {},
}

const { AgentTilesRail } = await import('./agent-tiles-rail.js')

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

const names = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('.hc-rail-name')].map(n => n.textContent ?? '')

describe('tiles rail search', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>
  let find: HTMLInputElement

  const type = (value: string): void => {
    find.value = value
    find.dispatchEvent(new Event('input'))
  }

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    rail.mount(host)
    await settle()
    find = host.querySelector('.hc-rail-find input') as HTMLInputElement
  })

  it('lists the level, then narrows it to what matches', async () => {
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])

    type('DIA')
    expect(names(host)).toEqual(['diagrams'])

    type('o')
    expect(names(host)).toEqual(['pheromone-workflow', 'ai-videos'])
  })

  it('says so when nothing matches, and comes back when the box empties', () => {
    type('zzz')
    expect(names(host)).toEqual([])
    expect(host.querySelector('.hc-rail-empty')?.textContent).toContain('zzz')

    type('')
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('Escape empties the box and keeps the key away from the cascade', () => {
    type('dia')
    let escaped = false
    window.addEventListener('keydown', () => { escaped = true }, { once: true })

    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(find.value).toBe('')
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(escaped).toBe(false)
  })

  it('going inside a tile drops the filter', async () => {
    type('pher')
    const row = host.querySelector('.hc-rail-main') as HTMLButtonElement
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await settle()

    expect(find.value).toBe('')
    expect(names(host)).toEqual(['inside'])
  })
})

describe('tiles rail gestures — every row is a conversation', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>
  let entered: Array<string | null>

  const rows = (): HTMLButtonElement[] => [...host.querySelectorAll('.hc-rail-main')] as HTMLButtonElement[]

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    entered = []
    rail.onSubjectChanged = subject => entered.push(subject?.name ?? null)
    rail.mount(host)
    await settle()
  })

  it('a click enters that tile’s conversation and never navigates', async () => {
    rows()[0].click()
    await settle()

    expect(entered).toEqual(['pheromone-workflow'])
    expect(rail.subject?.name).toBe('pheromone-workflow')
    // Still the same level: a click that also went inside would move the list
    // out from under the person mid-thought.
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(host.querySelector('.hc-rail-row.current .hc-rail-name')?.textContent).toBe('pheromone-workflow')
  })

  it('one conversation at a time — entering another lets the first go', async () => {
    rows()[0].click()
    await settle()
    rows()[1].click()
    await settle()

    expect(rail.subject?.name).toBe('diagrams')
    expect(host.querySelectorAll('.hc-rail-row.current').length).toBe(1)
  })

  it('a HOLD goes inside, and the click that ends it does not enter a chat', async () => {
    vi.useFakeTimers()
    try {
      const row = rows()[0]
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      vi.advanceTimersByTime(500)
      row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      row.click()
    } finally {
      vi.useRealTimers()
    }
    await settle()

    expect(names(host)).toEqual(['inside'])
    expect(entered).toEqual([])
  })

  it('a press that wanders is a scroll, not a hold', async () => {
    vi.useFakeTimers()
    try {
      const row = rows()[0]
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 60 }))
      vi.advanceTimersByTime(500)
    } finally {
      vi.useRealTimers()
    }
    await settle()

    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('right-click comes back out', async () => {
    rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await settle()
    expect(names(host)).toEqual(['inside'])

    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()

    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('a tile holding unsent thinking wears a mark', () => {
    const marked = [...host.querySelectorAll('.hc-rail-row')]
      .filter(row => !row.querySelector<HTMLElement>('.hc-rail-draft')?.hidden)
      .map(row => row.querySelector('.hc-rail-name')?.textContent)

    expect(marked).toEqual(['pheromone-workflow'])
  })
})

// agent-tiles-rail.spec.ts — the hive list: three gestures and a search box.
//
// CLICK GOES IN. A row with children opens on an ordinary click; a LEAF has
// nowhere to go, so there a click enters the tile's chat. Ctrl-click gathers
// context without moving the list; right-click comes back out. (Hold-to-enter
// is retired — see the rail's header for why.) A row holding unsent thinking
// wears a mark, so the list shows where you left off thinking as well as what
// is there.
//
// The rail shows one level at a time and a real level runs to dozens of
// tiles, so the box under the title filters the rows already in hand: no
// walk, no wait, plain case-insensitive containment on the name. Moving to
// another level empties it — a filter held over fresh children reads as an
// empty tile — and Escape empties it before the escape cascade sees the key.

import { beforeEach, describe, expect, it } from 'vitest'
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

/** A threads pool holding ONE tile conversation: two turns on /diagrams, the
 *  newest of them never seen on this device. */
const turn = (at: number, role: string, text: string) => ({
  async getFile() {
    return { async text() { return JSON.stringify({ kind: 'chat-turn', convoId: 'chat:tile:/diagrams', role, at, text }) } }
  },
  kind: 'file',
})
const threadBucket = {
  kind: 'directory',
  async *entries() {
    yield ['a', turn(10, 'user', 'what is this')]
    yield ['b', turn(20, 'assistant', 'a diagram')]
  },
}

/** A SECOND conversation on /diagrams that has been PUT AWAY — one turn and
 *  the archive marker, which is a plain file in the thread's own bucket. */
const marker = {
  kind: 'file',
  async getFile() {
    return { async text() { return JSON.stringify({ kind: 'chat-archived', convoId: FILED_ID, at: 30 }) } }
  },
}
const FILED_ID = 'chat:tile:/diagrams::filed'
const filedTurn = (at: number, role: string, text: string) => ({
  async getFile() {
    return { async text() { return JSON.stringify({ kind: 'chat-turn', convoId: FILED_ID, role, at, text }) } }
  },
  kind: 'file',
})
const filedBucket = {
  kind: 'directory',
  async *entries() {
    yield ['a', filedTurn(5, 'user', 'the old thread')]
    yield ['z', marker]
  },
}
const threadsPool = {
  kind: 'directory',
  async *entries() {
    yield ['bucket', threadBucket]
    yield ['filed', filedBucket]
  },
}

services['@hypercomb.social/Store'] = {
  getResource: async () => null,
  getPool: async (meaning: string) => (meaning === 'threads' ? threadsPool : {}),
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

/** THE TILES ON THE LEVEL — not the hive's own row, which sits above them on
 *  every level and is not one of them: it is the whole thing these are in. */
const TILE_ROWS = '.hc-rail-group:not(.hc-rail-hive)'

const names = (host: HTMLElement): string[] =>
  [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-name`)].map(n => n.textContent ?? '')

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
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()

    expect(find.value).toBe('')
    expect(names(host)).toEqual(['inside'])
  })
})

describe('tiles rail gestures — every row is a conversation', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>
  let entered: Array<string | null>

  const rows = (): HTMLButtonElement[] =>
    [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-main`)] as HTMLButtonElement[]

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    entered = []
    rail.onSubjectChanged = subject => entered.push(subject?.name ?? null)
    rail.mount(host)
    await settle()
  })

  it('a click on a row WITH CHILDREN goes inside it', async () => {
    // 'pheromone-workflow' holds 'inside'. One ordinary click, no press to
    // discover, and the conversation is untouched: going somewhere is not
    // the same act as talking to something.
    rows()[0].click()
    await settle()

    expect(names(host)).toEqual(['inside'])
    expect(entered).toEqual([])
  })

  it('a click on a LEAF enters that tile’s conversation and never navigates', async () => {
    // 'diagrams' has no children, so there is nowhere for a click to go —
    // and the rail's other job takes it.
    rows()[1].click()
    await settle()

    expect(entered).toEqual(['diagrams'])
    expect(rail.subject?.name).toBe('diagrams')
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(host.querySelector(`${TILE_ROWS} .hc-rail-row.current .hc-rail-name`)?.textContent).toBe('diagrams')
  })

  it('one conversation at a time — entering another lets the first go', async () => {
    rows()[1].click()
    await settle()
    rows()[2].click()
    await settle()

    expect(rail.subject?.name).toBe('ai-videos')
    expect(host.querySelectorAll(`${TILE_ROWS} .hc-rail-row.current`).length).toBe(1)
  })

  it('the chat icon still opens a PARENT’s own conversations — click no longer can', async () => {
    // The one thing the swap could have cost: a tile with children losing
    // its way into a chat. The chat icon is where they live, and the fold
    // always offers a fresh one.
    const chats = host.querySelector(`${TILE_ROWS} .hc-rail-chats-open`) as HTMLButtonElement
    chats.click()
    await settle()

    // The list did NOT move — the icon talks, it does not walk.
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])

    const fresh = host.querySelector('.hc-rail-chat-new') as HTMLButtonElement
    expect(fresh).toBeTruthy()
    fresh.click()
    await settle()

    expect(rail.subject?.name).toBe('pheromone-workflow')
  })

  it('pressing it PUTS YOU IN the conversation you were last in', async () => {
    // The press is not a disclosure. A tile with children cannot be entered
    // by clicking its row, so this control is how you talk to one — and
    // landing outside the list it just opened made the common case (pick up
    // where I was) cost a second aim at a row.
    const chats = () => host.querySelectorAll(`${TILE_ROWS} .hc-rail-chats-open`)[1] as HTMLButtonElement
    chats().click()
    await settle()

    expect(entered).toEqual(['diagrams'])
    expect(rail.subject?.name).toBe('diagrams')
    // And it is the STICKY one that is lit, not merely listed.
    expect(host.querySelector('.hc-rail-chat.current')).toBeTruthy()

    // A second press folds the list shut WITHOUT putting the conversation
    // down: you are still in it, the rail has just stopped listing the rest.
    chats().click()
    await settle()

    expect(host.querySelector('.hc-rail-chats')).toBeFalsy()
    expect(rail.subject?.name).toBe('diagrams')
  })

  it('an ARCHIVED conversation is out of the fold, behind a count', async () => {
    // /diagrams holds two threads: one live, one put away. Unfolding shows
    // the live one and says the other exists — it does not list it, and it
    // does not pretend it is gone.
    const chats = host.querySelectorAll(`${TILE_ROWS} .hc-rail-chats-open`)[1] as HTMLButtonElement
    chats.click()
    await settle()

    const names = () => [...host.querySelectorAll('.hc-rail-chat-name')].map(n => n.textContent)
    expect(names()).toEqual(['what is this'])

    const disclosure = host.querySelector('.hc-rail-archived') as HTMLButtonElement
    expect(disclosure).toBeTruthy()
    expect(disclosure.textContent).toContain('1')

    disclosure.click()
    await settle()
    expect(names()).toEqual(['what is this', 'the old thread'])
  })

  it('putting one away answers the press at once — and the pool still wins', async () => {
    const chats = host.querySelectorAll(`${TILE_ROWS} .hc-rail-chats-open`)[1] as HTMLButtonElement
    chats.click()
    await settle()

    const names = () => [...host.querySelectorAll('.hc-rail-chat-name')].map(n => n.textContent)
    expect(names()).toEqual(['what is this'])

    // ONE PRESS, ANSWERED IMMEDIATELY. This is a row under the pointer; a
    // press that shows nothing until a disk round-trip completes reads as a
    // press that did not land. So the row leaves the list before the write.
    const put = host.querySelector('.hc-rail-chat-put') as HTMLButtonElement
    put.click()
    expect(names()).toEqual([])
    expect((host.querySelector('.hc-rail-archived') as HTMLElement).textContent).toContain('2')

    // AND THE POOL IS STILL THE TRUTH. This fixture's pool cannot take the
    // write, so the refresh behind the optimistic flip puts the thread back.
    // An optimistic list that kept a lie after a failed write would be worse
    // than one that never moved.
    await settle()
    expect(names()).toEqual(['what is this'])
  })

  it('right-click comes back out', async () => {
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()
    expect(names(host)).toEqual(['inside'])

    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()

    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('the keyboard walks the same three moves', async () => {
    const key = (el: Element, k: string): void => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    }

    // → goes inside, and the level that arrives takes the focus.
    key(rows()[0], 'ArrowRight')
    await settle()
    expect(names(host)).toEqual(['inside'])
    expect(document.activeElement).toBe(rows()[0])

    // ← comes back out.
    key(rows()[0], 'ArrowLeft')
    await settle()
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])

    // ↓↑ walk the rows without leaving the level.
    rows()[0].focus()
    key(rows()[0], 'ArrowDown')
    expect(document.activeElement).toBe(rows()[1])
    key(rows()[1], 'ArrowUp')
    expect(document.activeElement).toBe(rows()[0])
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('→ on a leaf does nothing — there is nothing inside it', async () => {
    key: {
      rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    }
    await settle()
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('says which row you are in to a screen reader, not only in colour', async () => {
    rows()[1].click()
    await settle()

    const marked = rows().filter(r => r.getAttribute('aria-current') === 'true')
    expect(marked.length).toBe(1)
    expect(marked[0].querySelector('.hc-rail-name')?.textContent).toBe('diagrams')
  })

  it('a tile holding unsent thinking wears a mark', () => {
    const marked = [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-row.draft`)]
      .map(row => row.querySelector('.hc-rail-name')?.textContent)

    expect(marked).toEqual(['pheromone-workflow'])
  })

  it('a tile that has been spoken to says so, and how deep it goes', () => {
    const spoken = [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-row.spoken`)]
      .map(row => row.querySelector('.hc-rail-name')?.textContent)
    expect(spoken).toEqual(['diagrams'])

    const row = [...host.querySelectorAll<HTMLElement>(`${TILE_ROWS} .hc-rail-row`)]
      .find(r => r.querySelector('.hc-rail-name')?.textContent === 'diagrams')
    // two turns of a twelve-turn ladder
    expect(row?.style.getPropertyValue('--hc-rail-depth')).toBe(String(2 / 12))
  })

  it('an answer nobody has read wears the sealed cell, and says so out loud', () => {
    const unread = [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-row.unread`)]
      .map(row => row.querySelector('.hc-rail-name')?.textContent)
    expect(unread).toEqual(['diagrams'])

    const label = [...host.querySelectorAll<HTMLElement>(`${TILE_ROWS} .hc-rail-main`)]
      .find(m => m.textContent?.includes('diagrams'))
      ?.getAttribute('aria-label')
    expect(label).toContain('2 turns')
    expect(label).toContain('unread reply')
  })

  it('a dormant tile draws nothing at all', () => {
    const quiet = [...host.querySelectorAll<HTMLElement>(`${TILE_ROWS} .hc-rail-row`)]
      .find(r => r.querySelector('.hc-rail-name')?.textContent === 'ai-videos')

    expect(quiet?.className).toBe('hc-rail-row')
    expect(quiet?.querySelector<HTMLElement>('.hc-rail-bees')?.hidden).toBe(true)
  })

  it('ctrl-click gathers tiles as context and never moves the list', async () => {
    const chosen: string[][] = []
    rail.onSelectionChanged = sel => chosen.push(sel.map(s => s.name))

    rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    rows()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await settle()

    expect(rail.selection.map(s => s.name)).toEqual(['pheromone-workflow', 'ai-videos'])
    expect(chosen[chosen.length - 1]).toEqual(['pheromone-workflow', 'ai-videos'])
    // the level did not move, and no conversation was entered
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(rail.subject).toBe(null)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect(rows()[1].getAttribute('aria-pressed')).toBe('false')
  })

  it('the choice is a list of SIGNATURES, deduped, and survives going inside', async () => {
    rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await settle()
    const sigs = rail.selectionSigs
    expect(sigs).toEqual([sig(2)])

    // walk into the tile and back out — the gathering is the whole point
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()
    expect(rail.selectionSigs).toEqual(sigs)

    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    expect(rail.selectionSigs).toEqual(sigs)
    // and the row is still lit when we come back to it
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('ctrl-clicking a chosen tile lets it go', async () => {
    rows()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await settle()
    expect(rail.selection.length).toBe(1)

    rows()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await settle()
    expect(rail.selection).toEqual([])
    expect(rows()[1].getAttribute('aria-pressed')).toBe('false')
  })
})

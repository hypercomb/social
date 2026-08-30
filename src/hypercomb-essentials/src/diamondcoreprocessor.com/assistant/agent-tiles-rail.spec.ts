// agent-tiles-rail.spec.ts — the hive list: three gestures and a search box.
//
// THE LINE TALKS, THE ARROW WALKS. Every row in this list IS a conversation —
// it carries that conversation's state (how deep, unread, a draft waiting,
// live right now) — so an ordinary click on any row, leaf or parent, enters
// its chat. Going INSIDE a tile moved to its own chevron at the end of the
// row, present only where there is something to go into. Ctrl-click gathers
// context without moving the list; right-click comes back out from anywhere
// on the line, including from the arrow.
//
// The rail shows one level at a time and a real level runs to dozens of
// tiles, so the box under the title filters the rows already in hand: no
// walk, no wait, plain case-insensitive containment on the name. Moving to
// another level empties it — a filter held over fresh children reads as an
// empty tile — and Escape empties it before the escape cascade sees the key.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
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

/** The blurb pool, and what is planted in it — keyed by conversation, which
 *  is the shape chat-blurb writes: one slot per thread, recycled in place. */
const blurbPool = { kind: 'directory', blurbs: true }
const plantedBlurbs: Record<string, unknown> = {}

services['@hypercomb.social/Store'] = {
  getResource: async () => null,
  getPool: async (meaning: string) =>
    meaning === 'threads' ? threadsPool : meaning === 'chat:blurbs' ? blurbPool : {},
  getPoolDoc: async (pool: unknown, subKey?: string) => {
    if (pool !== blurbPool) return draftDoc
    const held = subKey ? plantedBlurbs[subKey] : undefined
    return held ? new TextEncoder().encode(JSON.stringify(held)).buffer : null
  },
  putPoolDoc: async () => 'ok',
}

/** A registry the rail can count from. Empty unless a test fills it — the
 *  agent lane and the chat's own busy flag have to be told apart, and that is
 *  only visible when BOTH could speak for the same tile. */
const liveAgents: Array<{ id: string; kind: string; status: string; segments: string[]; targets: string[] }> = []
services['@diamondcoreprocessor.com/AgentRegistry'] = {
  list: () => liveAgents,
  addEventListener: () => {},
  removeEventListener: () => {},
}

;(globalThis as unknown as { get: unknown }).get = (key: string) => services[key]
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => {},
  get: (key: string) => services[key],
  whenReady: () => {},
}

const { AgentTilesRail } = await import('./agent-tiles-rail.js')
const { BLURB_VERSION } = await import('./chat-blurb.js')

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

  it('the square Go control goes inside without touching the conversation', async () => {
    const walk = host.querySelectorAll(`${TILE_ROWS} .hc-rail-walk`)[0] as HTMLButtonElement
    walk.click()
    await settle()

    expect(names(host)).toEqual(['inside'])
    expect(entered).toEqual([])
  })

  it('a click anywhere on a parent tile opens its chat and stays on the level', async () => {
    rows()[0].click()
    await settle()

    expect(entered).toEqual(['pheromone-workflow'])
    expect(rail.subject?.name).toBe('pheromone-workflow')
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('leaves have no Go square that leads nowhere', () => {
    const walks = [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-walk`)] as HTMLButtonElement[]
    expect(walks.map(walk => walk.hidden)).toEqual([false, true, true])
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

  it('does not render a conversation or creation button before somebody speaks', async () => {
    rows()[0].click()
    await settle()

    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(rail.subject?.name).toBe('pheromone-workflow')
    expect(host.querySelector('.hc-rail-chat-new')).toBeNull()
    expect(host.querySelector('.hc-rail-chat')).toBeNull()
  })

  it('pressing the tile PUTS YOU IN the conversation you were last in', async () => {
    const line = () => host.querySelectorAll(`${TILE_ROWS} .hc-rail-main`)[1] as HTMLButtonElement
    line().click()
    await settle()

    expect(entered).toEqual(['diagrams'])
    expect(rail.subject?.name).toBe('diagrams')
    // And it is the STICKY one that is lit, not merely listed.
    expect(host.querySelector('.hc-rail-chat.current')).toBeTruthy()

    // A second press folds the list shut WITHOUT putting the conversation
    // down: you are still in it, the rail has just stopped listing the rest.
    line().click()
    await settle()

    expect(host.querySelector('.hc-rail-chats')).toBeFalsy()
    expect(rail.subject?.name).toBe('diagrams')
  })

  it('an ARCHIVED conversation is out of the fold, behind a count', async () => {
    // /diagrams holds two threads: one live, one put away. Unfolding shows
    // the live one and says the other exists — it does not list it, and it
    // does not pretend it is gone.
    rows()[1].click()
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

  it('a fold that lists conversations ends with + New conversation, which mints no row', async () => {
    // Entering a chat remembers it as the tile's sticky thread (that is the
    // point of sticky) — and this test enters a MINTED id, which would leak
    // into every later test that resumes /diagrams. Put the memory back.
    const sticky = localStorage.getItem('hc:rail-chat')

    // /diagrams already holds threads, so its fold carries the way to the
    // next one — at the bottom, where the list grows.
    rows()[1].click()
    await settle()

    const fresh = host.querySelector('.hc-rail-chat-new') as HTMLButtonElement
    expect(fresh).toBeTruthy()
    // Under the live rows, ABOVE the archive — the next thread joins the
    // available ones; the archive is a different shelf.
    expect(fresh.previousElementSibling?.classList.contains('hc-rail-chat')).toBe(true)
    expect(fresh.nextElementSibling?.classList.contains('hc-rail-archived')).toBe(true)

    const bodies = () => host.querySelectorAll('.hc-rail-chat-body').length
    const before = bodies()
    fresh.click()
    await settle()

    // You are IN a fresh thread on the same tile — not the sticky one — and
    // the list is exactly what it was: nothing exists until a turn lands.
    expect(rail.subject?.name).toBe('diagrams')
    expect(rail.subject?.convoId).toBeTruthy()
    expect(rail.subject?.convoId).not.toBe('chat:tile:/diagrams')
    expect(bodies()).toBe(before)
    expect(host.querySelector('.hc-rail-chat.current')).toBeNull()

    if (sticky === null) localStorage.removeItem('hc:rail-chat')
    else localStorage.setItem('hc:rail-chat', sticky)
  })

  it('putting one away answers the press at once — and the pool still wins', async () => {
    rows()[1].click()
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

// ── WHAT THE CONVERSATION TURNED OUT TO BE ABOUT ──────────────────────
//
// A thread is named by its FIRST message, which is what you did not know yet.
// The blurb (chat-blurb.ts) is the other end of it, written down by the
// orchestrator and only ever READ here. Two rules the rail owes it:
//
//   • ADDITIVE. A row with no blurb draws exactly what it drew before, so a
//     wiped pool, a stale version, or a hive with no provider configured
//     costs one line of legibility and nothing else.
//   • THE POINTS BELONG TO THE ONE YOU ARE IN. Forty rows are SCANNED; the
//     conversation you have opened is the one with room to say more.
describe('tiles rail — the blurb on a conversation', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>

  /** Unfold /diagrams' conversations — the tile the fixture's threads pool
   *  holds a thread for. */
  const unfold = async (): Promise<void> => {
    const chats = host.querySelectorAll(`${TILE_ROWS} .hc-rail-main`)[1] as HTMLButtonElement
    chats.click()
    await settle()
  }

  const lines = (): string[] =>
    [...host.querySelectorAll('.hc-rail-chat-blurb')].map(n => n.textContent ?? '')
  const points = (): string[] =>
    [...host.querySelectorAll('.hc-rail-chat-points li')].map(n => n.textContent ?? '')

  /** Mount AFTER the blurb is planted. The rail reads the pool once with the
   *  chat list, so a test that plants afterwards is testing nothing — which
   *  is also the true behaviour: a blurb minted later arrives on the
   *  `chat:blurbs-changed` announcement, covered separately below. */
  const mount = async (): Promise<void> => {
    rail = new AgentTilesRail()
    rail.mount(host)
    await settle()
  }

  beforeEach(() => {
    for (const key of Object.keys(plantedBlurbs)) delete plantedBlurbs[key]
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  it('draws the row exactly as before when no blurb is held', async () => {
    await mount()
    await unfold()
    expect([...host.querySelectorAll('.hc-rail-chat-name')].map(n => n.textContent))
      .toEqual(['what is this'])
    expect(lines()).toEqual([])
    expect(points()).toEqual([])
  })

  it('shows the line under the title, and the points on the open conversation', async () => {
    plantedBlurbs['chat:tile:/diagrams'] = {
      kind: 'chat:blurb',
      convoId: 'chat:tile:/diagrams',
      line: 'choosing a diagram format',
      points: ['settled on mermaid', 'left the export open'],
      v: BLURB_VERSION,
      upToTurnCount: 2,
      upToAt: 20,
      at: 21,
    }
    await mount()
    await unfold()

    // The title is still the first thing that was said — the blurb is added
    // to the row, it does not replace what named it.
    expect([...host.querySelectorAll('.hc-rail-chat-name')].map(n => n.textContent))
      .toEqual(['what is this'])
    expect(lines()).toEqual(['choosing a diagram format'])

    // Unfolding puts you IN this conversation, so its points are showing.
    expect(host.querySelector('.hc-rail-chat.current')).toBeTruthy()
    expect(points()).toEqual(['settled on mermaid', 'left the export open'])
  })

  it('a record from another derivation is IGNORED, not shown', async () => {
    plantedBlurbs['chat:tile:/diagrams'] = {
      kind: 'chat:blurb',
      convoId: 'chat:tile:/diagrams',
      line: 'what an older version of this code thought',
      points: ['stale'],
      v: BLURB_VERSION + 1,
      upToTurnCount: 2,
      upToAt: 20,
      at: 21,
    }
    await mount()
    await unfold()

    expect(lines()).toEqual([])
    expect(points()).toEqual([])
    // …and the row is unharmed by the record it declined to read.
    expect([...host.querySelectorAll('.hc-rail-chat-name')].map(n => n.textContent))
      .toEqual(['what is this'])
  })

  it('the points ride on the ROW, never inside the button', async () => {
    // A <ul> inside a <button> is not something the DOM allows or a screen
    // reader can read out — the same reason the archive mark is a sibling.
    plantedBlurbs['chat:tile:/diagrams'] = {
      kind: 'chat:blurb',
      convoId: 'chat:tile:/diagrams',
      line: 'a line',
      points: ['a point'],
      v: BLURB_VERSION,
      upToTurnCount: 2,
      upToAt: 20,
      at: 21,
    }
    await mount()
    await unfold()

    const list = host.querySelector('.hc-rail-chat-points') as HTMLElement
    expect(list).toBeTruthy()
    expect(list.closest('button')).toBeNull()
    expect(list.parentElement?.classList.contains('hc-rail-chat')).toBe(true)
  })

  it('finds a tile by what its conversation was ABOUT, not only by name', async () => {
    // The payoff of writing the summary down: a filter can reach into what
    // was said. A blurb derived on open could never do this — it would not
    // exist until you were already looking at the row.
    plantedBlurbs['chat:tile:/diagrams'] = {
      kind: 'chat:blurb',
      convoId: 'chat:tile:/diagrams',
      line: 'choosing a diagram format',
      points: ['settled on mermaid'],
      v: BLURB_VERSION,
      upToTurnCount: 2,
      upToAt: 20,
      at: 21,
    }
    // The blurbs are read with the chat list; unfolding is not required for
    // the filter to see them.
    await mount()

    const find = host.querySelector('.hc-rail-find input') as HTMLInputElement
    find.value = 'mermaid'
    find.dispatchEvent(new Event('input'))
    await settle()

    expect(names(host)).toEqual(['diagrams'])

    // A word in nothing — neither a name nor a blurb — still empties the list.
    find.value = 'nowhere'
    find.dispatchEvent(new Event('input'))
    await settle()
    expect(names(host)).toEqual([])
  })
})

// ── WHAT A LINE SAYS BEFORE YOU READ IT ───────────────────────────────
//
// Now that the line IS the conversation control, the marks on it are about
// the thing pressing it reaches. Two that were missing:
//
//   • HOW MANY conversations the tile holds, beside the name they are about —
//     a tile is a SUBJECT, so several threads about it is the normal case,
//     and it should not take unfolding the tile to discover that.
//   • WHETHER ONE IS LIVE right now. Every other mark in the gutter is about
//     the past (spoken to, this deep, a reply you have not read); this is the
//     only one in the present tense, so it is the only one that moves.
describe('tiles rail — what a conversation line says', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>

  const row = (at: number): HTMLElement =>
    [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-row`)][at] as HTMLElement
  const counts = (): Array<string | null> =>
    [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-threads`)]
      .map(n => ((n as HTMLElement).hidden ? null : n.textContent))

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    rail.mount(host)
    await settle()
  })

  it('counts the tile’s conversations after its label, and ARCHIVED ones are not in it', () => {
    // /diagrams holds two threads in the fixture pool — one live, one put
    // away. The fold lists one, so the row must promise one: a count that
    // disagreed with the list under it would be lying about the same set.
    expect(counts()).toEqual([null, '1', null])
  })

  it('a tile nobody has spoken to shows no count — “0 conversations” is not a fact', () => {
    const empty = row(0).querySelector('.hc-rail-threads') as HTMLElement
    expect(empty.hidden).toBe(true)
    expect(row(1).querySelector<HTMLElement>('.hc-rail-threads')?.hidden).toBe(false)
  })

  it('marks a line LIVE while a question of yours is still out, and clears it', async () => {
    expect(row(1).classList.contains('live')).toBe(false)

    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: true })
    await settle()
    expect(row(1).classList.contains('live')).toBe(true)
    // Only the line it is about — a moving mark on every row says nothing.
    expect(row(0).classList.contains('live')).toBe(false)

    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: false })
    await settle()
    expect(row(1).classList.contains('live')).toBe(false)
  })

  it('says the same sentence to a screen reader, since every mark here is CSS', async () => {
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: true })
    await settle()
    const label = row(1).querySelector('.hc-rail-main')?.getAttribute('aria-label') ?? ''
    expect(label).toContain('diagrams')
    expect(label).toContain('1 conversations')
    expect(label).toContain('working')
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: false })
  })

  // ── BACK COMES OUT FROM ANYWHERE ON THE LINE ────────────────────────
  //
  // The reversal added a control to the row, and a control that swallowed
  // the back gesture would make the way out depend on where the pointer
  // happened to be. It bubbles to the rail, so it does not.
  it('right-click comes back out from the row, and from the arrow too', async () => {
    const walk = host.querySelectorAll(`${TILE_ROWS} .hc-rail-walk`)[0] as HTMLButtonElement
    walk.click()
    await settle()
    expect(names(host)).toEqual(['inside'])

    host.querySelector(`${TILE_ROWS} .hc-rail-main`)
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])

    ;(host.querySelectorAll(`${TILE_ROWS} .hc-rail-walk`)[0] as HTMLButtonElement).click()
    await settle()
    expect(names(host)).toEqual(['inside'])

    host.querySelector(`${TILE_ROWS} .hc-rail-walk`)
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })
})

// ── THE HIVE'S OWN LINE ───────────────────────────────────────────────
//
// The hive sits above every level and is a conversation like the tiles under
// it — usually the deepest one there is. It was the only row in this list
// with nowhere to put what it holds: no thread count, no live mark, so a
// question asked about the whole hive left the surface the moment it was
// sent. It has no INSIDE, so it is also the one row that carries no arrow —
// which is the same grammar, not a second one.
describe('tiles rail — the hive line carries its details too', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>

  const hive = (): HTMLElement =>
    host.querySelector('.hc-rail-hive .hc-rail-row') as HTMLElement

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    rail.mount(host)
    await settle()
  })

  it('has the same slots every tile line has', () => {
    expect(hive().querySelector('.hc-rail-threads')).toBeTruthy()
    expect(hive().querySelector('.hc-rail-bees')).toBeTruthy()
  })

  it('carries no arrow — the hive has no inside to walk into', () => {
    expect(hive().querySelector('.hc-rail-walk')).toBeFalsy()
  })

  it('marks itself LIVE while a question about the whole hive is out', async () => {
    expect(hive().classList.contains('live')).toBe(false)

    EffectBus.emit('chat:tile-busy', { path: '/', busy: true })
    await settle()
    expect(hive().classList.contains('live')).toBe(true)
    expect(hive().querySelector<HTMLElement>('.hc-rail-bees')?.hidden).toBe(false)

    EffectBus.emit('chat:tile-busy', { path: '/', busy: false })
    await settle()
    expect(hive().classList.contains('live')).toBe(false)
  })

  it('its line talks, and a second press folds without putting the chat down', async () => {
    const line = () => hive().querySelector('.hc-rail-main') as HTMLButtonElement
    line().click()
    await settle()
    expect(rail.subject?.key).toBe('')
    expect(host.querySelector('.hc-rail-hive .hc-rail-chats')).toBeTruthy()

    line().click()
    await settle()
    expect(host.querySelector('.hc-rail-hive .hc-rail-chats')).toBeFalsy()
    expect(rail.subject?.key).toBe('')
  })
})

// ── ONE QUESTION IS ONE BEE ───────────────────────────────────────────
//
// Sending a chat question now raises an agent on the same lane a routine
// does (chat-window's #raiseBee), so the registry counts it. The row's live
// number used to ADD the chat's own busy flag to that count, which was right
// while a question raised no agent and would now say 2 for one question.
describe('tiles rail — the live count never counts one question twice', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>

  const badge = (at: number): HTMLElement =>
    [...host.querySelectorAll(`${TILE_ROWS} .hc-rail-bees`)][at] as HTMLElement

  const mount = async (): Promise<void> => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    rail.mount(host)
    await settle()
  }

  beforeEach(() => { liveAgents.length = 0 })

  it('a question with its bee reads 1, not 2', async () => {
    // The bee the chat window raises: over 'diagrams', on the level it sits on.
    liveAgents.push({
      id: 'chat:chat:tile:/diagrams', kind: 'model', status: 'working',
      segments: [], targets: ['diagrams'],
    })
    await mount()
    // …and the flag the same window emits for the same question.
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: true })
    await settle()

    expect(badge(1).hidden).toBe(false)
    expect(badge(1).textContent).toBe('1')
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: false })
  })

  it('a routine working alongside the question still adds up', async () => {
    liveAgents.push(
      { id: 'chat:chat:tile:/diagrams', kind: 'model', status: 'working', segments: [], targets: ['diagrams'] },
      { id: 'sweep', kind: 'script', status: 'working', segments: [], targets: ['diagrams'] },
    )
    await mount()
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: true })
    await settle()

    expect(badge(1).textContent).toBe('2')
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: false })
  })

  it('with no registry to count from, the flag is still the fallback', async () => {
    await mount()
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: true })
    await settle()

    expect(badge(1).hidden).toBe(false)
    expect(badge(1).textContent).toBe('1')
    expect([...host.querySelectorAll(`${TILE_ROWS} .hc-rail-row`)][1].classList.contains('live')).toBe(true)
    EffectBus.emit('chat:tile-busy', { path: '/diagrams', busy: false })
  })
})

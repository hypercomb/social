// agent-tiles-rail.spec.ts — the hive list: three gestures and a search box.
//
// A CLICK DRILLS ONE LAYER. The panel then lists that layer's children, and
// a chat row has no arrow. The reading pane stays where it was until you
// come back out, which is what puts the conversation in view. The chat's
// left head stays the word hive on every layer. Ctrl-click gathers context
// without moving the list. Right-click comes back one layer. A list with no
// chats still picks on click and walks one level on its arrow. The hive's
// own line still opens, then folds, and never walks.
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
/** A conversation on a tile INSIDE pheromone-workflow. It belongs to that
 *  layer, so the root list leaves it out until you go inside. */
const INSIDE_ID = 'chat:tile:/pheromone-workflow/inside'
const insideTurn = (at: number, role: string, text: string) => ({
  async getFile() {
    return { async text() { return JSON.stringify({ kind: 'chat-turn', convoId: INSIDE_ID, role, at, text }) } }
  },
  kind: 'file',
})
const insideBucket = {
  kind: 'directory',
  async *entries() {
    yield ['a', insideTurn(15, 'user', 'down here')]
    yield ['b', insideTurn(16, 'assistant', 'noted')]
  },
}
const threadsPool = {
  kind: 'directory',
  async *entries() {
    yield ['bucket', threadBucket]
    yield ['filed', filedBucket]
    yield ['inside', insideBucket]
  },
}

/** The blurb pool, and what is planted in it — keyed by conversation, which
 *  is the shape chat-blurb writes: one slot per thread, recycled in place. */
const blurbPool = { kind: 'directory', blurbs: true }
const plantedBlurbs: Record<string, unknown> = {}

services['@hypercomb.social/Store'] = {
  getResource: async () => null,
  getPool: async (meaning: string) =>
    meaning === 'system:threads' ? threadsPool : meaning === 'chat:blurbs' ? blurbPool : {},
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

  it('the left head stays hive while the chat names the layer', async () => {
    const bare = document.createElement('div')
    document.body.appendChild(bare)
    const quiet = new AgentTilesRail({ title: false })
    quiet.mount(bare)
    await settle()

    const title = bare.querySelector('.hc-rail-title') as HTMLElement
    const mark = bare.querySelector('.hc-rail-back') as HTMLButtonElement
    expect(title.hidden).toBe(false)
    expect(title.textContent).toBe('hive')
    expect(mark.querySelector('.mat-sym')?.textContent).toBe('hive')
    expect(bare.querySelector('.hc-rail-walk')).toBeNull()
    expect(bare.querySelector('.hc-rail-find-toggle')).toBeTruthy()

    ;(bare.querySelector(`${TILE_ROWS} .hc-rail-main`) as HTMLButtonElement).click()
    await settle()
    expect(quiet.here()).toEqual(['pheromone-workflow'])
    expect(names(bare)).toEqual(['inside'])
    expect(title.textContent).toBe('hive')
    expect(mark.querySelector('.mat-sym')?.textContent).toBe('hive')

    mark.click()
    await settle()
    expect(quiet.here()).toEqual([])
    expect(names(bare)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    quiet.dispose()
    bare.remove()
  })

  it('going inside a tile drops the filter', async () => {
    type('pher')
    const row = host.querySelector('.hc-rail-main') as HTMLButtonElement
    row.click()
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
  const back = async (): Promise<void> => {
    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
  }
  /** Open a thread from the layer's conversation list. That unfolds the
   *  tile's threads and puts the conversation in view, and stays on this
   *  level. A click on the tile itself has already moved to the next layer. */
  const openThread = async (title: string): Promise<void> => {
    const convo = [...host.querySelectorAll('.hc-rail-convo')]
      .find(node => (node.textContent ?? '').includes(title)) as HTMLButtonElement
    convo.click()
    await settle()
  }

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    rail = new AgentTilesRail()
    entered = []
    rail.onSubjectChanged = subject => entered.push(subject?.name ?? null)
    rail.mount(host)
    await settle()
  })

  it('a chat row has no arrow — the click is the drill', () => {
    expect(host.querySelector('.hc-rail-walk')).toBeNull()
  })

  it('a click moves into that layer and leaves the reading pane where it was', async () => {
    rows()[0].click()
    await settle()

    expect(entered).toEqual([])
    expect(rail.subject?.name).toBe('pheromone-workflow')
    expect(rail.armed('/pheromone-workflow')).toBe(true)
    expect(rail.here()).toEqual(['pheromone-workflow'])
    expect(names(host)).toEqual(['inside'])
    expect(host.querySelector('.hc-rail-chats')).toBeFalsy()

    await back()

    expect(entered).toEqual(['pheromone-workflow'])
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('lists this layer’s conversations above the tiles, grouped by who it waits on, the archive folded shut', async () => {
    const block = (): HTMLElement => host.querySelector('.hc-rail-convos') as HTMLElement
    const convoNames = (): string[] => [...block().querySelectorAll('.hc-rail-convo-name')].map(n => n.textContent ?? '')

    expect([...block().querySelectorAll('.hc-rail-convos-group')].map(n => n.textContent)).toEqual(['Open'])
    expect(convoNames()).toEqual(['what is this'])
    expect(block().querySelector('.hc-rail-convo')?.getAttribute('data-group')).toBe('open')
    expect(host.querySelector('.hc-rail-tiles-head')).toBeTruthy()

    const archived = block().querySelector('.hc-rail-convos-archived') as HTMLButtonElement
    expect(archived.textContent).toBe('Archived (1)')
    archived.click()
    expect(convoNames()).toEqual(['what is this', 'the old thread'])

    ;(block().querySelector('.hc-rail-convo') as HTMLButtonElement).click()
    await settle()
    expect(rail.subject?.name).toBe('diagrams')
    expect(rail.subject?.convoId).toBe('chat:tile:/diagrams')
    expect(block().querySelector('.hc-rail-convo.current .hc-rail-convo-name')?.textContent).toBe('what is this')
  })

  it('a deeper conversation stays out of this layer until you are there', async () => {
    const convoNames = (): string[] =>
      [...host.querySelectorAll('.hc-rail-convo-name')].map(node => node.textContent ?? '')

    expect(convoNames()).toEqual(['what is this'])
    expect(convoNames()).not.toContain('down here')

    rows()[0].click()
    await settle()

    expect(names(host)).toEqual(['inside'])
    expect(convoNames()).toEqual(['down here'])

    await back()

    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(convoNames()).toEqual(['what is this'])
  })

  it('a click on a leaf moves into it, and coming back puts its conversation in view', async () => {
    rows()[1].click()
    await settle()

    expect(entered).toEqual([])
    expect(rail.subject?.name).toBe('diagrams')
    expect(rail.here()).toEqual(['diagrams'])
    expect(names(host)).toEqual([])

    await back()

    expect(entered).toEqual(['diagrams'])
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(host.querySelector(`${TILE_ROWS} .hc-rail-row.current .hc-rail-name`)?.textContent).toBe('diagrams')
  })

  it('one conversation at a time — opening another lets the first go', async () => {
    rows()[1].click()
    await settle()
    await back()
    rows()[2].click()
    await settle()

    expect(entered).toEqual(['diagrams'])
    expect(rail.subject?.name).toBe('ai-videos')
    expect(rail.here()).toEqual(['ai-videos'])
  })

  it('the layer you move into still offers exactly one + New conversation', async () => {
    // /pheromone-workflow has never been spoken to. Moving into it is the
    // way onto that layer, and the layer's own list is where a new thread
    // starts. The click does not unfold a tile fold on the way through.
    rows()[0].click()
    await settle()

    expect(names(host)).toEqual(['inside'])
    expect(rail.subject?.name).toBe('pheromone-workflow')
    expect(entered).toEqual([])
    expect(host.querySelectorAll('.hc-rail-convos-new').length).toBe(1)
    expect(host.querySelector('.hc-rail-convos-new')?.textContent).toBe('+ New conversation')
    expect(host.querySelector('.hc-rail-chat-body')).toBeNull()
  })

  it('coming back puts you in the conversation the click opened', async () => {
    rows()[1].click()
    await settle()
    expect(entered).toEqual([])
    expect(host.querySelector('.hc-rail-chats')).toBeFalsy()

    await back()

    expect(entered).toEqual(['diagrams'])
    expect(rail.subject?.name).toBe('diagrams')
    expect(host.querySelector('.hc-rail-convo.current .hc-rail-convo-name')?.textContent).toBe('what is this')
    // Coming back announces the conversation. It does not unfold the tile.
    expect(host.querySelector('.hc-rail-chats')).toBeFalsy()
  })

  it('an ARCHIVED conversation is out of the fold, behind a count', async () => {
    // /diagrams holds two threads: one live, one put away. Opening the
    // thread from the layer list shows the live one and says the other
    // exists — it does not list it, and it does not pretend it is gone.
    await openThread('what is this')

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
    // next one — at the bottom, where the list grows. The layer's
    // conversation row is what unfolds it.
    await openThread('what is this')

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

  it('no row carries an archive mark — putting one away is done from the pane', async () => {
    // The list's job is to be scanned for a NAME. Archiving belongs to the
    // conversation you have OPENED, where the pane already carries every
    // other thing you can do to it — so no row, current or not, wears a
    // control for it.
    await openThread('what is this')

    expect(host.querySelector('.hc-rail-chat.current')).toBeTruthy()
    expect(host.querySelector('.hc-rail-chat-put')).toBeNull()

    // And READING what was put away is untouched: the disclosure still says
    // how many, and still opens onto them.
    const disclosure = host.querySelector('.hc-rail-archived') as HTMLButtonElement
    expect(disclosure.textContent).toContain('1')
    disclosure.click()
    await settle()
    expect([...host.querySelectorAll('.hc-rail-chat-name')].map(n => n.textContent))
      .toEqual(['what is this', 'the old thread'])
    expect(host.querySelector('.hc-rail-chat-put')).toBeNull()
  })

  it('right-click comes back one layer', async () => {
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()
    expect(names(host)).toEqual(['inside'])
    expect(rail.here()).toEqual(['pheromone-workflow'])

    await back()
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
  })

  it('the keyboard drills one layer and comes back', async () => {
    const key = (el: Element, k: string): void => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    }

    key(rows()[0], 'ArrowRight')
    await settle()
    expect(names(host)).toEqual(['inside'])
    expect(rail.here()).toEqual(['pheromone-workflow'])
    expect(document.activeElement).toBe(rows()[0])

    key(rows()[0], 'ArrowLeft')
    await settle()
    expect(names(host)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])

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

  it('says which layer you moved into', async () => {
    expect(rows()[1].title).toBe('Move into diagrams')
    rows()[1].click()
    await settle()

    expect(rail.here()).toEqual(['diagrams'])
    expect(host.querySelector('.hc-rail-title')?.textContent).toBe('diagrams')
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

    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()
    expect(rail.selectionSigs).toEqual(sigs)

    await back()
    expect(rail.selectionSigs).toEqual(sigs)
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

  it('a list without chats still picks on click and walks one level on the arrow', async () => {
    const bare = document.createElement('div')
    document.body.appendChild(bare)
    const notes = new AgentTilesRail({ chats: false })
    const picked: Array<string | null> = []
    notes.onSubjectChanged = subject => picked.push(subject?.name ?? null)
    notes.mount(bare)
    await settle()

    const line = bare.querySelector(`${TILE_ROWS} .hc-rail-main`) as HTMLButtonElement
    line.click()
    await settle()
    expect(names(bare)).toEqual(['pheromone-workflow', 'diagrams', 'ai-videos'])
    expect(picked).toEqual(['pheromone-workflow'])

    const walk = bare.querySelector(`${TILE_ROWS} .hc-rail-walk`) as HTMLButtonElement
    expect(walk.getAttribute('aria-label')).toBe('Go inside pheromone-workflow')
    walk.click()
    await settle()
    expect(names(bare)).toEqual(['inside'])
    expect(picked).toEqual(['pheromone-workflow'])

    notes.dispose()
    bare.remove()
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
//   • ONE LINE, AND THE SAME BOX IN EVERY STATE. The points used to be drawn
//     under the conversation you had opened, which made the row you pressed
//     grow and shunted every row below it — the list moved under your hand.
//     They are still minted and still feed the find field; they are simply
//     not drawn here. Reading them is what opening the conversation is for.
describe('tiles rail — the blurb on a conversation', () => {
  let host: HTMLElement
  let rail: InstanceType<typeof AgentTilesRail>

  /** Unfold /diagrams' conversations from the layer list. A click on the
   *  tile itself moves into that layer. */
  const unfold = async (): Promise<void> => {
    const convo = [...host.querySelectorAll('.hc-rail-convo')]
      .find(node => (node.textContent ?? '').includes('what is this')) as HTMLButtonElement
    convo.click()
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

  it('shows the line under the title, and never the points', async () => {
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

    // Unfolding puts you IN this conversation — and it draws no more than any
    // other row does. The points are held, not shown.
    expect(host.querySelector('.hc-rail-chat.current')).toBeTruthy()
    expect(points()).toEqual([])
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

  it('the open conversation is built from the same parts as any other', async () => {
    // CHOOSING IS NOT A LAYOUT EVENT. The row you press must be the box it
    // already was — same children, same order — so the list cannot move under
    // your hand while you are choosing from it. A blurb WITH points is the
    // case that used to break this.
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

    const open = host.querySelector('.hc-rail-chat.current') as HTMLElement
    expect(open).toBeTruthy()
    expect(host.querySelector('.hc-rail-chat-points')).toBeNull()
    expect([...open.children].map(node => node.className)).toEqual(['hc-rail-chat-body'])
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
  it('right-click comes back out from the row', async () => {
    ;(host.querySelectorAll(`${TILE_ROWS} .hc-rail-main`)[0] as HTMLButtonElement).click()
    await settle()
    expect(names(host)).toEqual(['inside'])

    host.querySelector(`${TILE_ROWS} .hc-rail-main`)
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

  it('its line opens on the first press and folds once the conversation is in view', async () => {
    const line = () => hive().querySelector('.hc-rail-main') as HTMLButtonElement
    line().click()
    await settle()
    expect(rail.subject?.key).toBe('')
    expect(host.querySelector('.hc-rail-hive .hc-rail-chats')).toBeFalsy()

    line().click()
    await settle()
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

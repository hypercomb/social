// didyouknow/didyouknow.service.spec.ts — the service half of Did You Know, with
// the hive's neighbours faked: the lineage (which page you stand on), the notes,
// the swarm's notes and tiles, the layers' children, and the toggle's marks.
//
// What it pins is what the three-browser proof cannot say cheaply: the game's
// tile is NAMED FOR ITS LAYER, the room's tile is found by that name and no
// other, and the host's ledger is kept PER LAYER, so a reveal on one layer
// never names the ideas seen on another.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  joined: true,
  page: [] as string[],
  /** layer path → the tiles on that layer */
  children: new Map<string, { name: string; childCount: number }[]>(),
  /** layers that declare the game on */
  marks: new Set<string>(),
  /** `<layer path>/<tile>` → the notes the hive holds on that tile */
  notes: new Map<string, { id: string; text: string }[]>(),
  /** `<layer path>/<tile>` → what the room shows on that tile */
  room: new Map<string, { note: { id: string; text: string }; by: string; holders: string[] }[]>(),
  peers: [] as { name: string; peerPubkey: string }[],
  /** while set, the swarm's `refresh` waits on it — a read that takes a while */
  hold: null as Promise<void> | null,
  /** how many refreshes have started */
  refreshing: 0,
  /** the ids each `take` was asked for */
  taken: [] as string[][],
}))

vi.mock('@hypercomb/core', async (original) => ({
  ...(await original<typeof import('@hypercomb/core')>()),
  hypercomb: class { async act(): Promise<void> { /* the processor pass is not under test */ } },
}))
vi.mock('../history/layer-placement.js', () => ({
  readChildrenStrict: async (_history: unknown, _domain: unknown, page: readonly string[]) =>
    state.children.get(page.join('/')) ?? [],
}))
vi.mock('../sharing/membership.js', () => ({ isJoinedHere: () => state.joined }))
vi.mock('../sharing/behavior-enablement.js', () => ({ readGlobalOffKinds: () => new Set<string>() }))
vi.mock('./scope.js', () => ({
  declarationsAt: async (segments: readonly string[]) => state.marks.has(segments.join('/')) ? [{ sig: 'mark' }] : [],
  declaredAt: async (segments: readonly string[]) => {
    for (let depth = segments.length; depth >= 0; depth--) if (state.marks.has(segments.slice(0, depth).join('/'))) return segments.slice(0, depth)
    return null
  },
  enableAt: async (segments: readonly string[]) => { state.marks.add(segments.join('/')) },
  disableAt: async (segments: readonly string[]) => { state.marks.delete(segments.join('/')) },
}))

import { EffectBus } from '@hypercomb/core'
import { gameTileName } from './didyouknow.js'

const key = (page: readonly string[], tile: string): string => [...page, tile].join('/')

/** The swarm's notes, as the service sees them: it reads the room's roots for
 *  a tile of the page you stand on, and says who a key is. */
class FakeSwarmNotes extends EventTarget {
  async refresh(): Promise<void> { state.refreshing++; await state.hold /* the room is already in `state.room` */ }
  rootsFor(cell: string) { return state.room.get(key(state.page, cell)) ?? [] }
  async take(_cell: string, ids: readonly string[]): Promise<string[]> { state.taken.push([...ids]); return [] }
  labelOf(pubkey: string): string { return ({ kBen: 'Ben', kCy: 'Cy' } as Record<string, string>)[pubkey] ?? pubkey.slice(0, 8) }
  seenAt(): number | undefined { return undefined }
}

let swarmNotes: FakeSwarmNotes
let made: { cell: string; segments: string[] }[]
let opened: string[]
const off: (() => void)[] = []

async function boot() {
  const registry = new Map<string, unknown>()
  const waiting = new Map<string, ((v: unknown) => void)[]>()
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (k: string) => registry.get(k),
    register: (k: string, v: unknown) => { registry.set(k, v); for (const cb of waiting.get(k) ?? []) cb(v) },
    whenReady: (k: string, cb: (v: unknown) => void) => { if (registry.has(k)) cb(registry.get(k)); else waiting.set(k, [...(waiting.get(k) ?? []), cb]) },
  }
  const ioc = (window as unknown as { ioc: { register(k: string, v: unknown): void } }).ioc
  swarmNotes = new FakeSwarmNotes()
  ioc.register('@diamondcoreprocessor.com/SwarmNotes', swarmNotes)
  ioc.register('@hypercomb.social/Lineage', { explorerSegments: () => [...state.page], domain: {} })
  ioc.register('@diamondcoreprocessor.com/HistoryService', {})
  ioc.register('@diamondcoreprocessor.com/LayerCommitter', { settled: async () => undefined })
  ioc.register('@diamondcoreprocessor.com/NostrSigner', { getPublicKeyHex: async () => 'kMe' })
  ioc.register('@diamondcoreprocessor.com/SwarmDrone', {
    peerTilesAtCurrentSig: () => state.peers,
    labelFor: (pubkey: string) => ({ kBen: 'Ben' } as Record<string, string>)[pubkey] ?? '',
    myLabel: () => 'Ana',
  })
  ioc.register('@diamondcoreprocessor.com/NotesService', {
    getNotesAtSegments: async (segments: readonly string[]) => state.notes.get(segments.join('/')) ?? [],
    addAtSegments: async (parent: readonly string[], cell: string, text: string) => {
      const at = key(parent, cell)
      state.notes.set(at, [...(state.notes.get(at) ?? []), { id: `id:${text}`, text }])
    },
  })
  const { DidYouKnow } = await import('./didyouknow.service.js')
  return new DidYouKnow()
}

beforeEach(() => {
  state.joined = true
  state.page = []
  state.children.clear(); state.marks.clear(); state.notes.clear(); state.room.clear(); state.peers = []
  state.hold = null; state.refreshing = 0; state.taken = []
  state.marks.add('') // the game is on everywhere unless a test says otherwise
  made = []; opened = []
  // The bus replays the last value to a new listener: start every test clean.
  EffectBus.clear()
  // A tile made through the add the `create` word runs lands on its layer.
  off.push(EffectBus.on<{ cell: string; segments: string[] }>('cell:added', (p) => {
    made.push({ cell: p.cell, segments: [...p.segments] })
    const layer = p.segments.join('/')
    state.children.set(layer, [...(state.children.get(layer) ?? []), { name: p.cell, childCount: 0 }])
  }))
  off.push(EffectBus.on<{ cellLabel?: string }>('note:capture', (p) => { if (p?.cellLabel) opened.push(p.cellLabel) }))
})

afterEach(() => { while (off.length) off.pop()!() })

describe('the game\'s tile is named for its layer', () => {
  it('sharing at the root makes `did-you-know` and writes the idea on it', async () => {
    const game = await boot()
    expect(await game.share('octopuses have three hearts')).toBe('shared')
    expect(made).toEqual([{ cell: 'did-you-know', segments: [] }])
    expect(state.notes.get('did-you-know')?.map(n => n.text)).toEqual(['octopuses have three hearts'])
    expect(opened).toEqual(['did-you-know'])
  })

  it('sharing below makes the layer\'s own tile, and the idea lands on that tile only', async () => {
    const game = await boot()
    state.page = ['lecture']
    expect(await game.share('light bends around heavy things')).toBe('shared')
    expect(made).toEqual([{ cell: 'did-you-know-lecture', segments: ['lecture'] }])
    expect(state.notes.get('lecture/did-you-know-lecture')?.map(n => n.text)).toEqual(['light bends around heavy things'])
    expect(state.notes.has('did-you-know')).toBe(false)
    expect(state.notes.has('lecture/did-you-know')).toBe(false)
  })

  it('two layers keep two lists: an idea on one is not on the other', async () => {
    const game = await boot()
    await game.share('on the root')
    state.page = ['lecture']
    await game.share('in the lecture')
    state.page = ['lecture', 'biology']
    await game.share('in the biology')
    expect(state.notes.get('did-you-know')?.map(n => n.text)).toEqual(['on the root'])
    expect(state.notes.get('lecture/did-you-know-lecture')?.map(n => n.text)).toEqual(['in the lecture'])
    expect(state.notes.get('lecture/biology/did-you-know-lecture-biology')?.map(n => n.text)).toEqual(['in the biology'])
  })

  it('finds the layer\'s tile when it is already there and makes no second one', async () => {
    const game = await boot()
    state.page = ['lecture']
    state.children.set('lecture', [{ name: 'did-you-know-lecture', childCount: 0 }])
    await game.share('an idea')
    expect(made).toEqual([])
    expect(opened).toEqual(['did-you-know-lecture'])
  })

  it('finds the tile whichever way its name is spelled', async () => {
    const game = await boot()
    state.page = ['lecture']
    state.children.set('lecture', [{ name: 'Did You Know Lecture', childCount: 0 }])
    await game.share('an idea')
    expect(made).toEqual([])
    expect(opened).toEqual(['Did You Know Lecture'])
  })

  it('does not take another layer\'s game tile, or a tile that merely starts like it, for its own', async () => {
    const game = await boot()
    state.page = ['lecture']
    state.children.set('lecture', [
      { name: 'did-you-know', childCount: 0 },          // the root's game, sitting here as an ordinary tile
      { name: 'did-you-know-about-cats', childCount: 0 }, // a tile of the person's own
    ])
    await game.share('an idea')
    expect(made).toEqual([{ cell: 'did-you-know-lecture', segments: ['lecture'] }])
    expect(state.notes.get('lecture/did-you-know-lecture')?.map(n => n.text)).toEqual(['an idea'])
  })

  it('names the tile for a layer without making one', async () => {
    const game = await boot()
    expect(game.tileNameFor([])).toBe('did-you-know')
    expect(game.tileNameFor(['lecture', 'biology'])).toBe(gameTileName(['lecture', 'biology']))
  })

  it('`start` makes the layer\'s tile, opens the desk on it and says where it is', async () => {
    const game = await boot()
    state.page = ['lecture']
    state.marks.clear()
    const result = await game.start()
    expect(result).toEqual({ outcome: 'started', where: 'lecture/did-you-know-lecture' })
    expect(opened).toEqual(['did-you-know-lecture'])
    expect(state.marks.has('lecture')).toBe(true)
    const again = await game.start()
    expect(again.outcome).toBe('resumed')
    expect(made).toHaveLength(1)
  })
})

describe('a room already playing is enough, but only on the layer it plays', () => {
  it('is off where nothing declares the game and no peer holds its tile', async () => {
    const game = await boot()
    state.marks.clear()
    state.page = ['lecture']
    expect(await game.availability(['lecture'])).toBe('off')
  })

  it('is on when a peer holds this layer\'s game tile', async () => {
    const game = await boot()
    state.marks.clear()
    state.page = ['lecture']
    state.peers = [{ name: 'did-you-know-lecture', peerPubkey: 'kBen' }]
    expect(await game.availability(['lecture'])).toBe('ok')
  })

  it('is not on because a peer holds another layer\'s game tile', async () => {
    const game = await boot()
    state.marks.clear()
    state.page = ['lecture']
    state.peers = [{ name: 'did-you-know', peerPubkey: 'kBen' }, { name: 'did-you-know-other', peerPubkey: 'kBen' }]
    expect(await game.availability(['lecture'])).toBe('off')
  })
})

describe('the ledger is kept per layer', () => {
  const ben = { note: { id: 'b1', text: 'honey never spoils' }, by: 'kBen', holders: ['kBen'] }
  const cy = { note: { id: 'c1', text: 'a day on Venus is longer than its year' }, by: 'kCy', holders: ['kCy'] }

  function seeRoom(page: string[], tile: string, roots: typeof ben[]) {
    state.room.set(key(page, tile), roots)
    state.page = page
    swarmNotes.dispatchEvent(new CustomEvent('change', { detail: { cell: tile } }))
  }

  it('records what the room shows on the layer\'s own tile, and only there', async () => {
    const game = await boot()
    seeRoom([], 'did-you-know', [ben])
    expect([...game.seen().keys()]).toEqual(['b1'])
    // a change on a tile that is not this layer's game is not recorded
    seeRoom([], 'did-you-know-lecture', [cy])
    seeRoom([], 'lecture', [cy])
    expect([...game.seen().keys()]).toEqual(['b1'])
  })

  it('a layer\'s ledger is its own: standing elsewhere shows nothing of it', async () => {
    const game = await boot()
    seeRoom([], 'did-you-know', [ben])
    seeRoom(['lecture'], 'did-you-know-lecture', [cy])
    expect([...game.seen().keys()]).toEqual(['c1'])
    state.page = []
    expect([...game.seen().keys()]).toEqual(['b1'])
  })

  it('a reveal on a layer names that layer\'s ideas and no others', async () => {
    const game = await boot()
    seeRoom([], 'did-you-know', [ben])                       // the root's room: Ben's idea
    state.children.set('lecture', [{ name: 'did-you-know-lecture', childCount: 0 }])
    state.notes.set('lecture/did-you-know-lecture', [{ id: 'a1', text: 'light bends around heavy things' }])
    seeRoom(['lecture'], 'did-you-know-lecture', [])         // the lecture's room: only the host's own idea
    const result = await game.reveal()
    expect(result).toEqual({ ideas: 1, people: 1 })
    const written = state.notes.get('lecture/did-you-know-lecture')!.map(n => n.text).find(t => t.startsWith('Revealed ·'))!
    expect(written).toBe('Revealed · 1 idea\n1. light bends around heavy things — Ana')
    expect(written).not.toContain('honey never spoils')
  })

  it('and the root\'s reveal names the root\'s ideas, not the lecture\'s', async () => {
    const game = await boot()
    seeRoom([], 'did-you-know', [ben])
    state.children.set('', [{ name: 'did-you-know', childCount: 0 }])
    seeRoom(['lecture'], 'did-you-know-lecture', [cy])
    state.page = []
    state.room.set('did-you-know', [ben])
    const result = await game.reveal()
    expect(result).toEqual({ ideas: 1, people: 1 })
    const written = state.notes.get('did-you-know')!.map(n => n.text).find(t => t.startsWith('Revealed ·'))!
    expect(written).toBe('Revealed · 1 idea\n1. honey never spoils — Ben')
    expect(written).not.toContain('Venus')
  })

  it('a layer reached by two spellings of its path is one game with one ledger', async () => {
    const game = await boot()
    seeRoom(['Big Ideas'], 'did-you-know-big-ideas', [ben])
    state.page = ['Big-Ideas']
    expect([...game.seen().keys()]).toEqual(['b1'])
    state.page = ['big_ideas']
    expect([...game.seen().keys()]).toEqual(['b1'])
  })

  it('a reveal on one layer leaves another layer\'s game unrevealed, and the root\'s second reveal is still refused', async () => {
    const game = await boot()
    state.children.set('', [{ name: 'did-you-know', childCount: 0 }])
    state.notes.set('did-you-know', [{ id: 'r', text: 'Revealed · 1 idea\n1. an old idea — Ben' }])
    state.page = ['lecture']
    state.children.set('lecture', [{ name: 'did-you-know-lecture', childCount: 0 }])
    state.notes.set('lecture/did-you-know-lecture', [{ id: 'a1', text: 'a new idea' }])
    // the root's game was revealed long ago; the lecture's has not been
    expect(await game.reveal()).toEqual({ ideas: 1, people: 1 })
    state.page = []
    expect(await game.reveal()).toBe('already')
  })
})

describe('a word said on one layer is finished on that layer, whatever the host does while it runs', () => {
  const venus = { note: { id: 'c1', text: 'a day on Venus is longer than its year' }, by: 'kCy', holders: ['kCy'] }

  /** Start `say` with the swarm's read held open, move the host to `to` while
   *  it waits, then let the read finish. */
  async function movedWhileReading<T>(say: () => Promise<T>, to: string[]): Promise<T> {
    let release!: () => void
    state.hold = new Promise<void>(resolve => { release = resolve })
    const pending = say()
    await vi.waitFor(() => expect(state.refreshing).toBeGreaterThan(0))
    state.page = to
    release()
    return pending
  }

  it('a reveal names the layer it was said on, not the layer the host moved to', async () => {
    const game = await boot()
    // /other's room holds Cy's idea, seen by this tab
    state.room.set(key(['other'], 'did-you-know-other'), [venus])
    state.page = ['other']
    swarmNotes.dispatchEvent(new CustomEvent('change', { detail: { cell: 'did-you-know-other' } }))
    // the host stands on /lecture with one idea of their own and says reveal
    state.page = ['lecture']
    state.children.set('lecture', [{ name: 'did-you-know-lecture', childCount: 0 }])
    state.notes.set('lecture/did-you-know-lecture', [{ id: 'a1', text: 'light bends around heavy things' }])
    const result = await movedWhileReading(() => game.reveal(), ['other'])
    expect(result).toEqual({ ideas: 1, people: 1 })
    const written = state.notes.get('lecture/did-you-know-lecture')!.map(n => n.text).find(t => t.startsWith('Revealed ·'))!
    expect(written).toBe('Revealed · 1 idea\n1. light bends around heavy things — Ana')
    expect(written).not.toContain('Venus')
    expect(state.notes.has('other/did-you-know-other')).toBe(false)
  })

  it('a collect that finds the host somewhere else takes nothing', async () => {
    const game = await boot()
    state.page = ['lecture']
    state.children.set('lecture', [{ name: 'did-you-know-lecture', childCount: 0 }])
    state.room.set(key(['lecture'], 'did-you-know-lecture'), [venus])
    const result = await movedWhileReading(() => game.collect(), ['other'])
    expect(result).toBe('none')
    expect(state.taken).toEqual([])
  })

  it('a collect that stays where it was said takes the room\'s ideas', async () => {
    const game = await boot()
    state.page = ['lecture']
    state.children.set('lecture', [{ name: 'did-you-know-lecture', childCount: 0 }])
    state.room.set(key(['lecture'], 'did-you-know-lecture'), [venus])
    expect(await game.collect()).toEqual({ taken: 1, waiting: 0 })
    expect(state.taken).toEqual([['c1']])
  })
})

// `take <signature>` brings a published tile a read found into this hive,
// through the one fold every explicit adopt uses. It asks, it never signs.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: { ioc?: unknown } }).window.ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
    list: () => [],
  }
})

const SIG = 'a'.repeat(64)

type Branch = { layerSig: string; at: string[]; domain?: string; label: string }
type Outcome = 'committed' | 'exists' | 'rewound' | 'unavailable' | 'declined' | 'uninspectable'

let page: string[] = []
/** The hive, as the tiles each route holds. */
let tree: Record<string, string[]> = {}
let walk: { layers: number; failed: number } | null = { layers: 3, failed: 0 }
let layer: { name?: unknown } | null = { name: 'recipes' }
let outcome: Outcome = 'committed'
/** What the fold says on `features:outcome` before it answers. */
let explains = ''
const adopted: { branch: Branch; opts: unknown }[] = []
const walked: { sig: string; opts: unknown }[] = []

const { HIVE_TREE_READER_IOC_KEY } = await import('./hive-tree-reader.js')
const services: Record<string, unknown> = {
  '@hypercomb.social/Lineage': { explorerSegments: () => page },
  '@diamondcoreprocessor.com/SwarmAdoptDrone': {
    adoptResolvedBranch: async (branch: Branch, opts: unknown) => {
      adopted.push({ branch, opts })
      if (explains) EffectBus.emit('features:outcome', { cell: branch.label, kind: '', ok: false, message: explains })
      return outcome
    },
  },
  '@diamondcoreprocessor.com/ContentBrokerDrone': {
    adopt: async (sig: string, opts: unknown) => { walked.push({ sig, opts }); return walk },
  },
  '@diamondcoreprocessor.com/HistoryService': { getLayerBySig: async () => layer },
  [HIVE_TREE_READER_IOC_KEY]: {
    readNode: async (segments: readonly string[]) => {
      const held = tree[segments.join('/')]
      return held ? { ok: true, children: held.map(name => ({ name })) } : { ok: false, code: 'not-found' }
    },
  },
}
;(window as unknown as { ioc: { get(key: string): unknown } }).ioc.get = (key: string) => services[key]

const { TakeQueenBee, parseTake, TAKE_MAX_TILES } = await import('./take.queen.js')
type Runnable = { execute(args: string): Promise<void>; machine: { refuse(args: string): string | undefined; reach: string; scope: string } }
const queen = (): Runnable => new TakeQueenBee() as unknown as Runnable

const toasts: string[] = []
EffectBus.on<{ message?: string }>('toast:show', payload => { toasts.push(String(payload?.message ?? '')) })

beforeEach(() => {
  page = []
  tree = { '': ['workshop'], workshop: ['printers'], 'workshop/printers': [] }
  walk = { layers: 3, failed: 0 }
  layer = { name: 'recipes' }
  outcome = 'committed'
  explains = ''
  adopted.length = 0
  walked.length = 0
  toasts.length = 0
})

describe('what a take line asks for', () => {
  it('reads a signature alone, and a signature with a page', () => {
    expect(parseTake(SIG)).toEqual({ sig: SIG, route: null })
    expect(parseTake(`  ${SIG.toUpperCase()}  `)).toEqual({ sig: SIG, route: null })
    expect(parseTake(`${SIG} at /`)).toEqual({ sig: SIG, route: [] })
    expect(parseTake(`${SIG} at /workshop/printers`)).toEqual({ sig: SIG, route: ['workshop', 'printers'] })
    // A tile name may hold spaces: the route is everything after `at`.
    expect(parseTake(`${SIG} at /Host your hive/notes`)).toEqual({ sig: SIG, route: ['Host your hive', 'notes'] })
  })

  it('refuses a name, a host, a short signature, and a route that is no route', () => {
    for (const line of ['', 'recipes', 'https://card.example', SIG.slice(1), `${SIG} recipes`, `${SIG} at workshop`, `${SIG} into /workshop`]) {
      expect(parseTake(line), line).toContain('take <signature>')
    }
    expect(parseTake(`${SIG} at /work${String.fromCharCode(92)}shop`)).toContain('not a page')
  })

  it('offers a model the same rule before anything runs, additive and within the hive', () => {
    const { machine } = queen()
    expect(machine.refuse(SIG)).toBeUndefined()
    expect(machine.refuse(`${SIG} at /workshop`)).toBeUndefined()
    expect(machine.refuse('recipes')).toContain('take <signature>')
    expect(machine).toMatchObject({ reach: 'additive', scope: 'hive' })
  })
})

describe('take <signature>', () => {
  it('folds the tile onto the page the participant is on, through the one adopt', async () => {
    page = ['workshop']
    await queen().execute(SIG)
    // Counted by layers only, quietly: no pictures fetched, no view switched.
    expect(walked).toEqual([{ sig: SIG, opts: { layersOnly: true, silent: true, quiet: true } }])
    // No host is named: the fold asks the hosts this hive already asks.
    expect(adopted).toEqual([{ branch: { layerSig: SIG, at: ['workshop'], label: 'recipes' }, opts: { silent: true } }])
    expect(toasts.at(-1)).toBe('took “recipes” and 2 tiles under it to /workshop')
  })

  it('lands on the page a route names, and on the first page for `at /`', async () => {
    page = ['workshop']
    await queen().execute(`${SIG} at /workshop/printers`)
    await queen().execute(`${SIG} at /`)
    expect(adopted.map(call => call.branch.at)).toEqual([['workshop', 'printers'], []])
    expect(toasts.at(-1)).toBe('took “recipes” and 2 tiles under it to the first page')
  })

  it('says a lone tile plainly, and one tile under it in the singular', async () => {
    walk = { layers: 1, failed: 0 }
    await queen().execute(SIG)
    expect(toasts.at(-1)).toBe('took “recipes” to the first page')
    walk = { layers: 2, failed: 0 }
    await queen().execute(SIG)
    expect(toasts.at(-1)).toBe('took “recipes” and 1 tile under it to the first page')
  })

  it('says so when a tile of that name was already there: its own values stay', async () => {
    tree[''] = ['workshop', 'recipes']
    await queen().execute(SIG)
    expect(adopted).toHaveLength(1)
    expect(toasts.at(-1)).toBe('“recipes” was already at the first page: it kept its own values and gained what it lacked')
  })
})

describe('a take that did not happen throws, and folds nothing', () => {
  const refused = async (line: string): Promise<string> => {
    let message = ''
    await queen().execute(line).catch((error: Error) => { message = error.message })
    return message
  }

  it('a route that names no page', async () => {
    expect(await refused(`${SIG} at /nowhere`)).toBe('there is no page at /nowhere; nothing was taken')
    expect(walked).toEqual([])
    expect(adopted).toEqual([])
  })

  it('a signature no host holds, or one only partly reachable', async () => {
    walk = { layers: 0, failed: 1 }
    expect(await refused(SIG)).toContain('no host this hive can ask holds a tile')
    walk = null
    expect(await refused(SIG)).toContain('no host this hive can ask holds a tile')
    walk = { layers: 4, failed: 1 }
    expect(await refused(SIG)).toContain('could not be reached from any host')
    expect(adopted).toEqual([])
  })

  it('more tiles than one take brings, with the way to take a part', async () => {
    walk = { layers: TAKE_MAX_TILES + 1, failed: 0 }
    const message = await refused(SIG)
    expect(message).toContain(`that is ${TAKE_MAX_TILES + 1} tiles`)
    expect(message).toContain(`read ${SIG}`)
    expect(adopted).toEqual([])
    walk = { layers: TAKE_MAX_TILES, failed: 0 }
    expect(await refused(SIG)).toBe('')
  })

  it('a signature that names no tile, or a name that would break a route', async () => {
    layer = null
    expect(await refused(SIG)).toContain('does not name a tile')
    layer = { name: 'a/b' }
    expect(await refused(SIG)).toContain('does not name a tile')
    layer = { name: 42 }
    expect(await refused(SIG)).toContain('does not name a tile')
    expect(adopted).toEqual([])
  })

  it('a hive showing its history', async () => {
    outcome = 'rewound'
    expect(await refused(SIG)).toContain('return to the present')
  })

  it('code, in the fold\'s own words when it gave them', async () => {
    outcome = 'unavailable'
    explains = '"recipes" brings code — nothing was folded'
    expect(await refused(SIG)).toBe('"recipes" brings code — nothing was folded. Nothing was taken now')
    explains = ''
    expect(await refused(SIG)).toContain('it carries code, which a take never brings')
  })

  it('never takes an older take\'s refusal for its own', async () => {
    // The bus replays the last `features:outcome` to whoever joins.
    EffectBus.emit('features:outcome', { cell: 'recipes', kind: '', ok: false, message: 'an earlier refusal' })
    outcome = 'uninspectable'
    expect(await refused(SIG)).not.toContain('an earlier refusal')
  })

  it('a hive with no adopt, broker, history or reader', async () => {
    const kept = services['@diamondcoreprocessor.com/SwarmAdoptDrone']
    services['@diamondcoreprocessor.com/SwarmAdoptDrone'] = undefined
    try {
      expect(await refused(SIG)).toBe('taking a published tile is not available here; nothing was taken')
    } finally {
      services['@diamondcoreprocessor.com/SwarmAdoptDrone'] = kept
    }
  })
})

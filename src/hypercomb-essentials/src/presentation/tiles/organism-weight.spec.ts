import { describe, it, expect, beforeEach } from 'vitest'
import { setTileStacks, type StackVariant } from './tile-stack.js'
import { swarmAnswers, holderWeights, descendantWeights, organismWeights } from './organism-weight.js'

const variant = (pubkey: string): StackVariant => ({ pubkey })

const stack = (entries: Record<string, string[]>): void => {
  setTileStacks(new Map(Object.entries(entries).map(([label, keys]) => [label, keys.map(variant)])))
}

/** A history stub shaped like PlacementHistory: a tree of {name, children}
 *  addressed by sig, exactly how a layer names its children. */
type Node = { name: string; kids?: Node[] }

const historyOf = (root: Node) => {
  const bySig = new Map<string, { name: string; children: string[] }>()
  let n = 0
  const add = (node: Node): string => {
    const sig = `sig-${n++}`
    const children = (node.kids ?? []).map(add)
    bySig.set(sig, { name: node.name, children })
    return sig
  }
  const rootSig = add(root)
  const history = {
    getLayerBySig: async (sig: string) => bySig.get(sig) ?? null,
    currentLayerAt: async () => bySig.get(rootSig) ?? null,
    sign: async () => 'loc',
  }
  return <T,>(key: string): T | undefined =>
    key.endsWith('/HistoryService') ? (history as unknown as T) : undefined
}

const unavailable = <T,>(): T | undefined => undefined

beforeEach(() => setTileStacks(new Map()))

describe('swarmAnswers', () => {
  it('is false on a hive nobody else has published into', () => {
    stack({ notes: [''], drafts: [''] })
    expect(swarmAnswers(['notes', 'drafts'])).toBe(false)
  })

  it('turns true as soon as ONE tile is held by someone else too', () => {
    stack({ notes: [''], drafts: ['', 'peer-a'] })
    expect(swarmAnswers(['notes', 'drafts'])).toBe(true)
  })

  it('does not answer for tiles that are not on the page', () => {
    stack({ elsewhere: ['', 'peer-a'] })
    expect(swarmAnswers(['notes'])).toBe(false)
  })
})

describe('holderWeights', () => {
  it('counts the participants holding each tile', () => {
    stack({ notes: ['', 'peer-a', 'peer-b'], drafts: ['peer-a'] })
    const w = holderWeights(['notes', 'drafts'])
    expect(w.get('notes')).toBe(3)
    expect(w.get('drafts')).toBe(1)
  })

  it('scores a tile with no stack entry as ONE, because you are holding it', () => {
    // show-cell only files a stack entry when a PEER published the name, so a
    // tile only you hold is absent from the map entirely. Reading that as 0
    // says nobody holds a tile you are looking at.
    stack({ notes: ['', 'peer-a'] })
    expect(holderWeights(['mine']).get('mine')).toBe(1)
  })

  it('does not rank a peer-only tile above every tile of your own', () => {
    // The bug this pins: `sketch` is a peer's tile you have not adopted, so
    // it has a one-entry stack; `mine` has none. Both have exactly one
    // holder and must weigh the same.
    stack({ sketch: ['peer-b'] })
    const w = holderWeights(['mine', 'sketch'])
    expect(w.get('mine')).toBe(w.get('sketch'))
  })
})

describe('descendantWeights', () => {
  const PAGE: Node = {
    name: 'page',
    kids: [
      { name: 'notes', kids: [{ name: 'a', kids: [{ name: 'x' }, { name: 'y' }] }, { name: 'b' }] },
      { name: 'drafts', kids: [{ name: 'x' }] },
      { name: 'leaf' },
    ],
  }

  it('scores a tile by its own children plus what hangs beneath them', async () => {
    const w = await descendantWeights([], ['notes', 'drafts', 'leaf'], historyOf(PAGE))
    // notes: 2 children (a, b) + 2 under a = 4
    expect(w.get('notes')).toBe(4)
    expect(w.get('drafts')).toBe(1)
    expect(w.get('leaf')).toBe(0)
  })

  it('separates tiles that depth 1 alone would score the same', async () => {
    const flat: Node = {
      name: 'page',
      kids: [
        { name: 'full', kids: [{ name: 'a', kids: [{ name: '1' }, { name: '2' }] }, { name: 'b' }] },
        { name: 'empty', kids: [{ name: 'a' }, { name: 'b' }] },
      ],
    }
    const w = await descendantWeights([], ['full', 'empty'], historyOf(flat))
    expect(w.get('full')).toBeGreaterThan(w.get('empty') ?? 0)
  })

  it('scores a tile the page does not name as 0 rather than omitting it', async () => {
    const w = await descendantWeights([], ['ghost'], historyOf(PAGE))
    expect(w.get('ghost')).toBe(0)
  })

  it('returns nothing rather than guessing when history is unavailable', async () => {
    expect((await descendantWeights([], ['notes'], unavailable)).size).toBe(0)
  })

  it('scores every tile before spending any budget on depth', async () => {
    // The bug this pins: spending the budget tile-by-tile in PAGE order let
    // an exhausted budget score the hive's densest branch 0 purely because
    // it sat late in the arrangement — an inverted ranking, not a rough one.
    // Here the LAST tile in page order is the densest; it must still win.
    const wide: Node = {
      name: 'page',
      kids: Array.from({ length: 30 }, (_, i) => ({
        name: `t${i}`,
        kids: Array.from({ length: i === 29 ? 40 : 2 }, (_, j) => ({ name: `c${j}` })),
      })),
    }
    const labels = Array.from({ length: 30 }, (_, i) => `t${i}`)
    const w = await descendantWeights([], labels, historyOf(wide))
    const heaviest = [...w.entries()].sort((a, b) => b[1] - a[1])[0]
    expect(heaviest[0]).toBe('t29')
    // And nothing was left unscored.
    expect([...w.values()].filter(v => v === 0)).toEqual([])
  })
})

describe('organismWeights — holders when a swarm answers, descendants otherwise', () => {
  const PAGE: Node = {
    name: 'page',
    kids: [
      { name: 'notes', kids: [{ name: 'a' }] },
      { name: 'drafts', kids: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] },
    ],
  }
  const reader = () => historyOf(PAGE)

  it('ranks on holders once a peer holds one of the page tiles', async () => {
    stack({ notes: ['', 'peer-a', 'peer-b'], drafts: [''] })
    const { ontology, weightByLabel } = await organismWeights(['notes', 'drafts'], [], reader())
    expect(ontology).toBe('holders')
    // The tree says drafts is the fuller tile; the swarm says notes is the
    // busier one. When the swarm answers, it wins.
    expect(weightByLabel.get('notes')).toBe(3)
    expect(weightByLabel.get('drafts')).toBe(1)
  })

  it('falls back to descendants on a solo hive rather than ranking a flat 1', async () => {
    stack({ notes: [''], drafts: [''] })
    const { ontology, weightByLabel } = await organismWeights(['notes', 'drafts'], [], reader())
    expect(ontology).toBe('descendants')
    expect(weightByLabel.get('drafts')).toBe(4)
  })

  it('scores a page tile the tree read never reached as 0, not absent', async () => {
    stack({ notes: [''], hidden: [''] })
    const { weightByLabel } = await organismWeights(['notes', 'hidden'], [], reader())
    expect(weightByLabel.get('hidden')).toBe(0)
  })

  it('keeps tiles the read saw but the page is not showing out of the weights', async () => {
    stack({ notes: [''] })
    const { weightByLabel } = await organismWeights(['notes'], [], reader())
    expect(weightByLabel.has('drafts')).toBe(false)
  })

  it('says nothing rather than ranking when neither ontology can speak', async () => {
    stack({ notes: [''] })
    const { ontology } = await organismWeights(['notes'], [], unavailable)
    expect(ontology).toBe('none')
  })

  it('says nothing when every weight is zero, rather than dressing a spiral up as a measurement', async () => {
    // The case that matters is a FLATTENED page: a tag lens gathers tiles
    // from all over the hive, none of them are children of where you stand,
    // every lookup misses, and a confident "ranked by what each tile
    // contains" would be a lie about a canonical spiral.
    stack({})
    const { ontology } = await organismWeights(['far', 'away'], [], reader())
    expect(ontology).toBe('none')
  })

  it('costs no layer read at all when the swarm answers', async () => {
    stack({ notes: ['', 'peer-a'] })
    let reads = 0
    const counting = <T,>(key: string): T | undefined =>
      key.endsWith('/HistoryService')
        ? ({
          getLayerBySig: async () => { reads++; return null },
          currentLayerAt: async () => { reads++; return null },
          sign: async () => 'loc',
        } as unknown as T)
        : undefined
    await organismWeights(['notes'], [], counting)
    expect(reads).toBe(0)
  })
})

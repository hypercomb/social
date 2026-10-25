import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { EffectBus } = await import('@hypercomb/core')
const { IntoQueenBee } = await import('./into.queen.js')

type Call = { labels: readonly string[]; source: readonly string[]; target: readonly string[] }

/** A MoveDrone that lands what it is told, except the names `taken` lists. */
const moveDrone = (taken: readonly string[] = []): Call[] => {
  const calls: Call[] = []
  registrations.set('@diamondcoreprocessor.com/MoveDrone', {
    commitMoveInto: async (labels: readonly string[], source: readonly string[], target: readonly string[]) => {
      calls.push({ labels, source, target })
      return labels.filter(label => !taken.includes(label))
    },
  })
  return calls
}

beforeEach(() => {
  EffectBus.clear()
  registrations.clear()
  registrations.set('@hypercomb.social/Lineage', { explorerSegments: () => [] })
  registrations.set('@hypercomb.social/CellSuggestionProvider', { suggestions: () => ['work', 'Business-Card', 'domains', 'people'] })
})

// 2026-10-24: asked to organize the home page, a hive model made the group
// tiles and then asked the participant to open each one and paste by hand.
describe('/into with its tiles named', () => {
  it('moves the named tiles of this page into a tile here, spelled as the page spells them', async () => {
    const calls = moveDrone()
    await new IntoQueenBee().invoke('Work = [business-card, domains]')
    expect(calls).toEqual([{ labels: ['Business-Card', 'domains'], source: [], target: ['work'] }])
  })

  it('reaches a route anywhere in the hive', async () => {
    const calls = moveDrone()
    await new IntoQueenBee().invoke('/people/friends = domains')
    expect(calls[0].target).toEqual(['people', 'friends'])
  })

  it('throws for a name this page does not hold, and moves nothing', async () => {
    const calls = moveDrone()
    await expect(new IntoQueenBee().invoke('work = [domains, ghost]')).rejects.toThrow('no tile named "ghost" on this page')
    expect(calls).toEqual([])
  })

  it('never reads a move that did not happen as one', async () => {
    moveDrone(['domains'])
    await expect(new IntoQueenBee().invoke('work = [Business-Card, domains]'))
      .rejects.toThrow('"domains" did not move into /work, which already holds a tile by that name')
    moveDrone(['domains'])
    await expect(new IntoQueenBee().invoke('work = domains')).rejects.toThrow('nothing moved into /work')
  })

  it('sends several groups to their new parents as ONE move', async () => {
    const calls = moveDrone()
    const many: { source: readonly string[]; moves: readonly { labels: readonly string[]; targetSegments: readonly string[] }[] }[] = []
    const drone = registrations.get('@diamondcoreprocessor.com/MoveDrone') as Record<string, unknown>
    drone.commitMoveMany = async (source: readonly string[], moves: typeof many[number]['moves']) => {
      many.push({ source, moves })
      return moves.map(m => m.labels)
    }
    await new IntoQueenBee().invoke('people = [business-card, domains], /archive/2026 = work')
    expect(calls).toEqual([])
    expect(many).toEqual([{ source: [], moves: [
      { labels: ['Business-Card', 'domains'], targetSegments: ['people'] },
      { labels: ['work'], targetSegments: ['archive', '2026'] },
    ] }])
  })

  it('refuses a tile named for two places, or a group with no =, and moves nothing', async () => {
    const calls = moveDrone()
    await expect(new IntoQueenBee().invoke('people = [domains], work = domains')).rejects.toThrow('names "domains" twice')
    await expect(new IntoQueenBee().invoke('work = domains, people')).rejects.toThrow('needs a destination before the =')
    expect(calls).toEqual([])
  })

  it('says which tiles of which group did not land', async () => {
    moveDrone()
    const drone = registrations.get('@diamondcoreprocessor.com/MoveDrone') as Record<string, unknown>
    drone.commitMoveMany = async (_source: readonly string[], moves: readonly { labels: readonly string[] }[]) =>
      moves.map(m => m.labels.filter(label => label !== 'domains'))
    await expect(new IntoQueenBee().invoke('people = [Business-Card, domains], archive = work'))
      .rejects.toThrow('"domains" did not move into /people, which already holds a tile by that name')
  })

  it('tidies a page it is not standing on, reading that page for its tiles', async () => {
    const calls = moveDrone()
    registrations.set('@diamondcoreprocessor.com/HypercombHiveTreeReader', {
      readNode: async (segments: readonly string[]) => segments.join('/') === 'work'
        ? { ok: true, children: ['invoices', 'expenses', 'march', 'taxi'].map(name => ({ name })) } : { ok: false },
    })
    await new IntoQueenBee().invoke('in /work: Invoices = [march]')
    // The page it stands on holds none of these names; only the named page does.
    expect(calls).toEqual([{ labels: ['march'], source: ['work'], target: ['work', 'invoices'] }])
    await expect(new IntoQueenBee().invoke('in /work: invoices = [ghost]')).rejects.toThrow('no tile named "ghost" on /work')
    await expect(new IntoQueenBee().invoke('in /nowhere: invoices = [march]')).rejects.toThrow('/nowhere could not be read')
    await expect(new IntoQueenBee().invoke('in /work: invoices')).rejects.toThrow('say where each group goes')
  })

  it('stays out of a withheld page, tile and destination when it names the page', () => {
    registrations.set('@hypercomb.social/AiWithheld', new (class { readonly #r = ['diary', 'work/secret']; covers(s: readonly string[]) { const k = s.join('/').toLowerCase(); return this.#r.some(r => k === r || k.startsWith(r + '/')) } })())
    const refuse = new IntoQueenBee().machine.refuse
    expect(refuse('in /work: invoices = [march]')).toBeUndefined()
    expect(refuse('in /diary: invoices = [march]')).toContain('/diary is withheld')
    expect(refuse('in /work: invoices = [secret, march]')).toContain('"secret" is withheld')
    expect(refuse('in /work: /diary = [march]')).toContain('/diary is withheld')
    expect(refuse('in /work: diary = [march]')).toContain('/diary is withheld')
    expect(refuse('in /work: invoices')).toContain('needs where each group goes')
    registrations.delete('@hypercomb.social/AiWithheld')
  })

  it('still moves the selection when no tiles are named', async () => {
    const calls = moveDrone()
    registrations.set('@diamondcoreprocessor.com/SelectionService', { selected: new Set(['domains']) })
    await new IntoQueenBee().invoke('work')
    expect(calls).toEqual([{ labels: ['domains'], source: [], target: ['work'] }])
  })
})

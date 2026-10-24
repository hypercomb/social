import { describe, expect, it } from 'vitest'
import { formatHypercombObservationReceipt, parseHypercombObservationGrammars } from './hypercomb-observation'
import { withheldMessage, withheldObservation, withheldObservations, withoutWithheld } from './withheld-reads'
import type { HypercombObservationReceipt } from './hypercomb-observation'

// /susan and everything under it is withheld; nothing else is.
const covers = (segments: readonly string[]): boolean => segments[0]?.toLowerCase() === 'susan'

describe('withheld tiles at the read step', () => {
  it('refuses a read aimed at a withheld tile or under it, and nothing else', () => {
    const plan = parseHypercombObservationGrammars(['/read /people', '/read /susan/family-support'], [])
    expect(withheldObservation(plan.observations, covers)?.grammar).toBe('/read /susan/family-support')
    const here = parseHypercombObservationGrammars(['/read'], ['susan'])
    expect(withheldObservation(here.observations, covers)?.grammar).toBe('/read')
    const fine = parseHypercombObservationGrammars(['/tree /', '/find road', '/code withheld'], [])
    expect(withheldObservation(fine.observations, covers)).toBeUndefined()
  })

  it('names every withheld read in a block, so each is refused alone and the rest still run', () => {
    const plan = parseHypercombObservationGrammars(['/read /people', '/read /susan', '/find betz', '/tree /susan/family-support'], [])
    expect(withheldObservations(plan.observations, covers).map(observation => observation.grammar))
      .toEqual(['/read /susan', '/tree /susan/family-support'])
    expect(withheldObservations(plan.observations, () => false)).toEqual([])
  })

  it('leaves withheld tiles out of a tree and a find, and says the tree is partial', () => {
    const receipt = {
      snapshots: [],
      results: [
        { grammar: '/tree /', kind: 'tree', read: { ok: true, root: '/', truncated: false, snapshot: 's', nodes: [
          { path: '/', name: 'hive', depth: 0, childCount: 2 },
          { path: '/people', name: 'people', depth: 1, childCount: 0 },
          { path: '/susan', name: 'susan', depth: 1, childCount: 1 },
          { path: '/susan/family-support', name: 'family-support', depth: 2, childCount: 0 },
        ] } },
        { grammar: '/find s', kind: 'find', read: { ok: true, root: '/', query: 's', truncated: false, snapshot: 's', matches: [
          { name: 'susan', path: '/susan' }, { name: 'stories', path: '/people/stories' },
        ] } },
      ],
    } as unknown as HypercombObservationReceipt
    const out = withoutWithheld(receipt, covers)
    const tree = out.results[0] as unknown as { read: { nodes: { path: string }[]; truncated: boolean } }
    expect(tree.read.nodes.map(node => node.path)).toEqual(['/', '/people'])
    expect(tree.read.truncated).toBe(true)
    const find = out.results[1] as unknown as { read: { matches: { path: string }[] } }
    expect(find.read.matches.map(match => match.path)).toEqual(['/people/stories'])
    // Nothing withheld: the receipt is handed back as it was.
    expect(withoutWithheld(receipt, () => false).results[0]).toBe(receipt.results[0])
  })

  // 2026-10-24: a tile read lists children with their signatures, and a read
  // by signature passes the route guard — so a withheld child's signature was
  // a way in to its contents. Its name stays; its signature goes.
  it('keeps a withheld child named in a tile read but never gives its signature', () => {
    const sig = (n: number): string => n.toString(16).padStart(64, '0')
    const node = (root: string) => ({
      snapshots: [],
      results: [{ grammar: `/read ${root}`, kind: 'node', read: {
        ok: true, root, name: 'hive', layerSig: sig(1),
        children: [{ name: 'people', sig: sig(2) }, { name: 'susan', sig: sig(3) }],
      } }],
    } as unknown as HypercombObservationReceipt)
    const children = (receipt: HypercombObservationReceipt) =>
      (receipt.results[0] as unknown as { read: { children: { name: string; sig: string }[] } }).read.children
    expect(children(withoutWithheld(node('/'), covers))).toEqual([{ name: 'people', sig: sig(2) }, { name: 'susan', sig: '' }])
    // Read by signature: no route, so its children are judged as the root's.
    expect(children(withoutWithheld(node(sig(1)), covers))).toEqual([{ name: 'people', sig: sig(2) }, { name: 'susan', sig: '' }])
    // Under another tile, a child that merely shares the name is not withheld.
    expect(children(withoutWithheld(node('/people'), covers))[1]).toEqual({ name: 'susan', sig: sig(3) })
    const receipt = node('/')
    expect(withoutWithheld(receipt, () => false).results[0]).toBe(receipt.results[0])
  })

  // 2026-10-12: a find names the branches its walk did not finish. A large
  // withheld branch went out by name, with a note to search under it — a
  // read this step then refuses.
  it('leaves withheld tiles out of a find’s unfinished branches, and recounts them', () => {
    const findOf = (read: Record<string, unknown>): HypercombObservationReceipt => ({
      snapshots: [],
      results: [{ grammar: '/find betz /', kind: 'find', read: {
        ok: true, root: '/', query: 'betz', truncated: true, snapshot: 's',
        matches: [{ name: 'betz', path: '/dolphin/associates/betz' }], ...read,
      } }],
    }) as unknown as HypercombObservationReceipt
    const readOf = (receipt: HypercombObservationReceipt): Record<string, unknown> =>
      (receipt.results[0] as unknown as { read: Record<string, unknown> }).read

    const some = readOf(withoutWithheld(findOf({ unfinished: ['/people', '/susan'], unfinishedCount: 23 }), covers))
    expect(some).toMatchObject({ unfinished: ['/people'], unfinishedCount: 22 })
    expect(some['matches']).toEqual([{ name: 'betz', path: '/dolphin/associates/betz' }])

    // Every listed branch withheld: no list and no count, so the receipt
    // falls back to its old advice and names nothing withheld.
    const all = withoutWithheld(findOf({ unfinished: ['/susan'], unfinishedCount: 1 }), covers)
    expect(readOf(all)).not.toHaveProperty('unfinished')
    expect(readOf(all)).not.toHaveProperty('unfinishedCount')
    const text = formatHypercombObservationReceipt(all)
    expect(text).not.toMatch(/susan/)
    expect(text).toMatch(/search again under a narrower route/)

    // Nothing withheld: handed back as it was.
    const kept = findOf({ unfinished: ['/people'], unfinishedCount: 1 })
    expect(withoutWithheld(kept, covers).results[0]).toBe(kept.results[0])
  })

  it('tells the model not to look for another way in', () => {
    expect(withheldMessage('/read /susan')).toContain('another way in')
  })
})

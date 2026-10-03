import { describe, expect, it } from 'vitest'
import { parseHypercombObservationGrammars } from './hypercomb-observation'
import { withheldMessage, withheldObservation, withoutWithheld } from './withheld-reads'
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

  it('tells the model not to look for another way in', () => {
    expect(withheldMessage('/read /susan')).toContain('another way in')
  })
})

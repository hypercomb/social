// ONLY WHAT DIFFERS, AND NOTHING READ TWICE (jwize, 2026-11-16: "implement
// the ideas"). The leg's memory of its reads, two more steps: an answer that
// changed in part goes back as its difference, and a read whose source has
// not moved is answered before anything is executed.

import { describe, expect, it, vi } from 'vitest'
import {
  executeHypercombObservationPlan,
  formatHypercombObservationReceipt,
  parseHypercombObservationGrammars,
  type HypercombObservationReceipt,
  type HypercombTreeReader,
  type ReadRepeats,
} from './hypercomb-observation.js'

const observationsOf = (text: string): Record<string, unknown>[] =>
  (JSON.parse(text) as { observations: Record<string, unknown>[] }).observations

describe('a read the leg answered, asked again after a change', () => {
  const row = (n: number) => ({ name: `tile-${n}`, path: `/business-card/back/tile-${n}` })
  const found = (rows: number[], truncated = false): HypercombObservationReceipt => ({
    results: [{
      grammar: 'find tile /business-card', kind: 'find',
      read: { ok: true, root: '/business-card', query: 'tile', matches: rows.map(row), truncated, snapshot: 'private-find' },
    }],
    snapshots: [], signatures: [],
  } as unknown as HypercombObservationReceipt)
  const only = (text: string): Record<string, unknown> => observationsOf(text)[0]
  const many = Array.from({ length: 20 }, (_, n) => n)
  const changedRows = [...many.filter(n => n !== 3), 20, 21]

  it('sends only the rows that came and went', () => {
    const memory: ReadRepeats['memory'] = new Map()
    const first = formatHypercombObservationReceipt(found(many), { memory, round: 1 })
    expect((only(first)['matches'] as unknown[]).length).toBe(20)
    const next = formatHypercombObservationReceipt(found(changedRows), { memory, round: 4 })
    const said = only(next)
    expect(said['changed']).toBe(true)
    expect(String(said['changedNote'])).toContain('answered 3 rounds ago')
    expect(said['added']).toEqual({ matches: [row(20), row(21)] })
    expect(said['removed']).toEqual({ matches: [row(3)] })
    expect(said['matches']).toBeUndefined()
    expect(said['now']).toBeUndefined()
    expect(next.length).toBeLessThan(first.length * 0.6)
    // What is remembered is the whole answer as it is now: the same again is unchanged.
    expect(only(formatHypercombObservationReceipt(found(changedRows), { memory, round: 5 }))['unchanged']).toBe(true)
    // And the next change is told against it, not against the first answer.
    const third = only(formatHypercombObservationReceipt(found([...changedRows, 22]), { memory, round: 6 }))
    expect(third['added']).toEqual({ matches: [row(22)] })
    expect(third['removed']).toBeUndefined()
  })

  it('gives a changed field whole, as it is now, and names a field that is gone', () => {
    const memory: ReadRepeats['memory'] = new Map()
    formatHypercombObservationReceipt(found(many), { memory, round: 1 })
    const said = only(formatHypercombObservationReceipt(found(many, true), { memory, round: 2 }))
    expect(said['changed']).toBe(true)
    expect((said['now'] as Record<string, unknown>)['truncated']).toBe(true)
    // The note that came with a whole walk is no longer there.
    expect(said['gone']).toEqual(['answerNote'])
    expect(said['added']).toBeUndefined()
  })

  it('sends the whole answer when the rows were reordered, or when the difference is most of it', () => {
    const memory: ReadRepeats['memory'] = new Map()
    formatHypercombObservationReceipt(found(many), { memory, round: 1 })
    const reordered = only(formatHypercombObservationReceipt(found([...many].reverse()), { memory, round: 2 }))
    expect(reordered['changed']).toBeUndefined()
    expect((reordered['matches'] as unknown[]).length).toBe(20)
    const replaced = only(formatHypercombObservationReceipt(found(many.map(n => n + 100)), { memory, round: 3 }))
    expect(replaced['changed']).toBeUndefined()
    expect((replaced['matches'] as unknown[]).length).toBe(20)
  })
})

describe('a read whose source has not moved', () => {
  const target = 'a'.repeat(64)
  const text = 'export const stage = makeStage();'.repeat(30)
  type Counted = Record<'readTree' | 'find' | 'readNode' | 'readBytesBySig' | 'validateSnapshots', ReturnType<typeof vi.fn>>
  const reader = (moved: () => boolean): HypercombTreeReader & Counted => ({
    readTree: vi.fn(async (segments: readonly string[]) => ({
      ok: true as const, root: `/${segments.join('/')}`,
      nodes: Array.from({ length: 12 }, (_, n) => ({ path: `/${segments.join('/')}/part-${n}`, name: `part-${n}`, depth: 1, childCount: 0, sig: 'b'.repeat(64) })),
      truncated: false, snapshot: 'private-tree',
    })),
    find: vi.fn(async (query: string, segments: readonly string[]) => ({
      ok: true as const, root: `/${segments.join('/')}`, query,
      matches: Array.from({ length: 12 }, (_, n) => ({ name: `part-${n}`, path: `/${segments.join('/')}/part-${n}` })), truncated: false, snapshot: 'private-find',
    })),
    readNode: vi.fn(async (segments: readonly string[]) => ({
      ok: true as const, root: `/${segments.join('/')}`, name: 'business-card', layerSig: 'c'.repeat(64),
      children: Array.from({ length: 12 }, (_, n) => ({ name: `part-${n}`, sig: 'b'.repeat(64) })),
    })),
    readNodeBySig: vi.fn(async (sig: string) => ({ ok: false as const, root: sig, code: 'not-found' as const })),
    readBytesBySig: vi.fn(async (sig: string, { from }: { from: number }) => ({
      ok: true as const, root: sig, sig, of: 'resource' as const, type: 'text/javascript', size: text.length, from, text, truncated: false,
    })),
    validateSnapshots: vi.fn(async () => !moved()),
  }) as unknown as HypercombTreeReader & Counted
  const lines = [`/read ${target}`, '/tree /business-card', '/find part /business-card', '/read /business-card']
  const round = async (hive: HypercombTreeReader, memory: ReadRepeats['memory'], at: number) => {
    const receipt = await executeHypercombObservationPlan(parseHypercombObservationGrammars(lines, []), hive, { repeats: { memory, round: at } })
    return { receipt, said: observationsOf(formatHypercombObservationReceipt(receipt, { memory, round: at })) }
  }
  const calls = (hive: Counted): number[] =>
    [hive.readBytesBySig, hive.readTree, hive.find, hive.readNode].map(read => read.mock.calls.length)

  it('is not read again: bytes by signature for good, a tree and a find while their heads stand', async () => {
    const hive = reader(() => false)
    const memory: ReadRepeats['memory'] = new Map()
    await round(hive, memory, 1)
    expect(calls(hive)).toEqual([1, 1, 1, 1])
    const again = await round(hive, memory, 3)
    // Only the tile itself was read again: its notes can change without its layer changing.
    expect(calls(hive)).toEqual([1, 1, 1, 2])
    expect(again.receipt.results.map(result => result.kind)).toEqual(['unmoved', 'unmoved', 'unmoved', 'node'])
    expect(again.said.map(observation => observation['unchanged'])).toEqual([true, true, true, true])
    expect(String(again.said[1]['unchangedNote'])).toContain('answered 2 rounds ago')
    // The heads a skipped tree and find stood on still count for the turn.
    expect(again.receipt.snapshots).toEqual(expect.arrayContaining(['private-tree', 'private-find']))
    // The memory still points at the round that holds the answers.
    expect(memory.get('/tree /business-card')?.round).toBe(1)
  })

  it('is read again once the tree has moved, and bytes by signature still are not', async () => {
    let moved = false
    const hive = reader(() => moved)
    const memory: ReadRepeats['memory'] = new Map()
    await round(hive, memory, 1)
    moved = true
    const again = await round(hive, memory, 2)
    expect(calls(hive).slice(0, 3)).toEqual([1, 2, 2])
    expect(again.receipt.results.map(result => result.kind)).toEqual(['unmoved', 'tree', 'find', 'node'])
  })

  it('reads everything when the leg remembers nothing, or is given no memory', async () => {
    const hive = reader(() => false)
    await round(hive, new Map(), 1)
    await round(hive, new Map(), 2)
    await executeHypercombObservationPlan(parseHypercombObservationGrammars(lines, []), hive)
    expect(calls(hive).slice(0, 3)).toEqual([3, 3, 3])
  })
})

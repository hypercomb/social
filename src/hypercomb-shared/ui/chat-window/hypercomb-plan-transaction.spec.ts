// ui/chat-window/hypercomb-plan-transaction.spec.ts — a stopped plan puts its
// pages back.
//
// The fake history announces a write the way the real one does
// (history.service.ts `commitLayer`): `history:marker-wrote` BEFORE the head
// moves, so the recorder can still ask what the page held. A page whose head
// was never known (inside a freshly pasted subtree) has its earlier state
// written as the plan's first marker there.

import { describe, expect, it } from 'vitest'
import { PlanTransaction, type PlanBus, type PlanHistory } from './hypercomb-plan-transaction'

const sig = (c: string): string => c.repeat(64)
const marker = (layer: string): ArrayBuffer => new TextEncoder().encode(JSON.stringify({ layer })).buffer as ArrayBuffer

/** A bus with last-value replay, like core EffectBus. */
const makeBus = () => {
  const handlers = new Set<(payload: unknown) => void>()
  let last: unknown
  let emitted = false
  const bus: PlanBus = {
    on: <T>(_effect: string, handler: (payload: T) => void) => {
      const h = handler as (payload: unknown) => void
      handlers.add(h)
      if (emitted) h(last)
      return () => { handlers.delete(h) }
    },
  }
  const emit = (payload: unknown): void => { last = payload; emitted = true; for (const h of handlers) h(payload) }
  return { bus, emit }
}

/** Heads in memory; a commit announces, then moves the head. */
const makeHistory = (emit: (payload: unknown) => void, heads: Record<string, string> = {}) => {
  const head = new Map(Object.entries(heads))
  const promoted: [string, string][] = []
  const commit = (lineage: string, layer: string): void => {
    emit({ lineageSig: lineage, markerName: '00000001', bytes: marker(layer) })
    head.set(lineage, layer)
  }
  const history: PlanHistory = {
    warmHeadSigFor: lineage => head.get(lineage) ?? null,
    promoteToHead: async (lineage, layer) => { promoted.push([lineage, layer]); commit(lineage, layer); return layer },
  }
  return { history, head, commit, promoted }
}

const PAGE = sig('1'), ROOT = sig('2'), PASTED = sig('3')
const A0 = sig('a'), A1 = sig('b'), A2 = sig('c'), R0 = sig('d'), R1 = sig('e'), SEED = sig('f'), P1 = sig('9')

describe('a stopped plan puts its pages back', () => {
  it('every page the plan moved, the cascade included, goes back to what it held', async () => {
    const { bus, emit } = makeBus()
    const { history, head, commit } = makeHistory(emit, { [PAGE]: A0, [ROOT]: R0 })
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    commit(PAGE, A1); commit(ROOT, R1)
    commit(PAGE, A2)
    expect(plan.touched).toBe(2)
    const undone = await plan.rollback()
    expect(undone).toEqual({ restored: 2, kept: 0, failed: 0 })
    expect(head.get(PAGE)).toBe(A0)
    expect(head.get(ROOT)).toBe(R0)
  })

  it('a write from before the plan, replayed by the bus, is not taken for the plan\'s', async () => {
    const { bus, emit } = makeBus()
    const { history, commit, promoted } = makeHistory(emit, { [PAGE]: A0 })
    commit(PAGE, A1)
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    expect(plan.touched).toBe(0)
    expect(await plan.rollback()).toEqual({ restored: 0, kept: 0, failed: 0 })
    expect(promoted).toEqual([])
  })

  it('a page with no known head goes back to the state the plan first wrote there (a pasted subtree)', async () => {
    const { bus, emit } = makeBus()
    const { history, head, commit } = makeHistory(emit)
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    commit(PASTED, SEED)
    commit(PASTED, P1)
    await plan.rollback()
    expect(head.get(PASTED)).toBe(SEED)
  })

  it('a page something else moved after the plan wrote it is left as it is', async () => {
    const { bus, emit } = makeBus()
    const { history, head, commit } = makeHistory(emit, { [PAGE]: A0, [ROOT]: R0 })
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    commit(PAGE, A1); commit(ROOT, R1)
    plan.end()
    commit(PAGE, A2)
    expect(await plan.rollback()).toEqual({ restored: 1, kept: 1, failed: 0 })
    expect(head.get(PAGE)).toBe(A2)
    expect(head.get(ROOT)).toBe(R0)
  })

  it('the roll back\'s own writes are never recorded, and a second roll back does nothing', async () => {
    const { bus, emit } = makeBus()
    const { history, commit, promoted } = makeHistory(emit, { [PAGE]: A0 })
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    commit(PAGE, A1)
    await plan.rollback()
    expect(await plan.rollback()).toEqual({ restored: 0, kept: 0, failed: 0 })
    expect(promoted).toEqual([[PAGE, A0]])
  })

  it('a hive left stepped back in history is not written', async () => {
    const { bus, emit } = makeBus()
    const { history, head, commit, promoted } = makeHistory(emit, { [PAGE]: A0 })
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    commit(PAGE, A1)
    const undone = await plan.rollback({ rewound: true })
    expect(undone.restored).toBe(0)
    expect(undone.refused).toContain('/redo')
    expect(promoted).toEqual([])
    expect(head.get(PAGE)).toBe(A1)
  })

  it('a page whose earlier version cannot be put back is counted, not hidden', async () => {
    const { bus, emit } = makeBus()
    const { history, commit } = makeHistory(emit, { [PAGE]: A0 })
    const plan = new PlanTransaction({ ...history, promoteToHead: async () => null })
    plan.begin(bus)
    commit(PAGE, A1)
    expect(await plan.rollback()).toEqual({ restored: 0, kept: 0, failed: 1 })
  })

  it('a marker it cannot read is ignored', async () => {
    const { bus, emit } = makeBus()
    const { history } = makeHistory(emit)
    const plan = new PlanTransaction(history)
    plan.begin(bus)
    emit({ lineageSig: PAGE, bytes: new TextEncoder().encode('not json').buffer })
    emit({ lineageSig: 'short', bytes: marker(A1) })
    expect(plan.touched).toBe(0)
  })
})

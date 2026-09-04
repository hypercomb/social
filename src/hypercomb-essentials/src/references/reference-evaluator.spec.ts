// references/reference-evaluator.spec.ts
//
// THE RULE IS TRUTH; THE RESULT IS DERIVED. These pin that:
//   - a rule with an explicit scope evaluates IDENTICALLY twice
//   - the degenerate (hand-picked) arm needs no walk at all
//   - an audience beyond `mine` with no transport reports `partial` rather
//     than passing the local hive off as the community
//   - NOTHING is written to any pool, and no effect is emitted

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HYDRATE_BUDGET, ReferenceEvaluator, candidateOfSignature, meetsPredicate,
  type ReferenceCandidate, type ReferencePorts,
} from './reference-evaluator.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

const CELLS: ReferenceCandidate[] = [
  { key: 'lounge', label: 'Lounge', segments: ['cigars', 'Lounge'], order: 1 },
  { key: 'humidor', label: 'Humidor', segments: ['cigars', 'Humidor'], order: 0 },
  { key: 'alice', label: 'Alice', segments: ['people', 'Alice'] },
]

const MARKS: Record<string, string[]> = {
  Lounge: ['review', 'public'],
  Humidor: ['review'],
  Alice: ['private'],
}

const ports = (over: Partial<ReferencePorts> = {}): ReferencePorts => ({
  candidates: async (word: string) => (word === 'cigar' ? CELLS : []),
  marksOf: async (target: { label?: string }) => MARKS[String(target.label ?? '')] ?? [],
  treeEpoch: () => 7,
  ...over,
})

const rule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  source: { molecules: ['cigar'] },
  predicate: { any: [['review']] },
  scope: { reach: 'children', audience: { kind: 'mine' } },
  projection: { fields: ['label', 'segments', 'marks'] },
  order: { by: 'mark' },
  ...over,
})

let iocValues: Map<string, unknown>

beforeEach(() => {
  iocValues = new Map()
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: <T>(key: string): T | undefined => iocValues.get(key) as T | undefined,
    register: (key: string, value: unknown): void => { iocValues.set(key, value) },
  }
})

describe('a rule with an explicit scope evaluates identically twice', () => {

  it('gives the same rows, in the same order, every time', async () => {
    const evaluator = new ReferenceEvaluator(ports())
    const once = await evaluator.evaluate(rule(), ['cigars'])
    const twice = await evaluator.evaluate(rule(), ['cigars'])
    expect(once).not.toBeNull()
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    expect(once!.rows.map(r => r.label)).toEqual(['Humidor', 'Lounge'])   // order rides the mark
    expect(once!.total).toBe(2)
    expect(once!.partial).toBe(false)
  })

  it('is identical again from a FRESH evaluator — nothing is carried in state', async () => {
    const first = await new ReferenceEvaluator(ports()).evaluate(rule(), ['cigars'])
    const second = await new ReferenceEvaluator(ports()).evaluate(rule(), ['cigars'])
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('re-derives after forget(), and still agrees', async () => {
    const evaluator = new ReferenceEvaluator(ports())
    const before = await evaluator.evaluate(rule(), ['cigars'])
    evaluator.forget()
    expect(JSON.stringify(await evaluator.evaluate(rule(), ['cigars']))).toBe(JSON.stringify(before))
  })

  it('re-derives when the tree epoch moves — membership can change anywhere', async () => {
    let epoch = 1
    const candidates = vi.fn(async (word: string) => (word === 'cigar' ? CELLS : []))
    const evaluator = new ReferenceEvaluator(ports({ candidates, treeEpoch: () => epoch }))
    await evaluator.evaluate(rule(), [])
    await evaluator.evaluate(rule(), [])
    expect(candidates).toHaveBeenCalledTimes(1)          // memoised within an epoch
    epoch = 2
    await evaluator.evaluate(rule(), [])
    expect(candidates).toHaveBeenCalledTimes(2)          // and dropped when it moves
  })

  it('refuses a rule with no scope — the evaluator will not guess one either', async () => {
    const { scope: _dropped, ...noScope } = rule()
    expect(await new ReferenceEvaluator(ports()).evaluate(noScope, [])).toBeNull()
  })

  it('orders by name and by path when asked, deterministically', async () => {
    const evaluator = new ReferenceEvaluator(ports())
    const byName = await evaluator.evaluate(rule({ order: { by: 'name' } }), [])
    expect(byName!.rows.map(r => r.label)).toEqual(['Humidor', 'Lounge'])
    const byPath = await evaluator.evaluate(rule({ order: { by: 'path' } }), [])
    expect(byPath!.rows.map(r => r.label)).toEqual(['Humidor', 'Lounge'])
  })
})

describe('the predicate — OR inside a group, AND across groups', () => {

  it('is the already-shipped semantics, with one group as the degenerate case', () => {
    expect(meetsPredicate(['review', 'public'], [['review']], [])).toBe(true)
    expect(meetsPredicate(['review'], [['review'], ['public']], [])).toBe(false)   // AND across
    expect(meetsPredicate(['review'], [['review', 'draft']], [])).toBe(true)        // OR within
    expect(meetsPredicate(['review'], [], [])).toBe(true)                           // no predicate
    expect(meetsPredicate(['review', 'private'], [['review']], ['private'])).toBe(false)
  })

  it('unions a bouquet into the predicate, and says partial when it cannot be read', async () => {
    const withBouquet = rule({ predicate: { any: [['review']], bouquet: SIG_A } })
    const resolved = await new ReferenceEvaluator(
      ports({ bouquetMarks: async () => ['public'] }),
    ).evaluate(withBouquet, [])
    expect(resolved!.rows.map(r => r.label)).toEqual(['Lounge'])
    expect(resolved!.partial).toBe(false)

    const unresolved = await new ReferenceEvaluator(ports()).evaluate(withBouquet, [])
    expect(unresolved!.partial).toBe(true)
  })

  it('reads marks through the UNION seam — a sig-carried mark counts', async () => {
    const seen: Array<{ label?: string; segments?: readonly string[]; sig?: string }> = []
    const evaluator = new ReferenceEvaluator(ports({
      marksOf: async target => { seen.push(target); return MARKS[String(target.label ?? '')] ?? [] },
    }))
    await evaluator.evaluate(rule(), [])
    expect(seen.every(t => t.label !== undefined && t.segments !== undefined)).toBe(true)
  })

  it('matches NOTHING rather than everything when no mark read exists', async () => {
    const blind = await new ReferenceEvaluator({ candidates: ports().candidates }).evaluate(rule(), [])
    expect(blind!.rows).toEqual([])
    expect(blind!.partial).toBe(true)
  })

  it('says partial when the hydrate budget cannot cover the candidates', async () => {
    const many = Array.from({ length: HYDRATE_BUDGET + 1 }, (_, i) => ({
      key: `k${i}`, label: `T${i}`, segments: ['t', `T${i}`],
    }))
    const result = await new ReferenceEvaluator(ports({
      candidates: async () => many,
      marksOf: async () => ['review'],
      hydrate: async () => true,
    })).evaluate(rule(), [])
    expect(result!.partial).toBe(true)
    expect(result!.total).toBe(many.length)
  })
})

describe('the degenerate arm — a hand-picked list', () => {

  it('needs no walk at all', async () => {
    const candidates = vi.fn(async () => CELLS)
    const result = await new ReferenceEvaluator(ports({ candidates })).evaluate(rule({
      source: { signatures: [SIG_B, SIG_A] },
      predicate: {},
      projection: { fields: ['label'] },
    }), [])
    expect(candidates).not.toHaveBeenCalled()
    expect(result!.rows.map(r => r.key)).toEqual([SIG_A, SIG_B])
  })

  it('cannot be aimed past `mine` — the validator refuses, so the evaluator never sees it', async () => {
    const result = await new ReferenceEvaluator(ports()).evaluate(rule({
      source: { signatures: [SIG_A] },
      scope: { reach: 'global', audience: { kind: 'community' } },
    }), [])
    expect(result).toBeNull()
  })

  it('builds a candidate straight from a signature', () => {
    expect(candidateOfSignature(SIG_A)?.sig).toBe(SIG_A)
    expect(candidateOfSignature('not-a-sig')).toBeNull()
  })
})

describe('audience is honest when the transport is missing', () => {

  it("reports partial for 'community' with no reach port", async () => {
    const result = await new ReferenceEvaluator(ports()).evaluate(rule({
      scope: { reach: 'global', audience: { kind: 'community' } },
    }), [])
    expect(result!.partial).toBe(true)
    expect(result!.scope.audience).toEqual({ kind: 'community' })
  })

  it("reports partial for named 'hosts' with no reach port, and complete with one", async () => {
    const scope = { reach: 'global', audience: { kind: 'hosts', hosts: ['b.example', 'a.example'] } }
    expect((await new ReferenceEvaluator(ports()).evaluate(rule({ scope }), []))!.partial).toBe(true)
    const reached = await new ReferenceEvaluator(ports({ reach: async () => ['a.example', 'b.example'] }))
      .evaluate(rule({ scope }), [])
    expect(reached!.partial).toBe(false)
    expect(reached!.scope.audience).toEqual({ kind: 'hosts', hosts: ['a.example', 'b.example'] })
  })

  it("is complete for 'mine' with no transport at all", async () => {
    expect((await new ReferenceEvaluator(ports()).evaluate(rule(), []))!.partial).toBe(false)
  })
})

describe('the result is a projection — never truth', () => {

  it('writes to no pool and emits no effect', async () => {
    const getPool = vi.fn(async () => null)
    iocValues.set('@hypercomb.social/Store', { getPool })
    const emitted: string[] = []
    const originalDispatch = window.dispatchEvent.bind(window)
    window.dispatchEvent = ((event: Event) => { emitted.push(event.type); return originalDispatch(event) }) as typeof window.dispatchEvent
    try {
      await new ReferenceEvaluator(ports()).evaluate(rule(), [])
    } finally {
      window.dispatchEvent = originalDispatch
    }
    expect(getPool).not.toHaveBeenCalled()
    expect(emitted).toEqual([])
  })

  it('projects only the fields the rule asked for', async () => {
    const only = await new ReferenceEvaluator(ports()).evaluate(rule({ projection: { fields: ['label'] } }), [])
    expect(Object.keys(only!.rows[0]).sort()).toEqual(['key', 'label'])
  })

  it('trims to the limit but still counts everything found', async () => {
    const result = await new ReferenceEvaluator(ports()).evaluate(
      rule({ projection: { fields: ['label'], limit: 1 } }), [])
    expect(result!.rows).toHaveLength(1)
    expect(result!.total).toBe(2)
  })
})

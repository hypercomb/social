// references/reference-evaluator.authority-skeptic.spec.ts
//
// ADVERSARIAL PASS over the reference rule's SCOPE and its predicate.
//
// The rule claims two things a caller will rely on:
//   1. "SCOPE IS PART OF THE RULE FROM THE START ... implicit membership plus
//      federation otherwise means a team page quietly showing strangers."
//   2. `partial` says the answer came from an incomplete picture.
//
// Both are tested here from the outside, by handing the evaluator ports that
// behave the way the real world does — a source that can reach past this hive,
// and a mark read that fails.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ReferenceEvaluator, type ReferenceCandidate, type ReferencePorts,
} from './reference-evaluator.js'

const SIG = (c: string) => c.repeat(64)

const candidate = (key: string, label: string): ReferenceCandidate =>
  ({ key, label, segments: [label], sig: key })

const MINE = candidate(SIG('a'), 'my-note')
// A row a federated source answered for. It NAMES the host that supplied it —
// the field that used to be missing, and without which `mine` was undecidable
// on the data the evaluator had. A row with no origin is this hive's own.
const STRANGER = { ...candidate(SIG('b'), 'someone-elses-note'), origin: 'a-host.example' }

/** A rule over one molecule word, with the audience under test. */
const ruleFor = (audience: Record<string, unknown>, predicate: unknown = {}) => ({
  source: { molecules: ['note'] },
  predicate,
  scope: { reach: 'global', audience },
  projection: { fields: ['label'] },
  order: { by: 'name' },
})

describe('AUDIENCE is declared but never applied', () => {

  // The source port is where candidates actually come from, and it is handed
  // (word, at, reach). The AUDIENCE — the half that decides whose things a rule
  // gathers — is never passed to it, so no source implementation can honour it
  // even if it wanted to. A rule scoped `mine` and one scoped `community` ask
  // the world exactly the same question.
  it('asks the source the SAME question for audience `mine` and audience `community`', async () => {
    const asked: unknown[] = []
    const ports: ReferencePorts = {
      candidates: async (word, at, reach) => { asked.push({ word, at: [...at], reach }); return [MINE] },
      reach: async () => ['a-host.example'],
    }
    const evaluator = new ReferenceEvaluator(ports)
    await evaluator.evaluate(ruleFor({ kind: 'mine' }), [])
    await evaluator.evaluate(ruleFor({ kind: 'community' }), [])

    expect(asked).toHaveLength(2)
    expect(
      JSON.stringify(asked[1]),
      'the source port is never told the audience, so it cannot scope by it',
    ).not.toBe(JSON.stringify(asked[0]))
  })

  // The consequence, stated as the doc states it. A source that can reach past
  // this hive — which is the entire direction: "say a word, hash it, ask your
  // hosts" — puts a stranger's row into a rule the participant scoped to their
  // OWN things, and the result reports `partial: false`, i.e. complete.
  //
  // Nothing in `ReferenceCandidate` carries provenance (no author, no host, no
  // pubkey), so the evaluator could not filter this out even if it tried; the
  // scope is unenforceable by construction, not merely unimplemented.
  it('drops a federated stranger from an audience-`mine` rule, and does not call it complete', async () => {
    const ports: ReferencePorts = {
      candidates: async () => [MINE, STRANGER],
    }
    const result = await new ReferenceEvaluator(ports).evaluate(ruleFor({ kind: 'mine' }), [])
    expect(result).not.toBeNull()
    expect(
      result?.rows.map(r => r.key),
      'audience `mine` must not yield rows this participant does not own',
    ).toEqual([MINE.key])
    expect(result?.partial, 'or, failing that, it must at least not claim completeness').toBe(true)
  })

  it('STRUCTURAL: a candidate carries no provenance, so `mine` can never be enforced', () => {
    const source = readFileSync(join(__dirname, 'reference-evaluator.ts'), 'utf8')
    const shape = source.slice(
      source.indexOf('export interface ReferenceCandidate'),
      source.indexOf('export interface ReferenceRow'),
    )
    expect(
      /\b(author|owner|host|pubkey|origin)\b/.test(shape),
      'ReferenceCandidate names no provenance field — audience is undecidable on the data it has',
    ).toBe(true)
  })
})

describe('the predicate FAILS OPEN where it must fail closed', () => {

  // A missing `marksOf` correctly collapses to zero rows. A THROWING `marksOf`
  // does not: the per-candidate `.catch(() => [])` turns a failed mark read
  // into "this thing carries no marks", and an EXCLUSION over no marks excludes
  // nothing. The private note is returned, and `partial` is false.
  it('includes a `none`-excluded candidate when the mark read throws, and reports complete', async () => {
    const ports: ReferencePorts = {
      candidates: async () => [MINE, STRANGER],
      marksOf: async () => { throw new Error('mark index cold') },
    }
    const result = await new ReferenceEvaluator(ports).evaluate(
      ruleFor({ kind: 'mine' }, { none: ['private'] }),
      [],
    )
    // Both halves of the failure, so neither can be read as the other.
    expect(
      result?.rows.length,
      'an exclusion over marks that could not be read must not silently pass everything',
    ).toBe(0)
    expect(
      result?.partial,
      'a mark read that failed cannot produce a complete answer to a predicate over marks',
    ).toBe(true)
  })

  // Same shape one level up. A predicate that is ONLY a bouquet ("the members
  // of this mark-set") loses its whole restriction when the bouquet cannot be
  // resolved: `groups` stays empty, `none` is empty, the filter block never
  // runs, and every candidate is returned. `partial` is set, but the rows are
  // not a subset of the rule's answer — they are the complement of it.
  it('returns EVERY candidate when the bouquet behind the predicate cannot be resolved', async () => {
    const ports: ReferencePorts = {
      candidates: async () => [MINE, STRANGER],
      marksOf: async () => ['unrelated'],
      // bouquetMarks deliberately absent — the pool member is not here yet.
    }
    const result = await new ReferenceEvaluator(ports).evaluate(
      ruleFor({ kind: 'mine' }, { bouquet: SIG('c') }),
      [],
    )
    expect(
      result?.rows.map(r => r.key),
      'an unresolvable restriction must narrow to nothing, never widen to everything',
    ).toEqual([])
  })

  it('and the same when bouquetMarks throws', async () => {
    const ports: ReferencePorts = {
      candidates: async () => [MINE, STRANGER],
      marksOf: async () => ['unrelated'],
      bouquetMarks: async () => { throw new Error('unreachable') },
    }
    const result = await new ReferenceEvaluator(ports).evaluate(
      ruleFor({ kind: 'mine' }, { bouquet: SIG('c') }),
      [],
    )
    expect(result?.rows.map(r => r.key)).toEqual([])
  })

  // The control: a missing `marksOf` DOES fail closed. This is the behaviour
  // the two cases above should match, and it is why the inconsistency reads as
  // an oversight rather than a decision.
  it('CONTROL: a missing marksOf port correctly yields nothing', async () => {
    const ports: ReferencePorts = { candidates: async () => [MINE, STRANGER] }
    const result = await new ReferenceEvaluator(ports).evaluate(
      ruleFor({ kind: 'mine' }, { any: [['keep']] }),
      [],
    )
    expect(result?.rows).toEqual([])
    expect(result?.partial).toBe(true)
  })
})

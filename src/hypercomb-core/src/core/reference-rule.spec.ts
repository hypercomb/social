// core/reference-rule.spec.ts
//
// THE RULE IS TRUTH. These pin the three properties that make it one:
//   - SCOPE IS PART OF THE RULE. A rule without one is refused, not defaulted.
//   - A HAND-PICKED LIST IS THE DEGENERATE CASE, and unshareable BY
//     CONSTRUCTION — the contradiction is rejected rather than flagged.
//   - APPENDING THE RULE IS BYTE-STABLE. A record that carries no rule
//     produces exactly today's payload bytes, so no existing reference is
//     re-signed and no merkle cascade fires.

import { describe, expect, it } from 'vitest'
import { buildCanonicalReferencePayload } from './canonical-reference.js'
import {
  REFERENCE_RULE_VERSION, buildReferenceRulePayload, normalizeReferencePredicate,
  validateReferenceRule,
} from './reference-rule.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

const base = {
  source: { molecules: ['cigar'] },
  predicate: { any: [['review']] },
  scope: { reach: 'children', audience: { kind: 'mine' } },
  projection: { fields: ['label', 'segments'] },
  order: { by: 'mark' },
}

describe('scope is part of the rule from the start', () => {

  it('REFUSES a rule with no scope — the retrofit that leaves every reference ambiguous', () => {
    const { scope: _dropped, ...noScope } = base
    const verdict = validateReferenceRule(noScope)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toContain('ambiguous forever')
  })

  it('refuses a scope missing either axis — reach and audience are orthogonal', () => {
    expect(validateReferenceRule({ ...base, scope: { reach: 'children' } }).ok).toBe(false)
    expect(validateReferenceRule({ ...base, scope: { audience: { kind: 'mine' } } }).ok).toBe(false)
    expect(validateReferenceRule({ ...base, scope: { reach: 'everywhere', audience: { kind: 'mine' } } }).ok).toBe(false)
  })

  it("refuses 'hosts' with no hosts — an empty host list is not the same fact as 'mine'", () => {
    const verdict = validateReferenceRule({
      ...base,
      scope: { reach: 'global', audience: { kind: 'hosts', hosts: [] } },
    })
    expect(verdict.ok).toBe(false)
  })

  it('normalises named hosts, sorted and deduped, so one audience has one spelling', () => {
    const verdict = validateReferenceRule({
      ...base,
      scope: { reach: 'global', audience: { kind: 'hosts', hosts: ['b.example', 'a.example', 'b.example'] } },
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.rule.scope.audience).toEqual({ kind: 'hosts', hosts: ['a.example', 'b.example'] })
  })
})

describe('the hand-picked list is the degenerate case, and never shareable', () => {

  it('validates as an ordinary rule', () => {
    const verdict = validateReferenceRule({ ...base, source: { signatures: [SIG_B, SIG_A, SIG_A] } })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.rule.source).toEqual({ signatures: [SIG_A, SIG_B] })
  })

  it('is computed UNSHAREABLE — an alias reference leaks structure', () => {
    const verdict = validateReferenceRule({ ...base, source: { signatures: [SIG_A] } })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.shareable).toBe(false)
    expect(verdict.localOnly).toBeTruthy()
  })

  it('REJECTS the contradiction outright — unshareable plus a federated audience', () => {
    for (const audience of [{ kind: 'community' }, { kind: 'hosts', hosts: ['a.example'] }]) {
      const verdict = validateReferenceRule({
        ...base,
        source: { signatures: [SIG_A] },
        scope: { reach: 'global', audience },
      })
      expect(verdict.ok, JSON.stringify(audience)).toBe(false)
      if (!verdict.ok) expect(verdict.reason).toContain('ALIAS reference')
    }
  })

  it('a molecule source IS shareable — it carries words, never addresses', () => {
    const verdict = validateReferenceRule({ ...base, scope: { reach: 'global', audience: { kind: 'community' } } })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.shareable).toBe(true)
    expect(verdict.rule.source).toEqual({ molecules: ['cigar'] })
  })
})

describe('the rule normalises to one spelling', () => {

  it('sorts and dedupes each predicate group, and drops empty ones', () => {
    expect(normalizeReferencePredicate({ any: [['b', 'a', 'a', ''], []], none: ['z', 'z'] }))
      .toEqual({ any: [['a', 'b']], none: ['z'] })
  })

  it('keeps a bouquet only when it is a signature', () => {
    expect(normalizeReferencePredicate({ bouquet: SIG_A }).bouquet).toBe(SIG_A)
    expect(normalizeReferencePredicate({ bouquet: 'education' }).bouquet).toBeUndefined()
  })

  it('carries its own version and orders every field deterministically', () => {
    const one = validateReferenceRule({ ...base, projection: { fields: ['segments', 'label'] } })
    const two = validateReferenceRule({ ...base, projection: { fields: ['label', 'segments'] } })
    expect(one.ok && two.ok).toBe(true)
    if (!one.ok || !two.ok) throw new Error('unreachable')
    expect(JSON.stringify(one.rule)).toBe(JSON.stringify(two.rule))
    expect(one.rule.v).toBe(REFERENCE_RULE_VERSION)
  })

  it('refuses a rule with no source, no fields, or an unknown order', () => {
    expect(validateReferenceRule({ ...base, source: {} }).ok).toBe(false)
    expect(validateReferenceRule({ ...base, source: { molecules: [] } }).ok).toBe(false)
    expect(validateReferenceRule({ ...base, projection: { fields: [] } }).ok).toBe(false)
    expect(validateReferenceRule({ ...base, order: { by: 'colour' } }).ok).toBe(false)
    expect(validateReferenceRule(null).ok).toBe(false)
  })
})

describe('appending the rule is byte-stable', () => {

  it('a record with NO rule produces exactly today\'s payload bytes', () => {
    const opts = { name: 'Cigar', targetSig: SIG_A, requiredMarks: ['review'], requiredBouquet: SIG_B }
    expect(JSON.stringify(buildReferenceRulePayload(opts)))
      .toBe(JSON.stringify(buildCanonicalReferencePayload(opts)))
  })

  it('appends the rule AFTER every existing field, so nothing before it moves', () => {
    const opts = { name: 'Cigar', targetSig: SIG_A, editsRootDefault: true }
    const without = JSON.stringify(buildCanonicalReferencePayload(opts))
    const rule = validateReferenceRule(base)
    if (!rule.ok) throw new Error('unreachable')
    const with_ = JSON.stringify(buildReferenceRulePayload({ ...opts, rule: rule.rule }))
    expect(with_.startsWith(without.slice(0, -1))).toBe(true)
    expect(with_).toContain('"rule"')
  })

  it('REFUSES an invalid rule rather than emitting one nothing can evaluate', () => {
    // It used to drop the rule and return the base payload. That is an
    // UNSCOPED reference — the shape the existing reader happily accepts — so
    // a refused rule became a committed reference with no audience at all.
    const opts = { name: 'Cigar' }
    const bad = { ...base, scope: undefined } as unknown as Parameters<typeof buildReferenceRulePayload>[0]['rule']
    expect(() => buildReferenceRulePayload({ ...opts, rule: bad })).toThrow(/scope/)
    // …and a payload with no rule at all is still byte-identical to today's.
    expect(JSON.stringify(buildReferenceRulePayload(opts)))
      .toBe(JSON.stringify(buildCanonicalReferencePayload(opts)))
  })
})

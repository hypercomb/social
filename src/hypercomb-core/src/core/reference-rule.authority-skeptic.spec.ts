// core/reference-rule.authority-skeptic.spec.ts
//
// ADVERSARIAL PASS over the rule ATOM — the half that travels.
//
// A rule with `audience: hosts` is explicitly shareable, so a rule that arrives
// from a peer is a record that tells THIS client where to go looking. And
// `buildReferenceRulePayload` is the door every authored rule goes through.

import { describe, expect, it } from 'vitest'
import { buildReferenceRulePayload, validateReferenceRule } from './reference-rule.js'

const SIG = (c: string) => c.repeat(64)

const RULE = {
  source: { molecules: ['member'] },
  predicate: { any: [['team']] },
  scope: { reach: 'global', audience: { kind: 'mine' } },
  projection: { fields: ['label'] },
  order: { by: 'name' },
}

describe('a rule that arrives from a peer names the hosts THIS client will reach', () => {

  // `hosts` entries are only trimmed and deduped. A shared rule can therefore
  // name anything — a link-local metadata address, a scheme, a bare path — and
  // the `reach` port is handed the scope verbatim. Nothing here checks the
  // names against `community:hosts`, against a URL shape, or against anything
  // else; a rule is data from outside and this is the point at which it stops
  // being data and starts being a destination.
  it('accepts host names that are not hosts, and passes them through unchanged', () => {
    const verdict = validateReferenceRule({
      ...RULE,
      scope: {
        reach: 'global',
        audience: { kind: 'hosts', hosts: ['169.254.169.254', 'javascript:alert(1)', '../../etc', 'evil.example'] },
      },
    })
    expect(verdict.ok).toBe(true)
    const audience = verdict.ok ? verdict.rule.scope.audience : null
    expect(
      audience && audience.kind === 'hosts' ? audience.hosts : [],
      'a host name a rule from outside supplied must be checkable before it becomes a fetch',
    ).toEqual(['evil.example'])
  })

  // FIXED 2026-09-03. This case used to assert that a rule naming ONLY an
  // unusable destination still validated and still called itself shareable —
  // "the half that makes it matter". It no longer does: with every name
  // dropped the audience is empty, and an empty host list is not the same fact
  // as `mine`, so the rule is refused with a reason rather than propagating.
  it('and REFUSES a rule whose only named host is not a host', () => {
    const verdict = validateReferenceRule({
      ...RULE,
      scope: { reach: 'global', audience: { kind: 'hosts', hosts: ['169.254.169.254'] } },
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok ? '' : verdict.reason).toContain('nothing reachable')
  })
})

describe('a refused rule degrades to an UNSCOPED reference instead of refusing', () => {

  // `validateReferenceRule` refuses a hand-picked source aimed past `mine` —
  // exactly the contradiction the module's own header says must be made
  // unrepresentable. But the BUILDER swallows that refusal: it returns the base
  // canonical-reference payload with no `rule` key and no signal, so the caller
  // signs an atom that carries `requiredMarks` and no scope at all. The
  // contradiction is not made unrepresentable; the scope is simply dropped.
  // FIXED 2026-09-03: it throws the refusal's own reason instead of returning
  // a payload with the scope quietly removed. The assertion is inverted from
  // "the rule is still in the payload" to "no payload comes back at all",
  // because the failure being guarded against is a SIGNED reference that looks
  // authored and carries no audience.
  it('refuses loudly instead of dropping the rule and returning an unscoped reference', () => {
    const refused = {
      source: { signatures: [SIG('a')] },
      predicate: {},
      scope: { reach: 'global', audience: { kind: 'community' } },
      projection: { fields: ['label'] },
      order: { by: 'name' },
    }
    expect(validateReferenceRule(refused).ok).toBe(false)

    expect(() => buildReferenceRulePayload({
      name: 'members',
      requiredMarks: ['team'],
      rule: refused as never,
    }), 'a builder handed a rule it refuses must not return a payload that looks authored').toThrow(/hand-picked/)
  })

  it('CONTROL: a valid rule does land in the payload', () => {
    const payload = buildReferenceRulePayload({ name: 'members', rule: RULE as never })
    expect('rule' in payload).toBe(true)
  })
})

// core/reference-rule.ts
//
// A REFERENCE IS A SAVED RULE. THE RULE IS TRUTH; THE RESULT IS DERIVED.
//
// An aggregation expressed as a rule — source, predicate, scope, projection,
// order — signed as an ordinary atom. The MEMBERSHIP it names is recomputed on
// demand and never committed, because a committed result would mean every tag
// change needed a commit, and two participants with different reach would have
// SIGNED DIFFERENT ANSWERS to the same question.
//
// ONE MECHANISM, TWO ARMS. A hand-picked list is the degenerate case of a rule
// ("these signatures"), not a second kind of thing. But degenerate is not the
// same as equivalent: a hand-picked list is an ALIAS reference, it carries
// addressing, and `documentation/pheromones.md` is explicit that an alias
// reference is never shareable because it leaks structure. `validateReferenceRule`
// computes that rather than trusting a flag, and REFUSES the contradiction —
// a hand-picked rule aimed at an audience beyond `mine` is rejected outright,
// because a computed-false flag that a caller can ignore is exactly how a team
// page ends up quietly showing strangers.
//
// SCOPE IS TWO ORTHOGONAL AXES AND BOTH ARE PART OF THE RULE FROM THE START.
//   reach    — topological: local / children / global. The vocabulary already
//              shipped in the tag filter.
//   audience — whose things: mine / named hosts / community. NEW. Nothing in
//              the tree has it; the only existing "whose" filter is the
//              deliberately session-only per-peer swarm filter.
// Collapsing them into one enum loses the sharing rule, because audience is
// what decides shareability. A rule with no scope is REJECTED: retrofitting one
// later leaves every existing reference ambiguous forever.
//
// ORDER LIVES ON THE MARK, never as a second field here. `by: 'mark'` delegates
// to the enrollment position — authored order first, location path as the
// tiebreak, unplaced last — and the next free slot is derived from the members
// themselves. Nothing anywhere keeps a counter and this does not add one.
//
// NO SIXTH MEMBERSHIP CARRIER. Four already exist plus a legacy fifth, and
// enrolment's adoption of the group mark was an explicit decision to stop at
// one. This rule EXTENDS the existing `reference` decoration
// (`canonical-reference.ts`), whose payload already carries source + predicate.

import {
  buildCanonicalReferencePayload,
  normalizeReferenceMarks,
  type CanonicalReferencePayloadOptions,
} from './canonical-reference.js'

const SIGNATURE = /^[0-9a-f]{64}$/i

/**
 * A DNS name, and nothing else.
 *
 * A rule whose audience is `hosts` is SHAREABLE, so a rule authored elsewhere
 * and imported here is a signed record telling THIS client where to go looking
 * — the evaluator hands `scope` straight to its reach port. The validator is
 * the last place the names are still data rather than a destination, so they
 * are checked here.
 *
 * REFUSED: anything carrying a scheme or a colon (`javascript:alert(1)`, a
 * port, a URL), anything with a path or a query (`../../etc`), a bare label
 * with no dot, and an IP LITERAL — which is how a shared rule would aim a
 * client at `169.254.169.254`, `127.0.0.1` or a private range. A host is
 * something the community can name and resolve, never a numeric address a
 * stranger chose.
 */
const HOST_NAME = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/
const ALL_DIGITS_AND_DOTS = /^[0-9.]+$/

export const isReachableHostName = (raw: unknown): boolean => {
  const host = String(raw ?? '').trim().toLowerCase()
  if (host.length === 0 || host.length > 253) return false
  if (ALL_DIGITS_AND_DOTS.test(host)) return false
  if (host.endsWith('-') || host.includes('--.')) return false
  return HOST_NAME.test(host)
}

/** The rule shape's own version. Carried in the atom so a reader of a rule
 *  written by a newer client can say so rather than mis-evaluate it. */
export const REFERENCE_RULE_VERSION = 1

/** WHERE the candidates come from.
 *  - `molecules` holds WORDS, never addresses: the address is derived at
 *    evaluation, so the rule stays readable and survives a fold-rule change.
 *  - `signatures` is the hand-picked list — the degenerate arm. */
export type ReferenceSource =
  | { readonly molecules: readonly string[] }
  | { readonly signatures: readonly string[] }

/** The predicate over marks. OR inside a group, AND across groups — the
 *  semantics already shipped (`meetsLens && meetsRequirement`, each an
 *  any-match), with the shipped shape as the degenerate one-group case.
 *  `none` excludes. `bouquet` is a mark-set identity, unioned into the LAST
 *  group at evaluation the way the reference reader already unions it. */
export interface ReferencePredicate {
  readonly any?: ReadonlyArray<readonly string[]>
  readonly none?: readonly string[]
  readonly bouquet?: string
}

export type ReferenceReach = 'local' | 'children' | 'global'

export type ReferenceAudience =
  | { readonly kind: 'mine' }
  | { readonly kind: 'hosts'; readonly hosts: readonly string[] }
  | { readonly kind: 'community' }

export interface ReferenceScope {
  readonly reach: ReferenceReach
  readonly audience: ReferenceAudience
}

/** WHAT a row carries. The field names mirror the shell's aggregate row so a
 *  later surface needs no translation layer — mirrored, never imported, because
 *  a module may not import shared. */
export type ReferenceField = 'label' | 'segments' | 'marks' | 'image'

export interface ReferenceProjection {
  readonly fields: readonly ReferenceField[]
  readonly limit?: number
}

export interface ReferenceOrder {
  readonly by: 'mark' | 'name' | 'path'
}

export interface ReferenceRule {
  readonly v: number
  readonly source: ReferenceSource
  readonly predicate: ReferencePredicate
  readonly scope: ReferenceScope
  readonly projection: ReferenceProjection
  readonly order: ReferenceOrder
}

export type RuleVerdict =
  | {
      readonly ok: true
      readonly rule: ReferenceRule
      /** False for the hand-picked arm — it is an alias reference and leaks
       *  structure. Computed, never declared. */
      readonly shareable: boolean
      /** Present when the rule may be evaluated but its RESULT must not leave. */
      readonly localOnly?: string
    }
  | { readonly ok: false; readonly reason: string }

const REACHES = new Set<ReferenceReach>(['local', 'children', 'global'])
const FIELDS = new Set<ReferenceField>(['label', 'segments', 'marks', 'image'])
const ORDERS = new Set<ReferenceOrder['by']>(['mark', 'name', 'path'])

const words = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.map(w => String(w ?? '').trim()).filter(Boolean))].sort()
    : []

const sigs = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.map(s => String(s ?? '').trim().toLowerCase()).filter(s => SIGNATURE.test(s)))].sort()
    : []

/** Normalise the predicate: each group sorted/deduped/blank-free by the SAME
 *  normalizer the reference decoration already uses, empty groups dropped, the
 *  groups themselves ordered so two authors of the same predicate produce the
 *  same bytes. */
export const normalizeReferencePredicate = (raw: unknown): ReferencePredicate => {
  const source = (raw ?? {}) as Record<string, unknown>
  const groups: string[][] = []
  const anyRaw = source['any']
  if (Array.isArray(anyRaw)) {
    for (const group of anyRaw) {
      const marks = normalizeReferenceMarks(Array.isArray(group) ? group.map(String) : [])
      if (marks.length > 0) groups.push(marks)
    }
  }
  groups.sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')))
  const none = normalizeReferenceMarks(Array.isArray(source['none']) ? (source['none'] as unknown[]).map(String) : [])
  const bouquet = String(source['bouquet'] ?? '').toLowerCase()
  return {
    ...(groups.length > 0 ? { any: groups } : {}),
    ...(none.length > 0 ? { none } : {}),
    ...(SIGNATURE.test(bouquet) ? { bouquet } : {}),
  }
}

/**
 * Validate a rule, and say what may be done with it.
 *
 * REJECTS:
 *   - no source, or a source arm with nothing in it
 *   - NO SCOPE — the retrofit this design refuses. A rule without one is
 *     ambiguous forever, so it is refused at the door rather than defaulted.
 *   - `hosts` with no hosts named
 *   - a hand-picked (alias) source aimed past `mine`. Unshareable-and-federated
 *     is a contradiction, and making it unrepresentable is what actually stops
 *     the failure; reporting it as a flag does not.
 */
export const validateReferenceRule = (raw: unknown): RuleVerdict => {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'a rule must be an object' }
  const input = raw as Record<string, unknown>

  const sourceRaw = (input['source'] ?? {}) as Record<string, unknown>
  let source: ReferenceSource | null = null
  let shareable = true
  if (Array.isArray(sourceRaw['signatures'])) {
    const picked = sigs(sourceRaw['signatures'])
    if (picked.length === 0) return { ok: false, reason: 'a hand-picked source names no signatures' }
    source = { signatures: picked }
    shareable = false
  } else if (Array.isArray(sourceRaw['molecules'])) {
    const named = words(sourceRaw['molecules'])
    if (named.length === 0) return { ok: false, reason: 'a molecule source names no words' }
    source = { molecules: named }
  }
  if (!source) return { ok: false, reason: 'a rule needs a source: molecules (words) or signatures (a hand-picked list)' }

  const scopeRaw = input['scope']
  if (!scopeRaw || typeof scopeRaw !== 'object') {
    return { ok: false, reason: 'scope is part of the rule — a rule without one is ambiguous forever, so it is refused rather than defaulted' }
  }
  const scopeInput = scopeRaw as Record<string, unknown>
  const reach = String(scopeInput['reach'] ?? '') as ReferenceReach
  if (!REACHES.has(reach)) {
    return { ok: false, reason: `scope.reach must be local, children or global — got '${String(scopeInput['reach'] ?? '')}'` }
  }
  const audienceRaw = (scopeInput['audience'] ?? {}) as Record<string, unknown>
  const audienceKind = String(audienceRaw['kind'] ?? '')
  let audience: ReferenceAudience
  if (audienceKind === 'mine') audience = { kind: 'mine' }
  else if (audienceKind === 'community') audience = { kind: 'community' }
  else if (audienceKind === 'hosts') {
    const named = (Array.isArray(audienceRaw['hosts']) ? audienceRaw['hosts'] : []).map(h => String(h ?? '').trim()).filter(Boolean)
    // A name that is not a host is DROPPED, not carried: the reach port is
    // handed this scope verbatim, and a rule that arrived from a peer must not
    // be able to name a destination this client would not have named itself.
    const hosts = [...new Set(named.filter(isReachableHostName).map(h => h.toLowerCase()))].sort()
    if (hosts.length === 0) {
      return named.length === 0
        ? { ok: false, reason: "scope.audience 'hosts' names no hosts — an empty host list is not the same fact as 'mine'" }
        : { ok: false, reason: `scope.audience 'hosts' names nothing reachable — ${named.map(h => `'${h}'`).join(', ')} are not host names. A host is a DNS name the community can resolve, never an IP literal, a scheme or a path.` }
    }
    audience = { kind: 'hosts', hosts }
  } else {
    return { ok: false, reason: "scope.audience.kind must be mine, hosts or community — whose things a rule gathers is not derivable from its reach" }
  }

  if (!shareable && audience.kind !== 'mine') {
    return {
      ok: false,
      reason: 'a hand-picked source is an ALIAS reference — it carries addressing and leaks structure, so it can never be shared. Aim it at audience `mine`, or express the membership as a predicate over marks.',
    }
  }

  const projectionRaw = (input['projection'] ?? {}) as Record<string, unknown>
  const fields = [...new Set((Array.isArray(projectionRaw['fields']) ? projectionRaw['fields'] : []).map(f => String(f ?? '')))]
    .filter((f): f is ReferenceField => FIELDS.has(f as ReferenceField))
  if (fields.length === 0) return { ok: false, reason: 'a projection names no fields — label, segments, marks or image' }
  const limitRaw = Number(projectionRaw['limit'])
  const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined

  const orderRaw = (input['order'] ?? {}) as Record<string, unknown>
  const by = String(orderRaw['by'] ?? '') as ReferenceOrder['by']
  if (!ORDERS.has(by)) return { ok: false, reason: `order.by must be mark, name or path — got '${String(orderRaw['by'] ?? '')}'` }

  const rule: ReferenceRule = {
    v: REFERENCE_RULE_VERSION,
    source,
    predicate: normalizeReferencePredicate(input['predicate']),
    scope: { reach, audience },
    projection: { fields: fields.sort(), ...(limit ? { limit } : {}) },
    order: { by },
  }
  return {
    ok: true,
    rule,
    shareable,
    ...(shareable ? {} : { localOnly: 'a hand-picked list names addresses, so the rule stays in this hive' }),
    ...(shareable && audience.kind === 'mine'
      ? { localOnly: "audience 'mine' — the rule may be shared, its RESULT may not" }
      : {}),
  }
}

/**
 * The reference payload with the rule appended.
 *
 * BYTE STABILITY IS THE POINT of appending. The rule's fields land AFTER every
 * field `buildCanonicalReferencePayload` already emits, so a record that
 * carries no rule produces byte-identical payload bytes to today's — no
 * re-signing, no merkle cascade across every existing reference. The spec
 * asserts exactly that.
 *
 * A REFUSED RULE THROWS, IT DOES NOT DEGRADE. Returning the base payload would
 * hand the caller a reference carrying `requiredMarks` and NO SCOPE — the
 * unscoped reference the existing reader already understands — so the
 * contradiction this module refuses (hand-picked plus federated) would be
 * committed as a rule with no audience at all. That is the failure the header
 * says is made unrepresentable, and silence is how it would happen. The reason
 * travels with the throw so a caller can show it.
 */
export const buildReferenceRulePayload = (
  opts: CanonicalReferencePayloadOptions & { rule?: ReferenceRule },
): Record<string, unknown> => {
  const payload = buildCanonicalReferencePayload(opts)
  if (!opts.rule) return payload
  const verdict = validateReferenceRule(opts.rule)
  if (!verdict.ok) throw new RangeError(`buildReferenceRulePayload: ${verdict.reason}`)
  payload['rule'] = verdict.rule as unknown as Record<string, unknown>
  return payload
}

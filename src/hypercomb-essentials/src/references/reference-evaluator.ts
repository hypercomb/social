// references/reference-evaluator.ts
//
// THE LOCAL EVALUATOR for a saved reference rule. Shape and evaluator only —
// NO UI, no shell surface, no effect emission.
//
// THE RULE IS TRUTH; THE RESULT IS A PROJECTION. Nothing here is written to any
// pool and nothing is committed. A reference result is NOT a pure derivation of
// one input signature — membership can change ANYWHERE in the hive, so there is
// no source sig to key a record by, and keying it by rule name, rule sig or
// path would violate the first line of the derived-cache contract. So the only
// caching is an IN-SESSION memo dropped whenever the tree epoch moves or marks
// change; that is the same honesty enrolment's wholesale memo drop settled on.
//
// AND IT EMITS NOTHING. The evaluator must never push its predicate onto the
// participant's tag lens: that would overwrite a sticky filter and surface as a
// toggleable chip, which is not relaxing a filter but editing the reference.
//
// PORTS, NOT IMPORTS. Every collaborator arrives as a function so the evaluator
// is testable with no shell, and so the mark read goes through the DECLARED
// UNION SEAM (`PheromoneMarks.marksOf` — location marks ∪ sig marks) rather
// than around it. Reading the location index alone silently drops sig-carried
// marks; parsing decoration blobs directly drops those AND the hidden filter.
//
// NO THIRD FULL-HIVE WALK. Two independent root walks already exist with the
// same depth and the same read triple. This evaluator resolves candidates from
// the molecule index (or its cold-path fallback), which follows MANIFESTS.

import {
  type ReferenceRule, type ReferenceScope, validateReferenceRule,
} from '@hypercomb/core'

const SIGNATURE = /^[0-9a-f]{64}$/i

const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

/** One candidate the source arm produced, before the predicate runs. */
export interface ReferenceCandidate {
  readonly key: string
  readonly label: string
  readonly segments: readonly string[]
  readonly sig?: string
  readonly imageSig?: string
  /** The authored position this candidate carries in the rule's set, if any.
   *  Order lives on the MARK; the rule never adds a second order field. */
  readonly order?: number
  /**
   * WHERE THIS ROW CAME FROM — the host that answered for it, absent for a row
   * out of this participant's own hive. Provenance, never authority.
   *
   * WITHOUT THIS FIELD `audience` IS UNDECIDABLE. The whole direction is "say a
   * word, hash it, ask your HOSTS", so the source port can reach past this
   * hive; a rule the participant scoped to their own things would then quietly
   * carry a stranger's row and the result would still report itself complete.
   * The evaluator cannot filter what the data does not distinguish, and
   * retrofitting the field later is exactly the retrofit this design refused
   * for `scope` itself — so it is here from the start, and a source that
   * cannot say is treated as local rather than guessed at.
   */
  readonly origin?: string
}

/** A projected row. The field NAMES mirror the shell's aggregate row so a later
 *  surface can register a source with no translation layer — mirrored, never
 *  imported, because a module may never import shared. */
export interface ReferenceRow {
  readonly key: string
  readonly label?: string
  readonly segments?: readonly string[]
  readonly marks?: readonly string[]
  readonly imageSig?: string
}

export interface ReferenceResult {
  readonly rows: readonly ReferenceRow[]
  /** How many PASSED the predicate, before the projection limit trimmed. */
  readonly total: number
  /** True when the answer came from an incomplete picture — an unreached
   *  audience, an un-hydrated mark index, a budget cut. The rows are real;
   *  there may be more of them. A caller that ignores this shows a team page
   *  containing only its own things and reads it as complete. */
  readonly partial: boolean
  readonly scope: ReferenceScope
}

/** What the evaluator needs from the world. Every one is optional; a missing
 *  port degrades the answer and sets `partial`, it never throws. */
export interface ReferencePorts {
  /** Candidates for one molecule word, at a location.
   *
   *  IT IS HANDED THE WHOLE SCOPE, not just the reach. The audience is the
   *  half that decides WHOSE things a rule gathers, and a source that is never
   *  told it cannot honour it — a rule scoped `mine` and one scoped
   *  `community` would ask the world byte-identical questions. */
  candidates?(word: string, at: readonly string[], scope: ReferenceScope): Promise<readonly ReferenceCandidate[]>
  /** Candidates for a hand-picked signature. */
  bySignature?(sig: string): Promise<ReferenceCandidate | null>
  /** THE union mark read — location marks ∪ sig marks. */
  marksOf?(target: { label?: string; segments?: readonly string[]; sig?: string }): Promise<readonly string[]>
  /** Hydrate the session-local mark index for these locations, so a predicate
   *  does not silently under-report for places this session never visited. */
  hydrate?(candidates: readonly ReferenceCandidate[]): Promise<boolean>
  /** The mark names behind a bouquet signature. */
  bouquetMarks?(sig: string): Promise<readonly string[]>
  /** Replicas that can answer for an audience beyond `mine`. Absent means the
   *  transport is not wired, and the answer says `partial` rather than
   *  pretending the local hive is the community. */
  reach?(scope: ReferenceScope): Promise<readonly string[]>
  /** O(1) "could a tree-wide answer have changed?" — the memo key. */
  treeEpoch?(): number
}

const defaultPorts = (): ReferencePorts => {
  const marks = ioc<{ marksOf?: ReferencePorts['marksOf'] }>('@diamondcoreprocessor.com/PheromoneMarks')
  const history = ioc<{ treeEpoch?: () => number }>('@diamondcoreprocessor.com/HistoryService')
  return {
    ...(marks?.marksOf ? { marksOf: marks.marksOf } : {}),
    ...(history?.treeEpoch ? { treeEpoch: () => history.treeEpoch?.() ?? 0 } : {}),
  }
}

/** How many candidates a pass will hydrate marks for before it gives up and
 *  says so. Silent under-reporting is the failure mode; bounded and honest is
 *  the trade. */
export const HYDRATE_BUDGET = 400

/** Does a candidate's mark set satisfy the predicate? OR inside a group, AND
 *  across groups — the semantics already shipped, with the shipped one-group
 *  shape as the degenerate case. `none` excludes. */
export const meetsPredicate = (
  marks: readonly string[],
  groups: ReadonlyArray<readonly string[]>,
  none: readonly string[],
): boolean => {
  const held = new Set(marks)
  for (const mark of none) if (held.has(mark)) return false
  for (const group of groups) {
    if (group.length === 0) continue
    if (!group.some(m => held.has(m))) return false
  }
  return true
}

const compare = (
  by: ReferenceRule['order']['by'],
  a: ReferenceCandidate,
  b: ReferenceCandidate,
): number => {
  if (by === 'name') return a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
  if (by === 'path') return a.segments.join('/').localeCompare(b.segments.join('/')) || a.key.localeCompare(b.key)
  // 'mark' — the authored position on the mark, location path as the tiebreak,
  // unplaced last. Nothing anywhere keeps a counter.
  const ao = Number.isFinite(a.order as number) ? (a.order as number) : Number.POSITIVE_INFINITY
  const bo = Number.isFinite(b.order as number) ? (b.order as number) : Number.POSITIVE_INFINITY
  if (ao !== bo) return ao - bo
  return a.segments.join('/').localeCompare(b.segments.join('/')) || a.key.localeCompare(b.key)
}

export class ReferenceEvaluator {

  #ports: ReferencePorts
  /** rule bytes → { epoch, result }. In-session only. Zero persistence, zero
   *  pool, zero commit. */
  #memo = new Map<string, { epoch: number; at: string; result: ReferenceResult }>()

  constructor(ports: ReferencePorts = defaultPorts()) {
    this.#ports = ports
  }

  /** Drop every memoised result. Called when marks change or the tree moves —
   *  wholesale, because membership can change anywhere and nothing hands us a
   *  local head to key an invalidation on. */
  forget(): void { this.#memo.clear() }

  /**
   * Evaluate a rule at a location. Deterministic: the same rule over the same
   * hive gives the same rows in the same order, every time.
   */
  evaluate = async (raw: unknown, at: readonly string[] = []): Promise<ReferenceResult | null> => {
    const verdict = validateReferenceRule(raw)
    if (!verdict.ok) return null
    const rule = verdict.rule

    const key = JSON.stringify(rule)
    const where = at.join('\u0000')
    const epoch = this.#ports.treeEpoch?.() ?? 0
    const held = this.#memo.get(key)
    if (held && held.epoch === epoch && held.at === where) return held.result

    let partial = false

    // ── source ──────────────────────────────────────────────────────────
    const candidates: ReferenceCandidate[] = []
    const seen = new Set<string>()
    const take = (candidate: ReferenceCandidate | null): void => {
      if (!candidate || seen.has(candidate.key)) return
      seen.add(candidate.key)
      candidates.push(candidate)
    }

    if ('signatures' in rule.source) {
      // THE DEGENERATE ARM — no walk at all, and no reach beyond `mine` is
      // even representable (the validator refuses it), because a hand-picked
      // list is an alias reference and leaks structure.
      for (const sig of rule.source.signatures) {
        if (this.#ports.bySignature) take(await this.#ports.bySignature(sig).catch(() => null))
        else take({ key: sig, label: '', segments: [], sig })
      }
    } else {
      if (!this.#ports.candidates) partial = true
      for (const word of rule.source.molecules) {
        const found = await this.#ports.candidates?.(word, at, rule.scope).catch(() => []) ?? []
        for (const candidate of found) take(candidate)
      }
    }

    // ── audience ────────────────────────────────────────────────────────
    // `hosts` and `community` validate and evaluate, and return the LOCAL
    // answer flagged partial until a host transport is wired. Declared in the
    // type, honest at runtime, never silently stubbed.
    if (rule.scope.audience.kind !== 'mine') {
      const replicas = await this.#ports.reach?.(rule.scope).catch(() => null)
      if (!replicas || replicas.length === 0) partial = true
    } else {
      // AUDIENCE `mine` IS ENFORCED HERE, not merely recorded. A source that
      // reaches past this hive — which is the entire direction — must not be
      // able to put a stranger's row into a rule the participant scoped to
      // their own things. A row that names no origin is this hive's own; one
      // that names a host is dropped, and the drop is reported, because a
      // source that ignored the audience may have got the rest wrong too.
      const before = candidates.length
      const own = candidates.filter(candidate => !candidate.origin)
      if (own.length !== before) {
        candidates.length = 0
        candidates.push(...own)
        partial = true
      }
    }

    // ── predicate ───────────────────────────────────────────────────────
    const groups: string[][] = (rule.predicate.any ?? []).map(g => [...g])
    // AN UNRESOLVABLE RESTRICTION NARROWS TO NOTHING; IT NEVER WIDENS TO
    // EVERYTHING. A predicate that is only a bouquet ("the members of this
    // mark-set") used to lose its whole restriction when the pool member could
    // not be read — the group was never pushed, the filter block never ran,
    // and every candidate came back. The rows were then not a subset of the
    // rule's answer but the COMPLEMENT of it, and a members-of-this-team
    // reference rendered everyone.
    let unevaluable = false
    if (rule.predicate.bouquet) {
      const marks = await this.#ports.bouquetMarks?.(rule.predicate.bouquet).catch(() => null)
      if (marks?.length) groups.push([...marks])
      else { partial = true; unevaluable = true }
    }
    const none = rule.predicate.none ?? []

    let matched: ReferenceCandidate[] = candidates
    const marksByKey = new Map<string, readonly string[]>()
    if (unevaluable) {
      matched = []
    } else if (groups.length > 0 || none.length > 0) {
      if (candidates.length > HYDRATE_BUDGET) partial = true
      const hydrated = await this.#ports.hydrate?.(candidates.slice(0, HYDRATE_BUDGET)).catch(() => false)
      if (this.#ports.hydrate && hydrated === false) partial = true
      if (!this.#ports.marksOf) {
        // No mark read at all: a predicate that cannot be evaluated must not
        // silently pass everything.
        matched = []
        partial = true
      } else {
        matched = []
        for (const candidate of candidates) {
          // A THROWING MARK READ IS NOT "THIS THING CARRIES NO MARKS". It used
          // to be caught as `[]`, which turned a `none` EXCLUSION into a
          // no-op — an "everything except marked private" rule returned the
          // private rows, and nothing set `partial`. A mark set that could not
          // be read cannot satisfy a predicate over marks, so the candidate is
          // excluded and the answer says it was incomplete.
          const marks = await this.#ports.marksOf({
            ...(candidate.label ? { label: candidate.label } : {}),
            ...(candidate.segments.length ? { segments: candidate.segments } : {}),
            ...(candidate.sig ? { sig: candidate.sig } : {}),
          }).catch(() => null)
          if (!marks) { partial = true; continue }
          marksByKey.set(candidate.key, marks)
          if (meetsPredicate(marks, groups, none)) matched.push(candidate)
        }
      }
    }

    // ── order + projection ──────────────────────────────────────────────
    matched = [...matched].sort((a, b) => compare(rule.order.by, a, b))
    const total = matched.length
    const shown = rule.projection.limit ? matched.slice(0, rule.projection.limit) : matched
    const fields = new Set(rule.projection.fields)
    const rows: ReferenceRow[] = shown.map(candidate => ({
      key: candidate.key,
      ...(fields.has('label') ? { label: candidate.label } : {}),
      ...(fields.has('segments') ? { segments: candidate.segments } : {}),
      ...(fields.has('marks') ? { marks: marksByKey.get(candidate.key) ?? [] } : {}),
      ...(fields.has('image') && candidate.imageSig ? { imageSig: candidate.imageSig } : {}),
    }))

    const result: ReferenceResult = { rows, total, partial, scope: rule.scope }
    if (this.#memo.size > 32) this.#memo.clear()
    this.#memo.set(key, { epoch, at: where, result })
    return result
  }
}

/** A hand-picked candidate straight from a signature, for the degenerate arm
 *  when no resolver port is supplied. Exported so a caller can build the same
 *  shape without reaching into the class. */
export const candidateOfSignature = (sig: string): ReferenceCandidate | null =>
  SIGNATURE.test(sig) ? { key: sig.toLowerCase(), label: '', segments: [], sig: sig.toLowerCase() } : null

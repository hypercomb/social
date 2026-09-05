// core/machine-admission.ts
//
// ONE ANSWER TO "MAY THIS CALLER SAY THIS WORD" — for every door that is not
// a participant's own hands.
//
// THE PROBLEM THIS EXISTS TO END. Four surfaces turn language into execution
// here: keyboard prose, canonical slash, the bridge's `submit`, and the model
// channel `hypercomb_act`. Each grew its own admission rule, and the audit
// (documentation/natural-language-surface-audit.md) found the four in open
// disagreement — exactly one was default-deny, one filtered concealed verbs,
// one gated destruction against a hand-kept set of four names that had already
// drifted, and one gated nothing at all. The differences were not a design.
// They were the order the code was written in.
//
// That is the same shape as every list this codebase has already retired: the
// pool-meaning lists that drifted until `/flatten` deleted a pool, and
// `CALLABLE_FORMS`, whose five hand-written names told a participant that
// Hypercomb has no delete behaviour. A second copy of a truth drifts toward
// less than exists — and an admission rule that drifts toward less does not
// fail safe. It fails OPEN at whichever door was not updated.
//
// So the decision moves off the doors. A door's job is to say WHO is calling
// and to resolve the spoken word to a census entry; what may then be said is
// answered here, once, from the properties the behaviour declares about
// itself. Add a door and it inherits the rule. Change the rule and every door
// changes with it.
//
// WHAT THIS IS NOT. It is not an authority check on the participant. A person
// typing into their own command line is not a caller to be admitted — they are
// the one the hive belongs to, and the keyboard therefore does not consult
// this module at all. `MachineCaller` has no 'participant' member on purpose:
// the day it gains one is the day somebody starts gating the owner.

import type { MachineReach, MachineScope } from './machine-grammar.js'

/**
 * WHO CHOSE THE WORDS. Not which surface they arrived on — the surface is an
 * implementation detail that has already proved it drifts, and two doors can
 * carry the same caller.
 *
 * The two differ in exactly ONE bit: whether a behaviour must have declared
 * itself machine-callable. Everything else below applies to both, which is
 * the point — the shared half used to be four divergent copies.
 */
export type MachineCaller =
  /**
   * A tool the participant is driving right now, on their own machine, with
   * the receipts in front of them — the Claude bridge is the one in the tree.
   * A DECLARATION IS NOT REQUIRED: ~97 of ~109 behaviours have no `machine`
   * block, and requiring one here would silently break the authoring tool
   * this hive is built with. The participant is present; what they are
   * protected from is a word they cannot answer, not a word they did not
   * anticipate.
   */
  | 'operator'
  /**
   * Words a model chose, inside a turn, with nobody's hand on them.
   * DEFAULT-DENY: no declaration, no call. This has been the model channel's
   * rule since `CALLABLE_FORMS` was retired, and it is the half of that
   * retirement worth keeping.
   */
  | 'model'

/**
 * THE PARTICIPANT'S CEILING — how far a machine may reach, and how far the
 * change may travel, in this hive, today.
 *
 * Two independent axes, because {@link MachineScope} exists precisely because
 * neither can be inferred from the other. Both are INCLUSIVE ceilings stated
 * in the same outward order the axes declare.
 */
export interface MachineGrant {
  readonly reach: GrantedReach
  readonly scope: MachineScope
}

/**
 * A grant's reach vocabulary is the declaration's, plus one value at the CLOSED
 * end. `'none'` is a ceiling no behaviour can be under — every declaration
 * reaches at least 'additive' — so it is the off switch, and it is one the
 * participant can reach for at any time.
 *
 * It exists only on the grant. A behaviour declaring `reach: 'none'` would be
 * declaring that it does nothing, which is not a thing to say about a verb.
 */
export type GrantedReach = 'none' | MachineReach

const REACH_ORDER: readonly GrantedReach[] = ['none', 'additive', 'editing', 'destructive']
const SCOPE_ORDER: readonly MachineScope[] = ['local', 'tile', 'page', 'hive', 'network']

/**
 * WHAT AN UNCONFIGURED HIVE GRANTS: everything except taking things away.
 *
 * The reach ceiling answers the audit's blunt question — *can a model delete a
 * tile unattended?* It could: one `hypercomb_act` call carrying `/remove <leaf>`
 * ran to a committed layer with no dialog, because `confirmRemoval` returns
 * true with no dialog when nothing is nested beneath the target. Under this
 * default it is neither offered nor admitted, and the participant can raise
 * the ceiling deliberately.
 *
 * The scope ceiling starts WIDE OPEN, and that is deliberate rather than
 * timid. `/hide` is editing at 'network' — it publishes a signed mesh event —
 * and it is also the gentle half of HIDE FIRST, DELETE SECOND, the verb a
 * model should reach for BEFORE `/remove`. A default that refused 'network'
 * would refuse the safe verb and leave nothing safer in its place, inverting
 * the doctrine at exactly the surface where a machine chooses. Scope is here
 * so a cautious participant can tighten to their own browser; it is not a
 * default suspicion.
 */
export const DEFAULT_MACHINE_GRANT: MachineGrant = { reach: 'editing', scope: 'network' }

/** A census row — as much of one as a decision needs. */
export interface AdmissionEntry {
  readonly name: string
  readonly aliases?: readonly string[]
  readonly hidden?: boolean
  readonly prototype?: boolean
  readonly machine?: {
    readonly reach?: MachineReach
    readonly scope?: MachineScope
  }
}

export type MachineAdmission =
  | { readonly admit: true; readonly name: string }
  | { readonly admit: false; readonly reason: string }

const refuse = (reason: string): MachineAdmission => ({ admit: false, reason })

/** Primary names ONLY. A machine's line resolves here so a participant alias
 *  can never redirect a canonical word to a different provider — the reason
 *  `executePublicCanonical` exists as a separate seam from `execute`. */
export const primaryEntry = <T extends AdmissionEntry>(
  verb: string, census: readonly T[],
): T | undefined => {
  const want = verb.trim().toLowerCase()
  return want ? census.find(entry => entry.name.trim().toLowerCase() === want) : undefined
}

/** Primary names AND the participant's own aliases, for a door that accepts
 *  the line a person would type. Aliases are participant-authored (no code may
 *  declare one), so this resolves what THEY named — and it matters most for
 *  refusals: `rm` must inherit `remove`'s reach rather than simply be absent
 *  from a list, which is how the retired four-name set was walked around. */
export const spokenEntry = <T extends AdmissionEntry>(
  verb: string, census: readonly T[],
): T | undefined => {
  const want = verb.trim().toLowerCase()
  if (!want) return undefined
  return census.find(entry =>
    entry.name.trim().toLowerCase() === want
    || (entry.aliases ?? []).some(alias => String(alias).trim().toLowerCase() === want))
}

/**
 * THE DECISION. One verb, the census row it resolved to (or none), who is
 * calling, and the participant's ceiling.
 *
 * Order matters and is deliberate: concealment is checked BEFORE the
 * declaration, so a hidden behaviour that declares a `machine` block is still
 * refused — and refused with the reason that actually applies.
 */
export const admitMachineCall = (
  verb: string,
  entry: AdmissionEntry | undefined,
  caller: MachineCaller,
  grant: MachineGrant = DEFAULT_MACHINE_GRANT,
): MachineAdmission => {
  const name = verb.trim().toLowerCase()
  if (!name) return refuse('no behaviour was named')

  // AN UNRESOLVED WORD IS NOT AUTOMATICALLY A REFUSAL. The bridge hands
  // unknown `/words` to the create-goto built-in, which is a participant
  // convenience the operator tool is entitled to; a model is not, and its own
  // parser has already refused an unlisted verb before reaching here.
  if (!entry) {
    return caller === 'operator'
      ? { admit: true, name }
      : refuse(`/${name} is not a behaviour in this hive`)
  }

  // HIDDEN IS A DISCOVERABILITY FLAG BEING READ AS AN AUTHORIZATION ONE.
  // `slashHidden` is documented as "must be typed in full on purpose" — a
  // HUMAN-typing assumption a machine defeats for free. Read off a live census
  // 2026-09-04, twelve verbs sit behind it and four of them cut deep:
  // `/prune`, `/sweep`, `/consolidate-history`, `/consolidate-content`. The
  // kind of thing that lives back there is why: `/flatten`, retired since, is
  // the verb that once hard-deleted a pool it mistook for a lineage bag.
  // A prototype is workshop-stage code, concealed the same way for the same
  // reason: nobody chose to offer it.
  //
  // NAMES GO STALE AND THE RULE MUST NOT. This gate reads the flag, never a
  // list of the verbs carrying it — the earlier draft of this comment named
  // `/flatten` and `/collapse-history` as live, and neither is in the census
  // any more.
  if (entry.hidden === true || entry.prototype === true) {
    return refuse(`/${name} is not offered to a caller that is not typing it`)
  }

  // DEFAULT-DENY, AND ONLY HERE. This is the single bit that separates the two
  // callers. A behaviour's author decides — beside its description, its
  // options and its examples — whether a model may say it at all.
  if (caller === 'model' && !entry.machine) {
    return refuse(`/${name} is not available for model actions`)
  }

  // Unstated reach means 'editing' — the documented default on MachineGrammar.
  const reach = entry.machine?.reach ?? 'editing'
  if (REACH_ORDER.indexOf(reach) > REACH_ORDER.indexOf(grant.reach)) {
    return refuse(grant.reach === 'none'
      ? `this hive grants a machine nothing at present, so /${name} cannot be run from here`
      : `/${name} is ${reach}, and this hive grants a machine no further than ${grant.reach}`)
  }

  // SCOPE IS DECLARED AS A CEILING, and a MISSING scope is UNKNOWN rather than
  // a default. The twelve values that exist were each traced to their commit;
  // a thirteenth that declares none has not been judged, so it passes only
  // while the grant is at its widest, and drops out the moment a participant
  // tightens anything. Refusing what has not been judged is the safe
  // direction — and it is the direction that makes declaring a scope worth
  // the trouble.
  const scope = entry.machine?.scope
  const ceiling = SCOPE_ORDER.indexOf(grant.scope)
  if (scope === undefined) {
    if (ceiling < SCOPE_ORDER.length - 1) {
      return refuse(`/${name} has not declared how far it travels, and this hive has narrowed that`)
    }
  } else if (SCOPE_ORDER.indexOf(scope) > ceiling) {
    return refuse(
      `/${name} reaches the ${scope}, and this hive keeps a machine within the ${grant.scope}`,
    )
  }

  return { admit: true, name: entry.name.trim().toLowerCase() }
}

/**
 * The grant as a participant stores it: `"<reach>/<scope>"`, e.g. `editing/hive`.
 * A shape a person can read and edit in one line — and one that cannot widen by
 * accident: anything unrecognized clamps to the DEFAULT rather than to the
 * maximum, so a corrupt value never grants more than an absent one.
 */
export const readMachineGrant = (raw: unknown): MachineGrant => {
  const [reach, scope] = String(raw ?? '').trim().toLowerCase().split('/')
  return {
    reach: (REACH_ORDER as readonly string[]).includes(reach)
      ? reach as GrantedReach : DEFAULT_MACHINE_GRANT.reach,
    scope: (SCOPE_ORDER as readonly string[]).includes(scope)
      ? scope as MachineScope : DEFAULT_MACHINE_GRANT.scope,
  }
}

/** The stored form of a grant. One writer, so the reader has one shape to know. */
export const writeMachineGrant = (grant: MachineGrant): string => `${grant.reach}/${grant.scope}`

/** The two ladders, outward, for anything that offers the participant a choice
 *  between rungs. Exported so a word for setting the grant completes from the
 *  same order the gate compares against — a second copy of a ladder drifts the
 *  way a second copy of a list does. */
export const GRANTED_REACHES: readonly GrantedReach[] = REACH_ORDER
export const GRANTED_SCOPES: readonly MachineScope[] = SCOPE_ORDER

/** Where a participant's ceiling is kept. Read by every machine door; written
 *  by the participant's own word for it. */
export const MACHINE_GRANT_KEY = 'hc:machine-grant'

/** The live ceiling, or the default wherever there is no storage to ask
 *  (a worker, a node test, a locked-down browser). */
export const currentMachineGrant = (): MachineGrant => {
  try {
    const store = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage
    return readMachineGrant(store?.getItem(MACHINE_GRANT_KEY))
  } catch { return DEFAULT_MACHINE_GRANT }
}

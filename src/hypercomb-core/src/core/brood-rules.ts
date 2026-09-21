// hypercomb-core/src/core/brood-rules.ts
//
// WHAT PUTS CODE IN THE BROOD IS A RULE, NOT A HAND (Jaime, 2026-09-20).
//
// The brood holds; these rules decide what gets held. Three kinds of arrival,
// and the participant says what happens to each:
//
//   OWN        code you wrote here. Runs by default — it is yours — but you
//              may choose to hold it too, because you might want to TEST it
//              before it runs against your own tree.
//   FOLLOWED   code from a community you subscribe to. Runs by default, which
//              is exactly what happens today once activation-authority has
//              accepted an attested package: this file must not change that.
//   STRANGER   everybody else. Held, or refused. NEVER run — the type has no
//              'run' to choose, so no settings screen, migration or careless
//              merge can turn that corner.
//
// AND THE POINT OF SUBSCRIBING: a VOUCH. When a community you follow has
// already held, read and accepted a signature, that is a ruling you can lean
// on. `vouchesNeeded` is how many independent followed keys must have accepted
// before their agreement stands in for your hand. This is the part that makes
// the platform safer rather than merely stricter: many participants each run
// their own audits before accepting the risk, and the ones who did the work
// carry the ones who did not — but only among keys YOU chose, and only at the
// count YOU set.
//
// FAIL CLOSED, TWICE OVER. A vouch counts only when the key that made it is in
// the followed set, and the followed set comes from whoever registered under
// BROOD_TRUST_IOC_KEY (nostr lives in essentials, not here). No provider
// registered means no follows, means no vouch counts, means the rules fall
// back to holding. Absence of trust is never a free pass.
//
// Your OWN ruling always wins, either way: an acceptance you made by hand runs
// even if every rule would hold it, and a refusal you made by hand stands even
// if a hundred communities vouch. The rules decide only what you have not.

import { registerPoolMeaning } from './pool-registry.js'

export const BROOD_RULES_MEANING = 'brood:rules'

/** Whoever registers this answers "which keys does this participant follow?".
 *  Nothing else in core may decide it. */
export const BROOD_TRUST_IOC_KEY = '@hypercomb.social/BroodTrust'

export type BroodTrust = { readonly follows: () => readonly string[] }

/** What happens to an arrival. There is deliberately no 'run' for a stranger. */
export type BroodRules = {
  readonly own: 'run' | 'hold'
  readonly followed: 'run' | 'hold'
  readonly stranger: 'hold' | 'refuse'
  /** Independent followed keys whose acceptance stands in for your hand.
   *  0 means vouches never admit anything. */
  readonly vouchesNeeded: number
  /** May a followed community's vouches admit a STRANGER's code? Off by
   *  default: subscribing decides who you trust to vouch, not whose code you
   *  will run sight unseen. */
  readonly vouchesAdmitStrangers: boolean
}

/** Today's behaviour, written down: what already runs keeps running, and only
 *  what is currently turned away is newly held. */
export const DEFAULT_BROOD_RULES: BroodRules = {
  own: 'run',
  followed: 'run',
  stranger: 'hold',
  vouchesNeeded: 2,
  vouchesAdmitStrangers: false,
}

export type ArrivalKind = 'own' | 'followed' | 'stranger'
export type BroodVerdict = 'run' | 'hold' | 'refuse'

/** One community's ruling on a signature, ALREADY VERIFIED by the caller.
 *  Core never checks a signature; it only counts keys it was told to trust. */
export type BroodVouch = {
  readonly by: string
  readonly verdict: 'accepted' | 'refused'
  readonly at: number
  /** Their audit report, if they published one. */
  readonly reportSig?: string
}

const cache: { rules?: BroodRules } =
  ((globalThis as { __hypercombBroodRules?: { rules?: BroodRules } }).__hypercombBroodRules ??= {})

const rulesDir = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const root = await globalThis.navigator?.storage?.getDirectory?.()
    if (!root) return null
    return await root.getDirectoryHandle(await registerPoolMeaning(BROOD_RULES_MEANING), { create })
  } catch { return null }
}

/** The pool names its own single record: one participant, one policy. */
const rulesEntry = async (): Promise<string> => await registerPoolMeaning(BROOD_RULES_MEANING)

/** Anything missing or out of range falls back to the default — a damaged
 *  policy file must not become a permissive one. */
export const readRules = (raw: unknown): BroodRules => {
  const value = (raw ?? {}) as Partial<BroodRules>
  const needed = Number(value.vouchesNeeded)
  return {
    own: value.own === 'hold' ? 'hold' : 'run',
    followed: value.followed === 'hold' ? 'hold' : 'run',
    stranger: value.stranger === 'refuse' ? 'refuse' : 'hold',
    vouchesNeeded: Number.isFinite(needed) && needed >= 0 ? Math.floor(needed) : DEFAULT_BROOD_RULES.vouchesNeeded,
    vouchesAdmitStrangers: value.vouchesAdmitStrangers === true,
  }
}

export const broodRules = async (): Promise<BroodRules> => {
  if (cache.rules) return cache.rules
  let rules = DEFAULT_BROOD_RULES
  try {
    const dir = await rulesDir(false)
    const file = dir && await (await dir.getFileHandle(await rulesEntry())).getFile()
    if (file) rules = readRules(JSON.parse(await file.text()))
  } catch { /* never set — the defaults are the policy */ }
  cache.rules = rules
  return rules
}

export const setBroodRules = async (next: Partial<BroodRules>): Promise<BroodRules> => {
  const rules = readRules({ ...(await broodRules()), ...next })
  cache.rules = rules
  try {
    const dir = await rulesDir(true)
    if (dir) {
      const writable = await (await dir.getFileHandle(await rulesEntry(), { create: true })).createWritable()
      try { await writable.write(JSON.stringify(rules)) } finally { await writable.close() }
    }
  } catch { /* the session copy still holds it */ }
  return rules
}

/** The followed keys, or none when nothing vouches for the participant's
 *  trust — never an exception, never a free pass. */
export const followedKeys = (): readonly string[] => {
  try {
    const trust = (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<BroodTrust>(BROOD_TRUST_IOC_KEY)
    const follows = trust?.follows?.()
    return Array.isArray(follows) ? follows.filter(key => typeof key === 'string' && key.trim()) : []
  } catch { return [] }
}

/** Acceptances from distinct followed keys. A key that refused is not counted
 *  as an acceptance, and a key that did both is counted only as a refusal. */
export const countVouches = (
  vouches: readonly BroodVouch[] = [],
  follows: readonly string[] = followedKeys(),
): { readonly accepted: number; readonly refused: number } => {
  const trusted = new Set(follows)
  const accepted = new Set<string>()
  const refused = new Set<string>()
  for (const vouch of vouches) {
    if (!trusted.has(vouch.by)) continue
    if (vouch.verdict === 'refused') refused.add(vouch.by)
    else accepted.add(vouch.by)
  }
  for (const key of refused) accepted.delete(key)
  return { accepted: accepted.size, refused: refused.size }
}

/**
 * What happens to this arrival. Pure — every input is an argument, so the
 * policy can be reasoned about and tested without a hive around it.
 */
export const admitArrival = (
  kind: ArrivalKind,
  rules: BroodRules,
  vouches: readonly BroodVouch[] = [],
  follows: readonly string[] = followedKeys(),
): BroodVerdict => {
  const { accepted, refused } = countVouches(vouches, follows)
  // A followed community that looked and said no outranks the others' yes:
  // the whole point of subscribing is to hear that.
  if (refused > 0) return kind === 'stranger' && rules.stranger === 'refuse' ? 'refuse' : 'hold'

  const vouched = rules.vouchesNeeded > 0 && accepted >= rules.vouchesNeeded

  if (kind === 'own') return rules.own === 'hold' && !vouched ? 'hold' : 'run'
  if (kind === 'followed') return rules.followed === 'run' || vouched ? 'run' : 'hold'
  // Stranger. Vouches lift it only when the participant said they may, and
  // even then the ceiling is 'run' for the bytes — never a blanket trust of
  // the source.
  if (vouched && rules.vouchesAdmitStrangers) return 'run'
  return rules.stranger === 'refuse' ? 'refuse' : 'hold'
}

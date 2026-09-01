// assistant/model-policy.ts
//
// WHO ANSWERS, WHEN NOBODY SAID — the participant's standing instructions.
//
// Four tiers can answer now: a key in this browser, a CLI parked on the
// bridge, a model on this machine, and a model on somebody else's. A caller
// that names a provider gets that provider, always. But most callers do not
// name one — translation, expand, break-apart, a chat with no model chosen —
// and something has to decide. That decision used to be a hardcoded chain
// ending in "anthropic"; this file is what replaced it.
//
// ── the shape of the decision ─────────────────────────────────────────────
//
// A caller says what the WORK needs, never who should do it:
//
//     { tier: 'fast' }                    a small mechanical job
//     { tier: 'deep', readsHive: true }   heavy, and must walk the tree
//
// and the policy answers with a provider. The participant sets the policy in
// the providers console: a pin per tier ("deep is always Opus"), or "decide
// for me", plus a usage plan that says how "decide for me" should behave.
// Nothing here is content — it is device-local truth, like the keys and the
// activation switches it sits beside.
//
// ── the default is not neutral, and should not be ─────────────────────────
//
// INTELLIGENCE FIRST is the default. The orchestrator declares the capability
// the work needs; the router then prefers an exact tier and healthy headroom
// before it considers price. Economy is available, but only as an explicit
// participant choice — "free" is not a proxy for "right for the job".
//
// ALLOW PEERS is OFF. A peer's model is free, but the prompt travels to
// another person's machine and they can read it. That is a fine trade when
// the participant chooses it and an ugly surprise when a routine chooses it
// for them, so an automatic pick never lands on a peer. Naming or pinning one
// still works — the participant deciding is the whole point.

import { EffectBus, llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import type { LlmProviderDescriptor, LlmTier } from './providers/llm-provider.types.js'

const PIN_KEY = (tier: LlmTier): string => `hc:llm:pin:${tier}`
const USAGE_PLAN_KEY = 'hc:llm:usage-plan'
const PREFER_FREE_KEY = 'hc:llm:prefer-free'
const ALLOW_PEERS_KEY = 'hc:llm:allow-peers'

export const TIERS: readonly LlmTier[] = ['deep', 'balanced', 'fast']

export type UsagePlanId = 'intelligence' | 'balanced' | 'fast' | 'private' | 'economy'

export const USAGE_PLANS: readonly {
  readonly id: UsagePlanId
  readonly label: string
  readonly description: string
}[] = [
  { id: 'intelligence', label: 'Intelligence first', description: 'Best capable, healthy model; cost breaks late ties.' },
  { id: 'balanced', label: 'Balanced', description: 'Balances exact fit, headroom, latency and incremental cost.' },
  { id: 'fast', label: 'Fast response', description: 'Prefers low-latency local execution among capable models.' },
  { id: 'private', label: 'Private / local', description: 'Keeps work on participant-controlled infrastructure when possible.' },
  { id: 'economy', label: 'Economy', description: 'Prefers no-incremental-cost providers when the participant chooses it.' },
]

const isUsagePlan = (value: string): value is UsagePlanId =>
  USAGE_PLANS.some(plan => plan.id === value)

/** What a piece of work needs. Never who should do it. */
export type ModelNeed = {
  /** How heavy the job is. Omitted = balanced. */
  readonly tier?: LlmTier
  /** Only a tier that can walk the participant's tree will do. */
  readonly readsHive?: boolean
  /** The caller will consume deltas; a provider that cannot stream is worse. */
  readonly streaming?: boolean
}

/**
 * What a provider costs the participant to use, in the only currency that
 * changes the decision: whose money, and whose eyes.
 */
export type CostClass =
  /** This machine. No bill, nothing leaves. */
  | 'local'
  /** Another participant's machine. No bill; they can read the prompt. */
  | 'peer'
  /** A CLI's own account. A bill, but one the participant already signed. */
  | 'bridge'
  /** A key in this browser. Billed per call. */
  | 'keyed'

export const costOf = (provider: LlmProviderDescriptor): CostClass => {
  if (provider.transport === 'peer-swarm') return 'peer'
  if (provider.transport === 'agent-bridge') return 'bridge'
  return provider.requiresKey === false ? 'local' : 'keyed'
}

/** Cheapest-first order when the participant prefers free. */
const FREE_FIRST: readonly CostClass[] = ['local', 'bridge', 'peer', 'keyed']
/** Otherwise: whatever they have paid for, then the free tiers. */
const CAPABLE_FIRST: readonly CostClass[] = ['keyed', 'bridge', 'local', 'peer']

const readFlag = (key: string, fallback: boolean): boolean => {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw === null || raw === undefined || raw === '') return fallback
    return /^(1|true|yes|on)$/i.test(raw)
  } catch { return fallback }
}

const writeFlag = (key: string, value: boolean): void => {
  try { globalThis.localStorage?.setItem(key, value ? 'true' : 'false') } catch { /* session-only */ }
}

/**
 * The participant's standing instructions. Device-local, `change` on every
 * move so the console and anything else can just listen.
 */
export class LlmPolicyStore extends EventTarget {

  /** The provider pinned to a tier, or '' when the policy decides. */
  pin(tier: LlmTier): string {
    try { return (globalThis.localStorage?.getItem(PIN_KEY(tier)) ?? '').trim().toLowerCase() }
    catch { return '' }
  }

  /** Pin a tier to one provider, or clear it with ''. */
  setPin(tier: LlmTier, providerId: string): void {
    const id = String(providerId ?? '').trim().toLowerCase()
    try {
      if (id) globalThis.localStorage?.setItem(PIN_KEY(tier), id)
      else globalThis.localStorage?.removeItem(PIN_KEY(tier))
    } catch { /* session-only */ }
    this.dispatchEvent(new Event('change'))
  }

  /** How automatic routing behaves. Intelligence first is the clean default.
   *  An explicitly stored legacy prefer-free choice migrates to Economy. */
  get usagePlan(): UsagePlanId {
    try {
      const stored = (globalThis.localStorage?.getItem(USAGE_PLAN_KEY) ?? '').trim().toLowerCase()
      if (isUsagePlan(stored)) return stored
      const legacy = globalThis.localStorage?.getItem(PREFER_FREE_KEY)
      if (legacy !== null && legacy !== undefined && legacy !== '') {
        return /^(1|true|yes|on)$/i.test(legacy) ? 'economy' : 'intelligence'
      }
    } catch { /* session-only */ }
    return 'intelligence'
  }
  set usagePlan(value: UsagePlanId) {
    const plan = isUsagePlan(value) ? value : 'intelligence'
    try {
      globalThis.localStorage?.setItem(USAGE_PLAN_KEY, plan)
      globalThis.localStorage?.removeItem(PREFER_FREE_KEY)
    } catch { /* session-only */ }
    this.dispatchEvent(new Event('change'))
  }

  /** Compatibility seam for older callers; new UI uses `usagePlan`. */
  get preferFree(): boolean { return this.usagePlan === 'economy' }
  set preferFree(value: boolean) { this.usagePlan = value ? 'economy' : 'intelligence' }

  /** May an AUTOMATIC pick send the prompt to another participant's machine?
   *  Default OFF — see the module comment. */
  get allowPeers(): boolean { return readFlag(ALLOW_PEERS_KEY, false) }
  set allowPeers(value: boolean) { writeFlag(ALLOW_PEERS_KEY, value); this.dispatchEvent(new Event('change')) }

  /** WHO ANSWERS WORK OF THIS SHAPE — the standing instructions applied, over
   *  IoC. The web shell may never import a module, and the chat window has to
   *  be able to say who is about to answer without asking the participant to
   *  choose; this method is that seam. See `designate` below. */
  designate(need: ModelNeed = {}): Designation | undefined { return designate(need) }
}

export const llmPolicy = new LlmPolicyStore()
window.ioc?.register?.('@diamondcoreprocessor.com/LlmPolicyStore', llmPolicy)

// ── selection ─────────────────────────────────────────────────────────────

/** Subscription availability reported by the provider. Unknown stays usable:
 *  absence of telemetry is not proof of exhaustion. */
export const availabilityOf = (provider: LlmProviderDescriptor): 'available' | 'limited' | 'exhausted' | 'unknown' =>
  provider.subscription?.status ?? 'unknown'

/** Usable right now: switched on, authenticated, and not known exhausted. */
const isReady = (provider: LlmProviderDescriptor): boolean =>
  llmActivation.isEnabled(provider.id)
  && (provider.requiresKey === false || llmKeyStore.has(provider.id))
  && availabilityOf(provider) !== 'exhausted'

/** Does this provider offer the tier the work asked for? A provider with no
 *  model at that weight can still answer — its default just is not what was
 *  asked for — so this ranks rather than excludes. */
const hasTier = (provider: LlmProviderDescriptor, tier: LlmTier): boolean =>
  provider.models.some(m => m.tier === tier)

/** Hard requirements. Failing one of these means "cannot do this work". */
const canDo = (provider: LlmProviderDescriptor, need: ModelNeed): boolean => {
  if (need.readsHive && !provider.readsHive) return false
  // A bridge answers asks, not calls: it is only a candidate for work that
  // actually wants the hive-reading tier.
  if (!need.readsHive && provider.transport === 'agent-bridge') return false
  if (need.streaming && provider.transport === 'peer-swarm') return false
  return true
}

/** Everything that could answer this need, before preference is applied. */
export const candidatesFor = (need: ModelNeed = {}): LlmProviderDescriptor[] =>
  llmProviderRegistry().all().filter(p => isReady(p) && canDo(p, need))

/**
 * WHO SHOULD ANSWER. Returns undefined when nothing can — the caller decides
 * whether that is an error or a quiet skip.
 *
 * Order of authority, highest first:
 *   1. the participant's PIN for this tier, if it can do the work
 *   2. the selected usage plan (intelligence-first by default)
 *   3. exact tier/capability fit, live availability, locality and cost in the
 *      order declared by that plan
 *   4. peers excluded from an automatic pick unless explicitly allowed
 *   5. registration order — stable, so the same hive picks the same provider
 */
/**
 * Every eligible provider in the order the policy would try it.
 *
 * Keeping the ordered roster public is the small but important distinction
 * between a selector and a router: the first entry is the normal answer, and
 * the rest are an already-authorized fallback plan. Hard requirements remain
 * filters; soft preferences remain ordering signals.
 */
export const rankProviders = (need: ModelNeed = {}): LlmProviderDescriptor[] => {
  const tier = need.tier ?? 'balanced'
  const candidates = candidatesFor(need)
  if (!candidates.length) return []

  const pinned = llmPolicy.pin(tier)
  const plan = llmPolicy.usagePlan
  const allowed = llmPolicy.allowPeers ? candidates : candidates.filter(p => costOf(p) !== 'peer')
  const pool = allowed.length ? allowed : candidates.filter(p => costOf(p) !== 'peer')
  if (!pool.length) return []

  const position = <T,>(order: readonly T[], value: T): number => {
    const index = order.indexOf(value)
    return index < 0 ? order.length : index
  }
  const rank = (p: LlmProviderDescriptor): readonly number[] => {
    const exactTier = hasTier(p, tier) ? 0 : 1
    const availability = availabilityOf(p) === 'available' ? 0
      : availabilityOf(p) === 'unknown' ? 1
      : 2
    const capableCost = position(CAPABLE_FIRST, costOf(p))
    const freeCost = position(FREE_FIRST, costOf(p))
    const localFirst = position<CostClass>(['local', 'keyed', 'bridge', 'peer'], costOf(p))
    const privateFirst = position<CostClass>(['local', 'bridge', 'keyed', 'peer'], costOf(p))

    if (plan === 'economy') return [freeCost, exactTier, availability]
    if (plan === 'fast') return [exactTier, localFirst, availability, capableCost]
    if (plan === 'private') return [exactTier, privateFirst, availability, capableCost]
    if (plan === 'balanced') return [exactTier, availability, localFirst, capableCost]
    return [exactTier, availability, capableCost]
  }

  const compareRank = (left: readonly number[], right: readonly number[]): number => {
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index++) {
      const delta = (left[index] ?? 0) - (right[index] ?? 0)
      if (delta) return delta
    }
    return 0
  }

  // Stable sort: registration order is the final tie-break, and a usable pin
  // is authority rather than merely another score. A pin that cannot do this
  // work is absent from `pool` and therefore falls through naturally.
  return pool
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => {
      if (pinned) {
        if (a.provider.id === pinned) return -1
        if (b.provider.id === pinned) return 1
      }
      return compareRank(rank(a.provider), rank(b.provider)) || a.index - b.index
    })
    .map(entry => entry.provider)
}

export const chooseProvider = (need: ModelNeed = {}): LlmProviderDescriptor | undefined =>
  rankProviders(need)[0]

/** The wire model id this provider should use for the tier asked for — the
 *  other half of a choice: picking Claude for `fast` work should mean Haiku,
 *  not whatever its default happens to be. */
export const modelForTier = (provider: LlmProviderDescriptor, tier: LlmTier = 'balanced'): string =>
  provider.models.find(m => m.tier === tier)?.id ?? provider.defaultModel

/** One line explaining a choice, for a surface that wants to show its work. */
export const explainChoice = (need: ModelNeed = {}): string => {
  const tier = need.tier ?? 'balanced'
  const chosen = chooseProvider(need)
  if (!chosen) return 'nothing available can do this'
  if (llmPolicy.pin(tier) === chosen.id) return `${chosen.label} — pinned for ${tier} work`
  const plan = USAGE_PLANS.find(entry => entry.id === llmPolicy.usagePlan)?.label ?? 'Intelligence first'
  const availability = availabilityOf(chosen)
  const headroom = chosen.subscription?.windows.length
    ? `; ${Math.round(Math.min(...chosen.subscription.windows.map(w => w.remainingPercent)))}% minimum headroom`
    : availability === 'unknown' ? '; limits not reported' : ''
  const cost = costOf(chosen)
  const why = cost === 'local' ? 'runs on this machine'
    : cost === 'peer' ? 'offered by another participant'
    : cost === 'bridge' ? 'a bridged session, which can read the hive'
    : 'the key you configured'
  return `${chosen.label} — ${why}; ${plan}${headroom}`
}

// ── designation ───────────────────────────────────────────────────────────

/**
 * WHO WAS DESIGNATED, in the words every other surface brands with.
 *
 * `chooseProvider` answers "which provider"; a bee needs more than that. A
 * model bee's whole look is read off ONE STRING — vendor family from the
 * name, tier shade from the name (presentation/avatars/agent-model.ts) — so
 * whatever a surface hands the registry decides the colour flying over the
 * hive. Handing it the participant's composer word was fine while there WAS a
 * composer word; with the policy choosing, the honest string is the wire model
 * id, which is exactly what the providers console already draws its dot from.
 * One designation, one string, and the dot in the console and the bee over the
 * tile cannot disagree.
 *
 * `model` doubles as the bridge's ask hint: `agent-roster.cjs` resolves a hint
 * by model NAME first and wire ID second, so the id routes to the same CLI the
 * alias would have.
 */
export type Designation = {
  readonly providerId: string
  /** What a participant calls the provider — "Claude Code", "Codex". */
  readonly label: string
  /** Colour family. Always a vendor agent-model.ts knows by name. */
  readonly vendor: string
  /** The level of thinking this designation is for — DECLARED by the model
   *  where it declares one, not guessed back off its name. */
  readonly tier: LlmTier
  /** The wire model id: the ask hint AND the string a bee is branded from. */
  readonly model: string
  /** The alias word, where the provider gave the model one (`opus`). */
  readonly name: string
  /** What the provider last reported about its own headroom. `unknown` is
   *  usable — absence of telemetry is not proof of exhaustion. */
  readonly availability: 'available' | 'limited' | 'exhausted' | 'unknown'
}

/** Heaviest first — the order a designation steps DOWN through. */
const TIER_LADDER: readonly LlmTier[] = ['deep', 'balanced', 'fast']

/**
 * UNDER LOAD, STEP DOWN RATHER THAN OUT.
 *
 * `chooseProvider` already drops a provider that reports itself EXHAUSTED. The
 * interesting state is the one before it: headroom nearly spent (`limited`),
 * where the provider can still answer but the heaviest model is the worst
 * thing to spend the remainder on. Changing vendor there is a bigger surprise
 * than changing weight — the account, the hive access and the voice all stay
 * put if the same provider answers one tier lighter.
 *
 * Nothing about this is silent: the designation carries the tier it landed on
 * and the chat window reports it, so "balanced" where "deep" was expected is
 * visible before the question leaves rather than inferred from the answer.
 */
const tierUnderLoad = (provider: LlmProviderDescriptor, tier: LlmTier): LlmTier => {
  if (availabilityOf(provider) !== 'limited') return tier
  for (let step = TIER_LADDER.indexOf(tier) + 1; step < TIER_LADDER.length; step++) {
    if (provider.models.some(m => m.tier === TIER_LADDER[step])) return TIER_LADDER[step]
  }
  return tier
}

/** WHO ANSWERS THIS, named. Undefined when nothing can — the caller decides
 *  whether that is an error or a quiet skip, exactly as with chooseProvider. */
export const designate = (need: ModelNeed = {}): Designation | undefined => {
  const provider = chooseProvider(need)
  if (!provider) return undefined
  const tier = tierUnderLoad(provider, need.tier ?? 'balanced')
  const model = modelForTier(provider, tier)
  const declared = provider.models.find(m => m.id === model)
  return {
    providerId: provider.id,
    label: provider.label,
    vendor: provider.vendor,
    tier: declared?.tier ?? tier,
    model,
    name: declared?.name ?? model,
    availability: availabilityOf(provider),
  }
}

// ── one signal, for surfaces that show who answers ────────────────────────
//
// WHO ANSWERS IS NOT A CONSTANT. A key arrives, a bridge announces itself, a
// provider reports its headroom spent, the participant pins a tier — and the
// answer to "who takes the next question" changes underneath a window that
// already asked. Four EventTargets carry those moves and none of them is
// reachable from the web shell, so they are folded into ONE effect here.
//
// The payload is deliberately empty: a designation depends on the NEED, and
// only the surface knows its own. This says the answer may have changed; each
// listener re-asks with what it wants. EffectBus replays the last value, so a
// window opening after the last change still learns to look.

const announce = (): void => { EffectBus.emit('llm:policy-changed', { at: Date.now() }) }

llmPolicy.addEventListener('change', announce)
llmActivation.addEventListener('change', announce)
llmKeyStore.addEventListener?.('change', announce)
// The registry is resolved through its accessor (it may not be in the shell's
// map yet at import time) and is the one that carries subscription refreshes.
try { llmProviderRegistry().addEventListener('change', announce) } catch { /* no registry yet */ }
announce()

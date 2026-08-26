// diamondcoreprocessor.com/assistant/model-policy.ts
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
// for me", plus two standing preferences that decide what "decide for me"
// means. Nothing here is content — it is device-local truth, like the keys
// and the activation switches it sits beside.
//
// ── two defaults that are not neutral, and should not be ──────────────────
//
// PREFER FREE is ON. Between a model that costs nothing and one that bills
// the participant, the free one should answer unless they said otherwise —
// the alternative is a system that quietly spends money for convenience.
//
// ALLOW PEERS is OFF. A peer's model is free, but the prompt travels to
// another person's machine and they can read it. That is a fine trade when
// the participant chooses it and an ugly surprise when a routine chooses it
// for them, so an automatic pick never lands on a peer. Naming or pinning one
// still works — the participant deciding is the whole point.

import { llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import type { LlmProviderDescriptor, LlmTier } from './providers/llm-provider.types.js'

const PIN_KEY = (tier: LlmTier): string => `hc:llm:pin:${tier}`
const PREFER_FREE_KEY = 'hc:llm:prefer-free'
const ALLOW_PEERS_KEY = 'hc:llm:allow-peers'

export const TIERS: readonly LlmTier[] = ['deep', 'balanced', 'fast']

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

  /** Spend nothing when something free can do the job. Default ON. */
  get preferFree(): boolean { return readFlag(PREFER_FREE_KEY, true) }
  set preferFree(value: boolean) { writeFlag(PREFER_FREE_KEY, value); this.dispatchEvent(new Event('change')) }

  /** May an AUTOMATIC pick send the prompt to another participant's machine?
   *  Default OFF — see the module comment. */
  get allowPeers(): boolean { return readFlag(ALLOW_PEERS_KEY, false) }
  set allowPeers(value: boolean) { writeFlag(ALLOW_PEERS_KEY, value); this.dispatchEvent(new Event('change')) }
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
 *   2. live availability (healthy headroom before unknown, preserve providers
 *      already below 20%; exhausted providers are excluded)
 *   3. cost preference (free-first by default), with peers excluded from an
 *      automatic pick unless they allowed it
 *   4. a provider that actually offers a model at the tier asked for
 *   5. registration order — stable, so the same hive picks the same provider
 */
export const chooseProvider = (need: ModelNeed = {}): LlmProviderDescriptor | undefined => {
  const tier = need.tier ?? 'balanced'
  const candidates = candidatesFor(need)
  if (!candidates.length) return undefined

  const pinned = llmPolicy.pin(tier)
  if (pinned) {
    const hit = candidates.find(p => p.id === pinned)
    // A pin that cannot do THIS work (no key any more, wrong tier entirely)
    // falls through rather than failing the call: the participant pinned a
    // preference, not a veto.
    if (hit) return hit
  }

  const order = llmPolicy.preferFree ? FREE_FIRST : CAPABLE_FIRST
  const allowed = llmPolicy.allowPeers ? candidates : candidates.filter(p => costOf(p) !== 'peer')
  const pool = allowed.length ? allowed : candidates.filter(p => costOf(p) !== 'peer')
  if (!pool.length) return undefined

  const rank = (p: LlmProviderDescriptor): number => {
    const cost = order.indexOf(costOf(p))
    const availability = availabilityOf(p) === 'available' ? 0
      : availabilityOf(p) === 'unknown' ? 1
      : 2
    // Tier match is worth more than one cost step but less than the whole
    // ladder: a free model at the right weight beats a paid one, and a paid
    // model at the right weight beats a free one at the wrong weight.
    return availability * 100 + (cost < 0 ? order.length : cost) * 2 + (hasTier(p, tier) ? 0 : 1)
  }

  let best = pool[0]
  let bestRank = rank(best)
  for (const provider of pool.slice(1)) {
    const value = rank(provider)
    if (value < bestRank) { best = provider; bestRank = value }
  }
  return best
}

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
  const availability = availabilityOf(chosen)
  const headroom = chosen.subscription?.windows.length
    ? `; ${Math.round(Math.min(...chosen.subscription.windows.map(w => w.remainingPercent)))}% minimum headroom`
    : availability === 'unknown' ? '; limits not reported' : ''
  const cost = costOf(chosen)
  const why = cost === 'local' ? 'runs on this machine'
    : cost === 'peer' ? 'offered by another participant'
    : cost === 'bridge' ? 'a bridged session, which can read the hive'
    : 'the key you configured'
  return `${chosen.label} — ${why}${headroom}`
}

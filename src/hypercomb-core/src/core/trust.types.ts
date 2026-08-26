// trust.types.ts — the activation trust gate's module↔shell contract.
//
// Adoption (downloading signature-verified bytes) is always safe; ACTIVATION
// (letting code execute) is what carries risk. The implementation lives in
// essentials (sharing/trust-service.ts) and registers under
// TRUST_SERVICE_KEY; the trust-prompt chrome hears check requests on
// EffectBus ('trust:check') and answers through the request's callback.

export const TRUST_SERVICE_KEY = '@hypercomb.social/TrustService'

/** EffectBus effect carrying a TrustCheckRequest (emitted transiently). */
export const TRUST_CHECK = 'trust:check'

export type TrustDecision = {
  allow: boolean
  addToCommunity: boolean
}

export type TrustCheckRequest = {
  domains: string[]
  onResult: (decision: TrustDecision) => void
}

export interface TrustProvider {
  getCommunity(): Set<string>
  addToCommunity(domain: string): void
  /** Prompt (or short-circuit for community domains) and resolve with the
   *  operator's decision. */
  check(domains: string[]): Promise<TrustDecision>
}

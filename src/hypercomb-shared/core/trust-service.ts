// hypercomb-shared/core/trust-service.ts
//
// Trust gate for activating adopted code. The doctrine:
//
//   - Adoption = downloading bytes. Always safe (signature-verified content
//     in a flat sig-addressed bucket; no code runs by virtue of being on
//     disk).
//   - Activation = letting code execute. This is what carries risk, because
//     a bee that registers in IoC has full access to the participant's tree.
//
// The trust gate fires at the activation step, not at adoption. When a
// participant attempts to enable an item whose source domain isn't in their
// trusted community (`hc:community:domains`), the UI prompts them. Three
// outcomes:
//
//   - 'allow-once'    — code runs this session; not added to community
//   - 'allow-always'  — domain added to community; code runs every session
//   - 'deny'          — enable is rejected; code stays inert
//
// Community-trusted domains skip the prompt entirely — the operator has
// already vouched for them.

import { EffectBus } from '@hypercomb/core'

const COMMUNITY_KEY = 'hc:community:domains'

export type TrustDecision = {
  allow: boolean
  addToCommunity: boolean
}

export type TrustCheckRequest = {
  domains: string[]
  onResult: (decision: TrustDecision) => void
}

export class TrustService extends EventTarget {

  /** Read the operator's trusted-community domain list (JSON array in
   *  localStorage). Returns a Set of normalized hosts. */
  public readonly getCommunity = (): Set<string> => {
    try {
      const raw = String(localStorage.getItem(COMMUNITY_KEY) ?? '').trim()
      if (!raw) return new Set<string>()
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return new Set<string>()
      const out = new Set<string>()
      for (const entry of parsed) {
        const h = this.#normalize(String(entry ?? ''))
        if (h) out.add(h)
      }
      return out
    } catch { return new Set<string>() }
  }

  /** Append a domain to the community list. No-op if already present.
   *  Triggers a 'change' event for any reactive UI watching the list. */
  public readonly addToCommunity = (domain: string): void => {
    const host = this.#normalize(domain)
    if (!host) return
    const current = this.getCommunity()
    if (current.has(host)) return
    current.add(host)
    try {
      localStorage.setItem(COMMUNITY_KEY, JSON.stringify([...current]))
      this.dispatchEvent(new Event('change'))
    } catch { /* private mode — caller may still proceed in-session */ }
  }

  /** Returns true iff at least one of the supplied domains is in the
   *  operator's trusted community. Empty domains list returns false —
   *  there's no implicit trust. */
  public readonly isCommunityTrusted = (domains: string[]): boolean => {
    if (!Array.isArray(domains) || domains.length === 0) return false
    const community = this.getCommunity()
    for (const d of domains) {
      const h = this.#normalize(String(d ?? ''))
      if (h && community.has(h)) return true
    }
    return false
  }

  /** Check whether the participant is willing to let code from these
   *  domains execute. Resolves immediately to allow:true if any domain
   *  is in the trusted community. Otherwise emits 'trust:check' on the
   *  EffectBus and waits for the prompt UI to call onResult.
   *
   *  The session-local trust set lives in #sessionTrusted — a Set the
   *  caller can pass-through on 'allow-once' so subsequent checks for
   *  the same domain in the same session don't re-prompt. */
  public readonly check = async (domains: string[]): Promise<TrustDecision> => {
    if (this.isCommunityTrusted(domains)) {
      return { allow: true, addToCommunity: false }
    }
    // Session-local fast path: domain was 'allow-once'd earlier this session
    for (const d of domains) {
      const h = this.#normalize(String(d ?? ''))
      if (h && this.#sessionTrusted.has(h)) {
        return { allow: true, addToCommunity: false }
      }
    }
    return new Promise<TrustDecision>((resolve) => {
      const onResult = (decision: TrustDecision): void => {
        if (decision.allow && !decision.addToCommunity) {
          // Remember the allow-once choice so we don't nag again this session
          for (const d of domains) {
            const h = this.#normalize(String(d ?? ''))
            if (h) this.#sessionTrusted.add(h)
          }
        }
        if (decision.allow && decision.addToCommunity) {
          // Persist the trust for future sessions
          for (const d of domains) this.addToCommunity(d)
        }
        resolve(decision)
      }
      EffectBus.emit<TrustCheckRequest>('trust:check', { domains, onResult })
    })
  }

  #sessionTrusted = new Set<string>()

  #normalize = (raw: string): string => {
    return String(raw ?? '')
      .trim()
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  }
}

register('@hypercomb.social/TrustService', new TrustService())

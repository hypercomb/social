// diamondcoreprocessor.com/sharing/feature-availability.ts
//
// The READ side of the feature-verification gate (essentials).
//
// A heavy visual-bee feature (a website, a game, a dashboard) that did NOT
// originate with this participant must not ACTIVATE — render, run its scripts,
// pull its resources — until it is VERIFIED. Verification is one of:
//   • published by a TRUSTED domain (community-vetted, or your own self host),
//   • reviewed-and-accepted by you (or BYPASSED) — recorded as a verified sig,
// Anything else is "foreign + unverified" → gated (the caller shows a review
// prompt and pulls nothing).
//
// Participant-local, localStorage only — never in any lineage, same principle
// as viewport / clipboard / adopted-roots / feature-staging. This module is the
// gate's READER; the WRITER (review → accept / bypass) lives shell-side in
// `hypercomb-shared/ui/features-viewer/feature-verified.ts`. The two never
// import each other — they agree ONLY on the `hc:feature-verified` key + shape,
// exactly as portal-overlay reads the shared `hc:feature-staging` key.

import { isWithinAdoptedRoot } from './adopted-roots.js'

const VERIFIED_KEY = 'hc:feature-verified'
const COMMUNITY_KEY = 'hc:community:domains'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'
const SIG_RE = /^[a-f0-9]{64}$/

/** Strip scheme + trailing slash so a host compares equal however it was
 *  written (`https://jwize.com/` === `jwize.com`). */
const normHost = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** The verified-sig set, parsed from `hc:feature-verified`. The shared writer
 *  stores entries (`{ key, sig?, cell, kind, bypassed }`, mirroring staging);
 *  the gate cares only about the resolvable `sig`s. Tolerates a bare-string
 *  array too, so the format can simplify later without breaking the reader. */
export function verifiedSigs(): Set<string> {
  const out = new Set<string>()
  try {
    const arr = JSON.parse(localStorage.getItem(VERIFIED_KEY) ?? '[]')
    if (Array.isArray(arr)) {
      for (const e of arr) {
        const s = String((e && typeof e === 'object' ? (e as { sig?: unknown }).sig : e) ?? '').trim().toLowerCase()
        if (SIG_RE.test(s)) out.add(s)
      }
    }
  } catch { /* malformed / no storage — nothing verified */ }
  return out
}

export function isVerifiedSig(sig: unknown): boolean {
  const s = String(sig ?? '').trim().toLowerCase()
  return SIG_RE.test(s) && verifiedSigs().has(s)
}

function selfDomain(): string {
  try { return normHost(localStorage.getItem(SELF_DOMAIN_KEY)) } catch { return '' }
}

function communityDomains(): Set<string> {
  const out = new Set<string>()
  try {
    const arr = JSON.parse(localStorage.getItem(COMMUNITY_KEY) ?? '[]')
    if (Array.isArray(arr)) for (const d of arr) { const n = normHost(d); if (n) out.add(n) }
  } catch { /* malformed — none trusted */ }
  return out
}

/** A domain is trusted if it's your own self host or in your community list. */
export function isTrustedDomain(domain: unknown): boolean {
  const d = normHost(domain)
  if (!d) return false
  const self = selfDomain()
  return (!!self && d === self) || communityDomains().has(d)
}

/** May this feature activate for a participant who did not author it? True iff
 *  it's verified (reviewed-accepted/bypassed) or from a trusted domain. */
export function isFeatureAvailable(sig: unknown, domain: unknown): boolean {
  return isVerifiedSig(sig) || isTrustedDomain(domain)
}

/** Is this content foreign to the participant — i.e. NOT their own authoring?
 *  Your own work is never gated. Foreign when it carries a publisher domain
 *  that isn't yours, OR (when no domain is attributed) when it sits under an
 *  adopted root. Locally-authored content (no foreign domain, not adopted) is
 *  not foreign → never gated. */
export function isForeignContent(segments: readonly string[], domain: unknown): boolean {
  const d = normHost(domain)
  if (d) return d !== selfDomain()
  return isWithinAdoptedRoot(segments)
}

/** The composite the activation gate calls: a feature must be REVIEWED before
 *  it runs iff it's foreign AND not yet available. */
export function featureNeedsReview(segments: readonly string[], sig: unknown, domain: unknown): boolean {
  return isForeignContent(segments, domain) && !isFeatureAvailable(sig, domain)
}

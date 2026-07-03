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

import { isAuthored } from './authored-sigs.js'
import { isWithinAdoptedRoot } from './adopted-roots.js'

const VERIFIED_KEY = 'hc:feature-verified'
const ALLOWED_ROOTS_KEY = 'hc:allowed-roots'
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

/** Is this page/feature signature one the participant AUTHORED locally? The
 *  per-signature "own content" signal for the gate's planned fail-closed rule
 *  (see authored-sigs.ts). NOT yet consulted by `featureNeedsReview` — the
 *  allow-set is empty until the authoring write-sites + one-time bootstrap land,
 *  so requiring it now would gate every existing page. Exposed so that wiring
 *  can build on a stable reader. */
export function isLocallyAuthored(sig: unknown): boolean {
  return isAuthored(sig)
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

/** BRANCH-scoped allow — a website (or any branch feature) is adopted as ONE
 *  operation covering every page beneath its root. When the participant allows
 *  the feature, the shell writer (feature-verified.ts `markAllowedRoot`)
 *  records the site's root PATH at `hc:allowed-roots`; every location under
 *  that prefix passes the gate. This is what keeps an adopted site working
 *  across reloads: per-SIG verification only covered the one page that was
 *  allowed, and per-sig domain attributions are in-memory — after a refresh
 *  every child page re-gated individually and the site read as broken.
 *  Participant-local, path-keyed — the same shape as `hc:adopted-roots`. */
export function isWithinAllowedRoot(segments: readonly string[]): boolean {
  if (segments.length === 0) return false
  try {
    const parsed = JSON.parse(localStorage.getItem(ALLOWED_ROOTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return false
    const segs = segments.map(s => String(s ?? ''))
    return parsed.some((root: unknown) =>
      Array.isArray(root)
      && root.length > 0
      && root.length <= segs.length
      && root.every((r, i) => String(r ?? '') === segs[i]))
  } catch {
    return false
  }
}

/** Is this content foreign to the participant — i.e. from somewhere ELSE, not
 *  authored here? Foreign when it carries a publisher domain that isn't yours
 *  (mesh/host attribution), OR — when no domain is attributed — when it sits
 *  under an adopted root (content folded in from a peer).
 *
 *  This tree-position signal previously OVER-gated on its own: a page the
 *  participant AUTHORED beneath a branch they'd once adopted is
 *  `isWithinAdoptedRoot` yet is their own work, so it wrongly showed the review
 *  gate. That false positive is resolved NOT by weakening foreignness but by the
 *  per-signature authored allow-set consulted in `featureNeedsReview` (see
 *  `isLocallyAuthored` / authored-sigs.ts): your own page under an adopted root
 *  is foreign-by-position but authored-by-you, so it is never gated. Foreignness
 *  stays honest, so a domainless adopted PEER page (not authored, not verified)
 *  correctly gates — this is the per-sig adopted tracking the prior removal
 *  deferred to "later". */
export function isForeignContent(segments: readonly string[], domain: unknown): boolean {
  const d = normHost(domain)
  if (d && d !== selfDomain()) return true
  // A matching (or absent) domain is NOT proof of your own authoring. The
  // runtime seeds hc:nostrmesh:self-domain from the DEPLOYMENT ORIGIN, so on a
  // shared origin every participant carries the SAME self-domain and a peer's
  // adopted page arrives attributed to "your" domain — comparing domains alone
  // ran foreign code ungated. Tree position stays authoritative: content under
  // an adopted root is foreign regardless of the domain label; your own pages
  // there are rescued per-signature by isLocallyAuthored in featureNeedsReview.
  return isWithinAdoptedRoot(segments)
}

/** The composite the activation gate calls: a feature must be REVIEWED before it
 *  runs iff it is FOREIGN (from a peer / another domain — see isForeignContent)
 *  AND not already trusted — that is, NOT authored by you, NOT reviewed-and-
 *  accepted or bypassed, and NOT from a trusted domain. Fail-closed: a foreign
 *  page matching none of those stays gated (no mount, no scripts, no fetch) until
 *  reviewed. `isLocallyAuthored` is the escape hatch that keeps your OWN pages —
 *  even ones sitting under an adopted root — from being quarantined. */
export function featureNeedsReview(segments: readonly string[], sig: unknown, domain: unknown): boolean {
  return isForeignContent(segments, domain)
    && !isLocallyAuthored(sig)
    && !isFeatureAvailable(sig, domain)
    && !isWithinAllowedRoot(segments)
}

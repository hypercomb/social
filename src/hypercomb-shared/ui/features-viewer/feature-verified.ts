// hypercomb-shared/ui/features-viewer/feature-verified.ts
//
// The WRITE side of the feature-verification gate (shell UI).
//
// When the participant reviews a foreign feature's code and ACCEPTS it (or
// BYPASSES the review as an explicit override), its resource signature is
// recorded here. The READER — essentials `feature-availability.ts` — checks the
// same `hc:feature-verified` key at render time and lets the feature activate.
// The two never import each other; they agree ONLY on this key + shape, exactly
// as portal-overlay reads the shell-written `hc:feature-staging` key.
//
// Participant-local, localStorage only — never in any lineage. "Which features
// have I personally vetted" is local trust state, like adopted-roots, viewport,
// and feature-staging.

const STORAGE_KEY = 'hc:feature-verified'
const SIG_RE = /^[a-f0-9]{64}$/

export interface VerifiedFeature {
  /** The page/feature resource sig the gate checks (e.g. a website's htmlSig). */
  sig: string
  cell: string
  kind: string
  label: string
  /** True = enabled WITHOUT reading the code (explicit risk-accepted override). */
  bypassed: boolean
}

export function loadVerified(): VerifiedFeature[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr
      .filter((e: unknown): e is VerifiedFeature =>
        !!e && typeof e === 'object' && SIG_RE.test(String((e as VerifiedFeature).sig ?? '').toLowerCase()))
      .map((e: VerifiedFeature) => ({
        sig: String(e.sig).toLowerCase(),
        cell: typeof e.cell === 'string' ? e.cell : '',
        kind: typeof e.kind === 'string' ? e.kind : '',
        label: typeof e.label === 'string' ? e.label : '',
        bypassed: !!e.bypassed,
      }))
  } catch {
    return []
  }
}

function save(list: VerifiedFeature[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch { /* quota / no storage — degrades to in-session */ }
}

export function isVerified(sig: string): boolean {
  const s = String(sig ?? '').trim().toLowerCase()
  return SIG_RE.test(s) && loadVerified().some(e => e.sig === s)
}

/** Record a feature as verified (reviewed-and-accepted, or bypassed). Idempotent
 *  by sig — re-accepting replaces the prior entry (so a later bypass→review
 *  upgrade is reflected). */
export function markVerified(feature: VerifiedFeature): void {
  const s = String(feature.sig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return
  const list = loadVerified().filter(e => e.sig !== s)
  list.push({
    sig: s,
    cell: feature.cell ?? '',
    kind: feature.kind ?? '',
    label: feature.label ?? '',
    bypassed: !!feature.bypassed,
  })
  save(list)
}

export function unmarkVerified(sig: string): void {
  const s = String(sig ?? '').trim().toLowerCase()
  save(loadVerified().filter(e => e.sig !== s))
}

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

// ── branch-scoped allow (`hc:allowed-roots`) ─────────────────────────────
// A website is a BRANCH feature: adopting/allowing it covers every page under
// its root as ONE operation. Allowing only the root page's SIG left every
// child page individually gated — and since per-sig domain attributions are
// in-memory, an adopted site that navigated fine in-session re-gated page by
// page after a refresh ("the site disappeared"). The reader — essentials
// `feature-availability.ts` `isWithinAllowedRoot` — checks this same key at
// gate time; the two agree ONLY on key + shape (a JSON array of segment-path
// arrays, the same shape as `hc:adopted-roots`), never importing each other.

const ALLOWED_ROOTS_KEY = 'hc:allowed-roots'

const loadAllowedRoots = (): string[][] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALLOWED_ROOTS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(Array.isArray) : []
  } catch {
    return []
  }
}

/** Allow a whole BRANCH: every location at or under `segments` passes the
 *  verification gate. Idempotent by path. */
export function markAllowedRoot(segments: readonly string[]): void {
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) return
  const roots = loadAllowedRoots()
  const key = segs.join(' ')
  if (roots.some(r => r.join(' ') === key)) return
  roots.push(segs)
  try { localStorage.setItem(ALLOWED_ROOTS_KEY, JSON.stringify(roots)) } catch { /* quota — degrades to per-sig */ }
}

export function unmarkAllowedRoot(segments: readonly string[]): void {
  const key = segments.map(s => String(s ?? '').trim()).filter(Boolean).join(' ')
  try {
    localStorage.setItem(ALLOWED_ROOTS_KEY, JSON.stringify(loadAllowedRoots().filter(r => r.join(' ') !== key)))
  } catch { /* no storage — nothing recorded anyway */ }
}

/** The BRANCH root to allow for a location: the ADOPTED root containing it
 *  (`hc:adopted-roots`, written by the fold) — so accepting a site from one of
 *  its CHILD pages still allows the whole site, not just that child's subtree.
 *  Falls back to the location itself when it isn't under an adopted root. */
export function branchRootFor(segments: readonly string[]): string[] {
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  try {
    const parsed = JSON.parse(localStorage.getItem('hc:adopted-roots') ?? '[]')
    if (Array.isArray(parsed)) {
      for (const root of parsed) {
        if (Array.isArray(root)
            && root.length > 0
            && root.length <= segs.length
            && root.every((r, i) => String(r ?? '') === segs[i])) {
          return root.map(r => String(r ?? ''))
        }
      }
    }
  } catch { /* malformed — fall through */ }
  return segs
}

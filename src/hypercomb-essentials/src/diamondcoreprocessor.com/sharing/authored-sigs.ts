// diamondcoreprocessor.com/sharing/authored-sigs.ts
//
// Participant-local registry of page/feature signatures the participant
// AUTHORED locally — the "own content" allow-set for the verification gate.
//
// Part of the per-signature gate redesign (see feature-availability.ts). The
// gate must fail CLOSED: an adopted page activates only if it is authored-by-
// you, verified (reviewed-and-accepted), or from a trusted domain. Provenance
// is keyed PER SIGNATURE, not by tree position — a page you authored is yours
// even when it sits under a subtree you once adopted, which the removed
// `isWithinAdoptedRoot` path-prefix heuristic could not express (it prefix-
// matched the adopted root AND every descendant, so it quarantined your own
// pages under a branch you'd adopted).
//
// Participant-local, localStorage only — never in any lineage, same principle
// as adopted-roots / viewport / feature-verified / feature-staging.
//
// ── STUB STATUS — read before flipping the gate ───────────────────────────
// The store + read/write below are complete, but TWO producers are still TODO
// before `feature-availability.featureNeedsReview` may treat "not authored" as
// a reason to gate — flipping it now would gate EVERY existing local page:
//   1. RECORD ON WRITE — wherever a page htmlSig is authored locally, call
//      markAuthored(htmlSig): website.queen.ts / the bridge's decoration-add for
//      `visual:website:page`, and the `website`-slot bag-set writer.
//   2. ONE-TIME BOOTSTRAP — walk the participant's existing lineage EXCLUDING
//      adopted roots (use adopted-roots.ts `isWithinAdoptedRoot` as an EXCLUSION
//      filter, not an inclusion gate) and markAuthored every page sig found, so
//      pre-existing pages don't gate when the fail-closed rule lands.
// Until both exist, `isLocallyAuthored` is exposed but NOT consulted by the gate.

const KEY = 'hc:authored-sigs'
const SIG_RE = /^[a-f0-9]{64}$/

function read(): Set<string> {
  const out = new Set<string>()
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (Array.isArray(arr)) {
      for (const s of arr) {
        const v = String(s ?? '').trim().toLowerCase()
        if (SIG_RE.test(v)) out.add(v)
      }
    }
  } catch { /* malformed / no storage — nothing authored */ }
  return out
}

/** Record a page/feature signature as authored by this participant. Idempotent;
 *  non-sig inputs are ignored. */
export function markAuthored(sig: unknown): void {
  const s = String(sig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return
  const set = read()
  if (set.has(s)) return
  set.add(s)
  try { localStorage.setItem(KEY, JSON.stringify([...set])) } catch { /* quota — best effort */ }
}

/** Record several signatures at once (the bootstrap walk's entry point). */
export function markManyAuthored(sigs: Iterable<unknown>): void {
  const set = read()
  let changed = false
  for (const raw of sigs) {
    const s = String(raw ?? '').trim().toLowerCase()
    if (SIG_RE.test(s) && !set.has(s)) { set.add(s); changed = true }
  }
  if (changed) {
    try { localStorage.setItem(KEY, JSON.stringify([...set])) } catch { /* quota — best effort */ }
  }
}

/** Is this signature in the participant's authored allow-set? */
export function isAuthored(sig: unknown): boolean {
  const s = String(sig ?? '').trim().toLowerCase()
  return SIG_RE.test(s) && read().has(s)
}

/** The full authored set (for the future gate reader / diagnostics). */
export function authoredSigs(): Set<string> {
  return read()
}

/** Record the LOCALLY-AUTHORED page signatures a layer write carries. The
 *  `website` and `context` slots hold page/resource sigs DIRECTLY — the two
 *  slots the verification gate resolves a page from (alongside the decoration
 *  path, which records its htmlSig separately). Call this from EVERY local
 *  slot-writer (bridge #update / #bagSet / #bagMutate) so authoring coverage
 *  can't drift: any page you write locally is treated as your own. Marking a
 *  non-page context resource is inert — a sig only ever gates when it IS the
 *  resolved page sig, and a resource you never render as a page is never
 *  checked. */
export function markLayerAuthoredPageSigs(layer: unknown): void {
  if (!layer || typeof layer !== 'object') return
  const l = layer as Record<string, unknown>
  for (const slot of ['website', 'context']) {
    const v = l[slot]
    if (Array.isArray(v)) markManyAuthored(v)
  }
}

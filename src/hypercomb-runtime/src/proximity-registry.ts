// hypercomb-shared/core/proximity-registry.ts
//
// Proximity declaration — the shared half of "everything in proximity gets
// pre-looked." The navigation pattern already warms the CURRENT location's
// subtree on every navigation (Navigation → `navigate` → Lineage `change` →
// the warm handler in runtime-initializer → HistoryService.preloadNeighbourhood).
// But a landing grid shows OTHER roots — its cards are separate root lineages,
// one click from being the active root, and the current-location warm never
// reaches them. Before this registry every such surface hand-rolled its own
// anticipatory warm (or forgot to — collections rendered cold).
//
// This makes the warm ONE pattern instead of many: a surface DECLARES the
// location sigs that are one click from its view, and the single nav-driven
// warm handler folds them into the same per-navigation warm. Add a surface →
// it declares → it inherits warming. Nobody re-implements the walk.
//
// Deliberately dependency-free and IoC-free: a module-level singleton set of
// provider functions, mirroring groupRegistry / iconOverrides. runtime-
// initializer imports collectProximity(); surfaces import
// registerProximityProvider(). It never imports HistoryService — the WORK
// (resolving heads, walking subtrees) stays in the one warm handler; this file
// only gathers WHAT to warm.

/**
 * A provider returns the location SIGS (64-hex lineage signatures) that are one
 * click from the current view — a landing grid's cards, a launcher's members.
 * Async so a surface can resolve names→sigs lazily. Return `[]` whenever the
 * surface isn't showing, so an off-screen surface contributes nothing.
 */
export type ProximityProvider = () => readonly string[] | Promise<readonly string[]>

const providers = new Set<ProximityProvider>()

const SIG = /^[0-9a-f]{64}$/

/**
 * Declare a proximity provider. Call at surface activation (or in the
 * constructor with an open-gate inside the provider) and invoke the returned
 * unregister fn on teardown so a disposed surface stops contributing.
 */
export function registerProximityProvider(fn: ProximityProvider): () => void {
  providers.add(fn)
  return (): void => { providers.delete(fn) }
}

/**
 * The union of every provider's declared sigs — deduped and validated. Never
 * throws: a provider that rejects (or returns junk) simply contributes nothing,
 * because a cold render is correct, just slower.
 */
export async function collectProximity(): Promise<string[]> {
  if (providers.size === 0) return []
  const out = new Set<string>()
  const settled = await Promise.allSettled([...providers].map(async p => p()))
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value) continue
    for (const s of r.value) {
      const sig = String(s ?? '')
      if (SIG.test(sig)) out.add(sig)
    }
  }
  return [...out]
}

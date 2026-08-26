/** A provider declares location signatures one click from the current view. */
export type ProximityProvider = () => readonly string[] | Promise<readonly string[]>

const providers = new Set<ProximityProvider>()
const SIG = /^[0-9a-f]{64}$/

/** Register a read-only proximity declaration and return its cleanup. */
export function registerProximityProvider(fn: ProximityProvider): () => void {
  providers.add(fn)
  return (): void => { providers.delete(fn) }
}

/** Collect every declared signature, validated and deduplicated. */
export async function collectProximity(): Promise<string[]> {
  if (providers.size === 0) return []
  const out = new Set<string>()
  const settled = await Promise.allSettled([...providers].map(async provider => provider()))
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value) continue
    for (const value of result.value) {
      const sig = String(value ?? '')
      if (SIG.test(sig)) out.add(sig)
    }
  }
  return [...out]
}

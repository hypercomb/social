export interface ProjectionCommit<T> {
  owner: string
  currentOwner: string
  prepareOnly: boolean
  source: ReadonlyMap<string, T>
  target: Map<string, T>
  labels: Iterable<string>
  preserveResolvedOnNull?: boolean
}

/**
 * Atomically publishes one async presentation derivation into the live
 * lineage-owned cache. Prepared/off-screen work and work that outlived its
 * lineage are discarded. For image projections, a transient null result must
 * not erase a signature another concurrent pass already resolved. An explicit
 * image removal still works because mutation handlers invalidate the live
 * entry before starting their forced derivation.
 */
export const publishOwnedProjection = <T>({
  owner,
  currentOwner,
  prepareOnly,
  source,
  target,
  labels,
  preserveResolvedOnNull = false,
}: ProjectionCommit<T>): boolean => {
  if (prepareOnly || owner !== currentOwner) return false

  for (const label of labels) {
    if (source.has(label)) {
      const next = source.get(label)!
      if (preserveResolvedOnNull && next === null && target.get(label) != null) continue
      target.set(label, next)
    } else {
      target.delete(label)
    }
  }
  return true
}

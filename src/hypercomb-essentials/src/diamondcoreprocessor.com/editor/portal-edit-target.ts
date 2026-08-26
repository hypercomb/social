// Portal INVENTORY content edits are default-selection edits. The caller only
// supplies a referenceTarget for a record explicitly marked editsRootDefault;
// ordinary reference appearances edit their own pinned details in place.

export interface PortalEditTarget {
  /** Complete location of the content-bearing tile. */
  readonly segments: readonly string[]
  /** Parent location accepted by read/writeTilePropertiesAt. */
  readonly parentSegments: readonly string[]
  /** Stable identity name at that location. */
  readonly cell: string
  /** True when a reference redirected the edit away from its appearance. */
  readonly throughPortal: boolean
}

/** Resolve one content-edit address. `referenceTarget` is the canonical target
 * of an explicitly marked Portal inventory row; null means an ordinary local
 * tile OR lineage activation. Empty legacy targets cannot name an item, so
 * they safely fall back to the appearance instead of redirecting a write onto
 * the hive root. */
export const portalEditTarget = (
  appearanceParent: readonly string[],
  appearanceCell: string,
  referenceTarget: readonly string[] | null,
): PortalEditTarget => {
  const target = (referenceTarget ?? [])
    .map(segment => String(segment ?? '').trim())
    .filter(Boolean)
  const throughPortal = referenceTarget !== null && target.length > 0
  const segments = throughPortal
    ? target
    : [...appearanceParent.map(segment => String(segment ?? '').trim()).filter(Boolean), appearanceCell]
  const cell = segments[segments.length - 1] ?? appearanceCell
  return {
    segments,
    parentSegments: segments.slice(0, -1),
    cell,
    throughPortal,
  }
}

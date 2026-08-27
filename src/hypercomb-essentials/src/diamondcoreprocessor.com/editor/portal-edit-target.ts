// Portal content edits are default-selection edits. A reference appearance
// keeps its own layout/address, but the details shown in the editor come from
// (and are written back to) the canonical target it names.

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

/** Resolve one content-edit address. `referenceTarget` comes from the
 * decoration index; null means the clicked tile is an ordinary local tile.
 * Empty legacy targets cannot name an item, so they safely fall back to the
 * appearance instead of redirecting a write onto the hive root. */
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

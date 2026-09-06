export interface ImageChoiceWriteTarget {
  readonly parentSegments: readonly string[]
  readonly cell: string
  readonly role: 'root-default' | 'appearance'
}

/**
 * A Portal default-authoring row dresses the TARGET it points at — the tile
 * where the item lives — so the picture seeds every future activation. An
 * ordinary reference gesture dresses only that reference's appearance; its
 * pointer remains its identity and the local detail is the override. No
 * sibling appearance is ever returned.
 *
 * `referenceTarget` is the route of an explicitly marked Portal row, or null
 * for an ordinary tile. It is never `[]` — the hive root is not a target, and
 * an empty legacy route falls back to the appearance rather than redirecting
 * a write onto the root (the same rule `portalEditTarget` keeps).
 */
export const imageChoiceWriteTargets = (
  appearanceParent: readonly string[],
  fixedName: string,
  referenceTarget: readonly string[] | null,
): readonly ImageChoiceWriteTarget[] => {
  const cell = String(fixedName ?? '').trim()
  if (!cell) return []
  const target = (referenceTarget ?? []).map(segment => String(segment ?? '').trim()).filter(Boolean)
  if (target.length > 0) {
    return [{
      parentSegments: target.slice(0, -1),
      cell: target[target.length - 1]!,
      role: 'root-default',
    }]
  }
  const parent = appearanceParent.map(segment => String(segment ?? '').trim()).filter(Boolean)
  return [{ parentSegments: parent, cell, role: parent.length === 0 ? 'root-default' : 'appearance' }]
}

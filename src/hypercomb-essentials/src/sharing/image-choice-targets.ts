export interface ImageChoiceWriteTarget {
  readonly parentSegments: readonly string[]
  readonly cell: string
  readonly role: 'root-default' | 'appearance'
}

/**
 * A Portal/root gesture establishes the fixed-name root default. An ordinary
 * reference gesture dresses only that reference's appearance; its pointer to
 * the root remains its identity and the local detail is the override. No
 * sibling appearance is ever returned.
 */
export const imageChoiceWriteTargets = (
  appearanceParent: readonly string[],
  fixedName: string,
  editsRootDefault: boolean,
): readonly ImageChoiceWriteTarget[] => {
  const cell = String(fixedName ?? '').trim()
  if (!cell) return []
  const root: ImageChoiceWriteTarget = {
    parentSegments: [], cell, role: 'root-default',
  }
  const parent = appearanceParent.map(segment => String(segment ?? '').trim()).filter(Boolean)
  if (editsRootDefault || parent.length === 0) return [root]
  return [{ parentSegments: parent, cell, role: 'appearance' }]
}

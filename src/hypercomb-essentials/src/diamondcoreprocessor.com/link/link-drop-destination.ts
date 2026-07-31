export type LinkDropDestination =
  | { kind: 'editor' }
  | { kind: 'tile'; label: string }
  | { kind: 'canvas' }

/** Resolve from the release point, never from an unrelated selected tile. */
export function linkDropDestination(
  editorMode: 'idle' | 'editing' | undefined,
  labelAtRelease: string | null,
): LinkDropDestination {
  if (editorMode === 'editing') return { kind: 'editor' }
  if (labelAtRelease) return { kind: 'tile', label: labelAtRelease }
  return { kind: 'canvas' }
}

export type DroppedLinkPersistence = {
  writeProperties(
    parentSegments: readonly string[],
    cell: string,
    updates: Record<string, unknown>,
  ): Promise<void>
  readPropertiesSig(
    parentSegments: readonly string[],
    cell: string,
  ): Promise<string | undefined>
  locationSig(parentSegments: readonly string[], cell: string): Promise<string>
  readIndex(): Record<string, string>
  writeIndex(index: Record<string, string>): void
}

/** Persist the URL canonically, then point the local render cache at that write. */
export async function persistDroppedTileLink(
  parentSegments: readonly string[],
  cell: string,
  url: string,
  persistence: DroppedLinkPersistence,
): Promise<void> {
  await persistence.writeProperties(parentSegments, cell, { link: url })

  const propsSig = await persistence.readPropertiesSig(parentSegments, cell)
  if (!propsSig) return

  const location = await persistence.locationSig(parentSegments, cell)
  const index = persistence.readIndex()
  index[location || cell] = propsSig
  persistence.writeIndex(index)
}

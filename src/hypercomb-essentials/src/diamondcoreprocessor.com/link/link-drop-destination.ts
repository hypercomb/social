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

/** Resources already stored for a dropped link's picture, ready to reference. */
export type DroppedLinkImage = {
  largeSig: string
  smallPointSig: string | null
  smallFlatSig: string | null
}

/**
 * The properties a dropped link writes onto an EXISTING tile.
 *
 * The link is the whole gesture — it is always written. The picture is a
 * courtesy the link happened to come with, so it is optional at every step:
 * absent when the platform offers none, absent when the fetch fails, and
 * absent when the caller declined to disturb a picture the tile already
 * owns. A drop with no picture is a complete drop, not a failed one.
 */
export function droppedTileLinkUpdates(
  url: string,
  image: DroppedLinkImage | null,
  existingProperties: Record<string, unknown> = {},
): Record<string, unknown> {
  const updates: Record<string, unknown> = { link: url }
  if (!image?.largeSig) return updates

  // The canonical write merges SHALLOWLY, so `flat` must be rebuilt from
  // what the tile already carries — replacing the whole bag would drop the
  // flat-orientation offsets a participant had set by hand.
  const priorFlat = existingProperties['flat']
  const flat: Record<string, unknown> = priorFlat && typeof priorFlat === 'object'
    ? { ...priorFlat as Record<string, unknown> }
    : {}

  updates['large'] = { image: image.largeSig, x: 0, y: 0, scale: 1 }
  flat['large'] = { x: 0, y: 0, scale: 1 }
  if (image.smallPointSig) updates['small'] = { image: image.smallPointSig }
  if (image.smallFlatSig) flat['small'] = { image: image.smallFlatSig }
  updates['flat'] = flat
  return updates
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

/**
 * Persist the URL — and the picture it came with, if there is one — canonically,
 * then point the local render cache at that write.
 */
export async function persistDroppedTileLink(
  parentSegments: readonly string[],
  cell: string,
  url: string,
  persistence: DroppedLinkPersistence,
  image: DroppedLinkImage | null = null,
  existingProperties: Record<string, unknown> = {},
): Promise<void> {
  await persistence.writeProperties(
    parentSegments,
    cell,
    droppedTileLinkUpdates(url, image, existingProperties),
  )

  const propsSig = await persistence.readPropertiesSig(parentSegments, cell)
  if (!propsSig) return

  const location = await persistence.locationSig(parentSegments, cell)
  const index = persistence.readIndex()
  index[location || cell] = propsSig
  persistence.writeIndex(index)
}

/**
 * The URL a drag is carrying, if any. Shared by the link worker (to claim a
 * drop) and the image drone (to yield one): both must read the SAME answer,
 * or a drop could be claimed by both paths — or neither.
 */
export function extractDroppedUrl(dt: DataTransfer | null): string | null {
  const uriList = dt?.getData('text/uri-list') ?? ''
  for (const line of uriList.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && /^https?:\/\//i.test(trimmed)) return trimmed
  }
  const plain = (dt?.getData('text/plain') ?? '').trim()
  if (/^https?:\/\//i.test(plain)) return plain
  return null
}

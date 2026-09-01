/** Wire contract for dragging a signature-addressed tile between browsers. */
export const PORTABLE_TILE_MIME = 'application/x-hypercomb-tile'
export const PORTABLE_TILE_SIG_MIME_PREFIX = 'application/x-hypercomb-tile-sig-'

const SIGNATURE = /^[0-9a-f]{64}$/i

export type PortableTileTransfer = {
  readonly name: string
  readonly path: string
  readonly sig: string
  readonly propsSig?: string
}

export function portableTileSignatureType(signature: string): string | null {
  const sig = signature.trim().toLowerCase()
  return SIGNATURE.test(sig) ? `${PORTABLE_TILE_SIG_MIME_PREFIX}${sig}` : null
}

/** Data values are protected during dragover, but the MIME type list is visible. */
export function portableTileSignatureFromTypes(types: Iterable<string> | ArrayLike<string>): string | null {
  for (const raw of Array.from(types as ArrayLike<string>)) {
    const type = String(raw).toLowerCase()
    if (!type.startsWith(PORTABLE_TILE_SIG_MIME_PREFIX)) continue
    const sig = type.slice(PORTABLE_TILE_SIG_MIME_PREFIX.length)
    if (SIGNATURE.test(sig)) return sig
  }
  return null
}

export function writePortableTileTransfer(
  transfer: Pick<DataTransfer, 'setData'>,
  tile: PortableTileTransfer,
): boolean {
  const signatureType = portableTileSignatureType(tile.sig)
  if (!signatureType) return false
  transfer.setData(PORTABLE_TILE_MIME, JSON.stringify(tile))
  transfer.setData(signatureType, tile.sig.toLowerCase())
  transfer.setData('text/plain', tile.sig.toLowerCase())
  return true
}


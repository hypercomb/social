// hypercomb-shim/src/bootstrap/tile-picture.ts
//
// A CREATION'S OWN PICTURE, read by signature alone (jwize 2026-10-07: "the
// tiles should have image visuals from the tiles built into the default").
//
// Nothing new is published for this. A creation's published head is a layer;
// the layer's properties name the picture its tile already wears; every typed
// reference on the way is one meta envelope hop ({ meta: 1, resource }). The
// heap answers every signature on every door, so the reader asks its own
// origin first and the creation's own door second, and keeps only bytes whose
// hash is the signature it asked for.

const SIG = /^[a-f0-9]{64}$/
/** An envelope is a few hundred bytes; anything larger is the thing itself. */
const ENVELOPE_MAX = 4096

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

async function readSig(sig: string, origins: readonly string[]): Promise<ArrayBuffer | null> {
  for (const origin of origins) {
    try {
      const response = await fetch(`${origin}/${sig}`, { cache: 'force-cache' })
      if (!response.ok) continue
      const bytes = await response.arrayBuffer()
      if (hex(await crypto.subtle.digest('SHA-256', bytes)) === sig) return bytes
    } catch { /* the next door may hold it */ }
  }
  return null
}

const asJson = (bytes: ArrayBuffer | null): Record<string, unknown> | null => {
  if (!bytes || bytes.byteLength === 0) return null
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

/** The bytes a reference names: through its envelope when it is one. */
async function resolve(sig: string, origins: readonly string[]): Promise<ArrayBuffer | null> {
  const bytes = await readSig(sig, origins)
  if (!bytes || bytes.byteLength > ENVELOPE_MAX) return bytes
  const envelope = asJson(bytes)
  const inner = envelope?.['meta'] === 1 ? envelope['resource'] : null
  return typeof inner === 'string' && SIG.test(inner) ? readSig(inner, origins) : bytes
}

const firstSig = (value: unknown): string | null => {
  const list = Array.isArray(value) ? value : [value]
  return list.find((entry): entry is string => typeof entry === 'string' && SIG.test(entry)) ?? null
}

/** The picture a tile wears: the chosen original first, then its capture. */
const pictureOf = (props: Record<string, unknown> | null): string | null => {
  for (const face of ['large', 'small']) {
    const image = (props?.[face] as { image?: unknown } | undefined)?.image
    if (typeof image === 'string' && SIG.test(image)) return image
  }
  return null
}

const imageType = (bytes: ArrayBuffer): string => {
  const b = new Uint8Array(bytes.slice(0, 12))
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return ''
}

const pictures = new Map<string, Promise<string | null>>()

/** An object URL for the picture the creation at `head` wears, or null when it
 *  wears none, or no door answers with the bytes its signature names. */
export const tilePicture = (head: string, origins: readonly string[]): Promise<string | null> => {
  if (!SIG.test(head)) return Promise.resolve(null)
  let found = pictures.get(head)
  if (!found) {
    found = (async () => {
      const layer = asJson(await resolve(head, origins))
      const propsSig = firstSig(layer?.['properties'])
      const picture = propsSig ? pictureOf(asJson(await resolve(propsSig, origins))) : null
      const bytes = picture ? await resolve(picture, origins) : null
      const type = bytes ? imageType(bytes) : ''
      return bytes && type ? URL.createObjectURL(new Blob([bytes], { type })) : null
    })().catch(() => null)
    pictures.set(head, found)
  }
  return found
}

/** Where to ask: this origin (the heap answers every door), then the
 *  creation's own door. */
export const pictureOrigins = (route: string): string[] => {
  const own = (() => { try { return new URL(route).origin } catch { return '' } })()
  return [...new Set([location.origin, own].filter(Boolean))]
}

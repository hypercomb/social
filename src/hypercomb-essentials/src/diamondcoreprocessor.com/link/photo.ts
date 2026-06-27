// diamondcoreprocessor.com/link/photo.ts
// Pure image-URL detection and safe-fetch utilities — no class, no IoC.
// Mirrors youtube.ts: small helpers consumed by link-drop.worker.ts.

/**
 * Known image file extensions.
 * Covers common web formats + newer codecs.
 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'jfif', 'svg',
])

/**
 * Map file extension → safe MIME type to force onto the fetched blob.
 * Forcing the type ensures the browser treats the bytes as image data
 * regardless of what the server claims or what's embedded in the file.
 */
const EXTENSION_MIME: Record<string, string> = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp:  'image/bmp',
  svg:  'image/svg+xml',
}

/**
 * Extract the file extension from a URL, ignoring query strings and fragments.
 * Returns lowercase extension or null.
 */
function extractExtension(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }

  // pathname only — strips query/fragment
  const lastSegment = url.pathname.split('/').pop() ?? ''
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex < 0) return null

  return lastSegment.slice(dotIndex + 1).toLowerCase()
}

/**
 * Test whether a URL points to an image based on its file extension.
 * Does NOT fetch — this is a fast, synchronous check.
 */
export function isImageUrl(link: string): boolean {
  const ext = extractExtension(link)
  return ext !== null && IMAGE_EXTENSIONS.has(ext)
}

/**
 * Determine the safe MIME type for a given image URL.
 * Returns null if the URL doesn't look like an image.
 */
export function imageMimeType(link: string): string | null {
  const ext = extractExtension(link)
  if (!ext) return null
  return EXTENSION_MIME[ext] ?? null
}

/** MIME types we accept from a server Content-Type header (HEAD probe fallback). */
const SAFE_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/avif', 'image/bmp', 'image/svg+xml',
])

/**
 * For URLs without an image extension, probe the server with a HEAD request
 * and return the MIME type if it's a recognised image type.
 * Returns null for non-image or unreachable URLs.
 */
async function probeImageMime(link: string): Promise<string | null> {
  try {
    const resp = await fetch(link, { method: 'HEAD' })
    if (!resp.ok) return null

    // Content-Type may include charset — strip it: "image/jpeg; charset=utf-8" → "image/jpeg"
    const ct = (resp.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    return SAFE_IMAGE_MIMES.has(ct) ? ct : null
  } catch {
    return null
  }
}

/** App resource URL (`/@resource/<sig>` or `/@resource/<sig>/name.ext`). These
 *  are content-addressed: the signature carries no extension and the host
 *  serves them as `application/octet-stream`, so neither the URL nor the
 *  Content-Type reveals whether the bytes are an image — only the bytes do. */
function isResourceUrl(link: string): boolean {
  return link.includes('/@resource/')
}

/** Decode the head of a buffer as text IFF it plausibly starts with markup
 *  (`<` after an optional UTF-8 BOM / leading whitespace). Used to spot SVG /
 *  XML, which have no binary magic number. Returns null for binary bytes. */
function sniffTextHead(bytes: Uint8Array): string | null {
  let i = 0
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3 // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++
  if (bytes[i] !== 0x3c) return null // not '<'
  try { return new TextDecoder().decode(bytes.subarray(0, 512)) } catch { return null }
}

/**
 * Sniff an image MIME type from a buffer's magic bytes. The bytes are the only
 * reliable signal for an extensionless, octet-stream resource (a tile `link` of
 * `/@resource/<sig>` — e.g. a diagram). Returns a safe `image/*` MIME or null
 * when the bytes are not a recognised image (the link then opens as a URL).
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif' // GIF8
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp' // BM
  // RIFF<size>WEBP
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  // ISO-BMFF `ftyp` box carrying an AVIF brand (avif / avis)
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase()
    if (brand.startsWith('avi')) return 'image/avif'
  }
  // SVG / XML text (no binary magic) — accept `<svg …>` directly or after an
  // `<?xml …?>` prolog within the head of the document.
  const head = sniffTextHead(b)
  if (head && /<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

/**
 * Fetch an image URL and return a Blob with a forced MIME type.
 *
 * Safety model:
 *  - The fetched bytes are re-wrapped in a new Blob with an explicit image
 *    MIME type — derived from the URL extension, a HEAD probe, or a magic-byte
 *    sniff. Never the server's Content-Type header.
 *  - Browsers will never execute script from an image Blob used in <img>,
 *    createObjectURL, or canvas — the content-type gate prevents it.
 *  - SVGs are the one edge case: they CAN contain <script> tags. We force
 *    `image/svg+xml` which is safe when loaded via <img> (scripts blocked)
 *    but NOT safe in an <iframe> or innerHTML. Consumers must use <img> or
 *    canvas only.
 *
 * Resolution order:
 *  1. Extension-based MIME (fast, no network) — e.g. `.jpg` → `image/jpeg`
 *  2. App resource URLs (`/@resource/<sig>`): GET once + sniff the magic bytes.
 *     The signature has no extension and the host serves octet-stream, so a
 *     HEAD probe can't classify it — without the sniff a diagram would fall
 *     through to a new browser tab instead of opening the in-app photo view.
 *  3. HEAD probe fallback (one extra round-trip) — for extensionless EXTERNAL
 *     URLs like `picsum.photos/200/300` or CDN redirects.
 *
 * Returns null if the URL is not an image or the fetch fails.
 */
export async function fetchImageBlob(link: string): Promise<Blob | null> {
  // 1. Extension-based MIME — fast, no network.
  const extMime = imageMimeType(link)

  // 2. Resource URL with no usable extension → GET the bytes and sniff them.
  if (!extMime && isResourceUrl(link)) {
    try {
      const resp = await fetch(link)
      if (!resp.ok) return null
      const buffer = await resp.arrayBuffer()
      const mime = sniffImageMime(new Uint8Array(buffer))
      return mime ? new Blob([buffer], { type: mime }) : null
    } catch {
      return null
    }
  }

  // 3. HEAD-probe fallback for extensionless external URLs.
  const mime = extMime ?? await probeImageMime(link)
  if (!mime) return null

  try {
    const resp = await fetch(link)
    if (!resp.ok) return null

    const buffer = await resp.arrayBuffer()
    // Force the MIME type — don't trust the server's Content-Type header
    return new Blob([buffer], { type: mime })
  } catch {
    return null
  }
}

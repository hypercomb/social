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

/**
 * Fetch an image URL and return a Blob with a forced MIME type.
 *
 * Safety model:
 *  - The fetched bytes are re-wrapped in a new Blob with an explicit image
 *    MIME type — either derived from the URL extension or from a HEAD probe.
 *  - Browsers will never execute script from an image Blob used in <img>,
 *    createObjectURL, or canvas — the content-type gate prevents it.
 *  - SVGs are the one edge case: they CAN contain <script> tags. We force
 *    `image/svg+xml` which is safe when loaded via <img> (scripts blocked)
 *    but NOT safe in an <iframe> or innerHTML. Consumers must use <img> or
 *    canvas only.
 *
 * Resolution order:
 *  1. Extension-based MIME (fast, no network) — e.g. `.jpg` → `image/jpeg`
 *  2. HEAD probe fallback (one extra round-trip) — for extensionless URLs
 *     like `picsum.photos/200/300` or CDN redirects
 *
 * Returns null if the URL is not an image or the fetch fails.
 */
export async function fetchImageBlob(link: string): Promise<Blob | null> {
  // 1. Try extension-based MIME
  let mime = imageMimeType(link)

  // 2. Fallback: HEAD probe for extensionless URLs
  if (!mime) {
    mime = await probeImageMime(link)
  }

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

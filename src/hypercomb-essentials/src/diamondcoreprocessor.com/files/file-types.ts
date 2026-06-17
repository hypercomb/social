// diamondcoreprocessor.com/files/file-types.ts
//
// Accept-filter vocabulary for the typed dropbox + the file-overlay icon.
//
// A dropbox declares which files it accepts as a list of lowercase
// extensions. `'any'` is the wildcard. The slash queen turns a friendly
// token (`documents`, `images`, `any`, or a comma list) into that list;
// the drop handler asks `accepts()` whether a dropped File matches.
//
// svg is treated as a DOCUMENT here (it is downloadable text), not as a
// tile display image — so a dropbox that lists svg attaches it as a file
// rather than letting image-drop swallow it as the tile's picture.

/** Default `accept` set for `/dropbox` with no argument — documents. */
export const DEFAULT_DROPBOX_ACCEPT: readonly string[] = [
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
  'txt', 'md', 'csv', 'json', 'rtf', 'odt', 'svg', 'zip',
]

/** Extensions used by the `images` alias. */
const IMAGE_EXTS: readonly string[] = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic',
]

/** Extensions whose bytes are UTF-8 text — the AI context-assembly path
 *  inlines these; everything else is passed as name/mime/sig only. */
export const TEXT_EXTS: readonly string[] = [
  'txt', 'md', 'csv', 'json', 'svg', 'rtf', 'html', 'htm', 'xml', 'yml', 'yaml',
]

/** Lowercase extension (no dot) of a filename, or '' if none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Turn the `/dropbox` argument into an accept list.
 *   ''             → documents (default)
 *   'documents'    → documents
 *   'images'       → image extensions
 *   'any' | '*'    → ['any'] (wildcard)
 *   'pdf, csv'     → ['pdf','csv']
 */
export function parseAccept(args: string): string[] {
  const token = args.trim().toLowerCase()
  if (!token) return [...DEFAULT_DROPBOX_ACCEPT]
  if (token === 'documents' || token === 'document' || token === 'docs') return [...DEFAULT_DROPBOX_ACCEPT]
  if (token === 'images' || token === 'image' || token === 'img') return [...IMAGE_EXTS]
  if (token === 'any' || token === 'all' || token === '*') return ['any']
  return token
    .split(/[,\s]+/)
    .map(e => e.replace(/^\./, '').trim())
    .filter(Boolean)
}

/**
 * Does `file` match the dropbox's `accept` list? Extension match is
 * primary; a loose mime substring check is the fallback (so a browser
 * that reports `application/pdf` but a name without extension still
 * lands). `'any'` always matches; an empty list never does.
 */
export function accepts(accept: readonly string[], file: { name: string; type?: string }): boolean {
  if (!accept || accept.length === 0) return false
  if (accept.includes('any')) return true
  const ext = extOf(file.name)
  if (ext && accept.includes(ext)) return true
  const type = (file.type ?? '').toLowerCase()
  if (type) {
    for (const a of accept) {
      if (a && type.includes(a)) return true
    }
  }
  return false
}

/** Whether an attachment's bytes are text the AI path can inline. */
export function isTextLike(name: string, mime?: string): boolean {
  if (TEXT_EXTS.includes(extOf(name))) return true
  const m = (mime ?? '').toLowerCase()
  return m.startsWith('text/') || m === 'application/json' || m === 'image/svg+xml'
}

// ── File-overlay icon ─────────────────────────────────────────────
// Material Icons "description" (a document with text lines), 24×24,
// solid white fill so the Pixi sprite tint multiplies cleanly — same
// convention as the icons in tile-actions.drone.ts.
export const FILES_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white">' +
  '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>' +
  '</svg>'

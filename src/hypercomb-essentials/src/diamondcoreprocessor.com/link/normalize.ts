// diamondcoreprocessor.com/link/normalize.ts
// Pure link normalization — no class, no IoC. Mirrors youtube.ts/photo.ts:
// a small helper consumed by link-open.worker.ts.

/**
 * Give a saved tile link an explicit scheme so `window.open` can navigate.
 *
 * Tile links are typed by hand, so "localhost:4250" and "www.google.com"
 * are common. Neither survives window.open as-is:
 *  - "localhost:4250" PARSES as a URL — but with protocol "localhost:"
 *    (the host reads as a scheme). The browser opens a tab that navigates
 *    nowhere: a blank page.
 *  - "www.google.com" is not a URL at all, so it resolves RELATIVE to the
 *    app origin (localhost:4250/www.google.com) — the app loads again.
 *
 * Pass-throughs, in order:
 *  1. In-app paths ("/@resource/<sig>", "/dolphin") — origin-relative on purpose.
 *  2. Any explicit "scheme://" link (http, https, ftp, …).
 *  3. Scheme-only links that are real (mailto:, tel: have no authority part).
 *
 * Everything else gets a scheme prefixed: http:// for loopback hosts
 * (no TLS on localhost), https:// for the rest of the web.
 */
export function normalizeLink(link: string): string {
  const trimmed = link.trim()
  if (trimmed.length === 0) return trimmed

  if (trimmed.startsWith('/')) return trimmed
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed

  try {
    const protocol = new URL(trimmed).protocol
    if (protocol === 'mailto:' || protocol === 'tel:') return trimmed
  } catch { /* scheme-less — prefix below */ }

  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(trimmed)
  return (loopback ? 'http://' : 'https://') + trimmed
}

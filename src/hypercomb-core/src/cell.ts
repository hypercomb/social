/**
 * Cell name normalization and validation.
 *
 * Cells are OPFS directory names — the fundamental content unit.
 * Allowed: Unicode letters, digits, hyphens. Max 64 chars.
 */

export function normalizeCell(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

export function isValidCell(s: string): boolean {
  return s.length > 0
    && s.length <= 64
    && /^[\p{L}\p{N}]([\p{L}\p{N}\-]*[\p{L}\p{N}])?$/u.test(s)
    && !/-{2,}/.test(s)
    && s === s.toLocaleLowerCase()
}

/**
 * The ADDRESS-BAR spelling of a word — one URL path segment, ready to write.
 * Every run of whitespace becomes ONE hyphen before encoding, so no address
 * ever carries `%20`. Nothing moves: `lineageKey` folds a space and a hyphen
 * alike, so `Big Ideas` and `Big-Ideas` name the same place. Case and other
 * characters are kept; the raw name stays the explorer's (Navigation keeps it).
 */
export function addressSegment(s: string): string {
  return encodeURIComponent(String(s ?? '').trim().replace(/\s+/g, '-'))
}

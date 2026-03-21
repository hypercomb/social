/**
 * Seed name normalization and validation.
 *
 * Seeds are OPFS directory names — the fundamental content unit.
 * Allowed: Unicode letters, digits, hyphens. Max 64 chars.
 */

export function normalizeSeed(s: string): string {
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

export function isValidSeed(s: string): boolean {
  return s.length > 0
    && s.length <= 64
    && /^[\p{L}\p{N}]([\p{L}\p{N}\-]*[\p{L}\p{N}])?$/u.test(s)
    && !/-{2,}/.test(s)
    && s === s.toLocaleLowerCase()
}

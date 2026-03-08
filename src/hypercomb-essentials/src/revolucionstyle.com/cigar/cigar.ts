// revolucionstyle.com/cigar/cigar.ts
// Cigar identity — re-exports core types, adds catalog-specific helpers.

import type { Cigar } from '../journal/journal-entry.js'

export type { Cigar }

export const cigarKey = (c: Cigar): string =>
  `${c.brand}|${c.line}|${c.name}|${c.vitola}`.toLowerCase().trim()

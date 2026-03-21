// revolucionstyle.com/cigar/cigar.ts
import type { Cigar } from '../journal/journal-entry.js'

export type { Cigar }

export const cigarKey = (c: Cigar): string =>
  `${c.brand}|${c.line}|${c.name}|${c.vitola}`.toLowerCase().trim()

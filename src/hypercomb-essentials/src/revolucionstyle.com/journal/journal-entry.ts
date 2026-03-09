// revolucionstyle.com/journal/journal-entry.ts
// Type definitions for cigar journal entries.

export const JOURNAL_PROPERTIES_FILE = '0000'

// ── Cigar identity ─────────────────────────────────────────────

export type Vitola =
  | 'robusto' | 'toro' | 'corona' | 'churchill' | 'lancero'
  | 'gordo' | 'belicoso' | 'torpedo' | 'perfecto' | 'petit corona'
  | 'lonsdale' | 'panatela' | 'other'

export type WrapperType =
  | 'natural' | 'maduro' | 'oscuro' | 'claro' | 'colorado'
  | 'colorado maduro' | 'connecticut' | 'habano' | 'sumatra' | 'other'

export type Strength = 'mild' | 'mild-medium' | 'medium' | 'medium-full' | 'full'

export type Cigar = {
  brand: string
  line: string
  name: string
  vitola: Vitola | string
  wrapper: WrapperType | string
  origin: string
  strength: Strength
}

// ── Flavor profile ─────────────────────────────────────────────

export type FlavorProfile = {
  selected: string[]
  intensities?: Record<string, number>
}

// ── Ratings ────────────────────────────────────────────────────

export type CigarRatings = {
  draw: number
  burn: number
  construction: number
  flavor: number
  overall: number
}

// ── Pairing ────────────────────────────────────────────────────

export type PairingType = 'coffee' | 'whiskey' | 'rum' | 'wine' | 'beer' | 'tea' | 'water' | 'food' | 'other'

export type Pairing = {
  type: PairingType | string
  name: string
}

// ── Journal entry ──────────────────────────────────────────────

export type JournalEntry = {
  cigar: Cigar
  smokedAt: number
  durationMinutes?: number
  flavors: FlavorProfile
  ratings: CigarRatings
  notes: string
  pairings: Pairing[]
  occasion?: string
  photoSigs: string[]
}

// ── Defaults ───────────────────────────────────────────────────

export const emptyRatings = (): CigarRatings => ({
  draw: 0, burn: 0, construction: 0, flavor: 0, overall: 0,
})

export const emptyCigar = (): Cigar => ({
  brand: '', line: '', name: '', vitola: 'robusto',
  wrapper: 'natural', origin: '', strength: 'medium',
})

export const emptyEntry = (): JournalEntry => ({
  cigar: emptyCigar(),
  smokedAt: Date.now(),
  flavors: { selected: [] },
  ratings: emptyRatings(),
  notes: '',
  pairings: [],
  photoSigs: [],
})

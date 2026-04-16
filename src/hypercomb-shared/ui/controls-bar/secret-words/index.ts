// Deterministic two-word tag from a secret string, localized per caller-supplied locale.
// Same secret + same locale → same two words, always. Unknown locales fall back to English.

import { ADJECTIVES as EN_ADJ, NOUNS as EN_NOUN } from './en'
import { ADJECTIVES as JA_ADJ, NOUNS as JA_NOUN } from './ja'
import { ADJECTIVES as FR_ADJ, NOUNS as FR_NOUN } from './fr'
import { ADJECTIVES as ES_ADJ, NOUNS as ES_NOUN } from './es'
import { ADJECTIVES as DE_ADJ, NOUNS as DE_NOUN } from './de'
import { ADJECTIVES as RU_ADJ, NOUNS as RU_NOUN } from './ru'

interface WordLists {
  adjectives: readonly string[]
  nouns: readonly string[]
}

const LISTS: Record<string, WordLists> = {
  en: { adjectives: EN_ADJ, nouns: EN_NOUN },
  ja: { adjectives: JA_ADJ, nouns: JA_NOUN },
  fr: { adjectives: FR_ADJ, nouns: FR_NOUN },
  es: { adjectives: ES_ADJ, nouns: ES_NOUN },
  de: { adjectives: DE_ADJ, nouns: DE_NOUN },
  ru: { adjectives: RU_ADJ, nouns: RU_NOUN },
}

export function secretTag(secret: string, locale = 'en'): string {
  const lists = LISTS[locale] ?? LISTS['en']
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < secret.length; i++) {
    h ^= secret.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const bits = h >>> 0
  const adj = lists.adjectives[(bits & 0xFF) % lists.adjectives.length]
  const noun = lists.nouns[((bits >>> 8) & 0xFF) % lists.nouns.length]
  return `${adj} ${noun}`
}

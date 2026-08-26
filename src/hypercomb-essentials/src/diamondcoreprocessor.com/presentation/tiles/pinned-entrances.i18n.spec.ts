import { describe, expect, it } from 'vitest'
import { PINNED_ENTRANCES_TRANSLATIONS } from './pinned-entrances.i18n'

const keys = ['pinned.aggregate-hint', 'pinned.return']

describe('pinned-entrances catalog', () => {
  it('carries the exact surface key set in every locale', () => {
    expect(Object.keys(PINNED_ENTRANCES_TRANSLATIONS).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh'],
    )
    for (const catalog of Object.values(PINNED_ENTRANCES_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort()).toEqual(keys)
    }
  })
})

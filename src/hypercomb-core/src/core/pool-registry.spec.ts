// core/pool-registry.spec.ts — the reserved-name half of the ratchet flip.
//
// A root tile named after a bare-word pool commits its markers INTO the pool,
// because both fold to one address — the molecule preimage is case-folded, so
// `Bees` collides as surely as `bees`. `isReservedPoolWord` is the one
// question the collision poses, asked the way the collision is computed.

import { describe, expect, it } from 'vitest'
import { BARE_WORD_POOL_MEANINGS, isReservedPoolWord, moleculeKey } from '../index.js'

describe('isReservedPoolWord', () => {
  it('reserves every frozen bare word, folded the way a molecule address folds', () => {
    for (const meaning of BARE_WORD_POOL_MEANINGS) {
      expect(isReservedPoolWord(meaning), meaning).toBe(true)
      expect(isReservedPoolWord(`  ${meaning.toUpperCase()} `), `upper ${meaning}`).toBe(true)
    }
  })

  it('the check IS the collision — the folded name equals the folded meaning', () => {
    expect(moleculeKey('Bees')).toBe(moleculeKey('bees'))
    expect(isReservedPoolWord('Bees')).toBe(true)
  })

  it('does not reserve a participant word, a colon meaning, or the /websites bag', () => {
    expect(isReservedPoolWord('cigars')).toBe(false)
    expect(isReservedPoolWord('websites')).toBe(false)     // sign('websites') being the /websites bag is the design
    expect(isReservedPoolWord('registry:names')).toBe(false)
    expect(isReservedPoolWord('')).toBe(false)
    expect(isReservedPoolWord('   ')).toBe(false)
  })

  it('a bare word that leaves the frozen list stops being reserved — never a second list', () => {
    // The set is DERIVED from BARE_WORD_POOL_MEANINGS; this pins that a retired
    // spelling (substrate, migrated to places:*) is not held reserved by hand.
    expect(BARE_WORD_POOL_MEANINGS.includes('substrate')).toBe(false)
    expect(isReservedPoolWord('substrate')).toBe(false)
  })
})

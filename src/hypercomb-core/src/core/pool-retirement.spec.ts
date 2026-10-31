// Retiring a pool meaning moves its address. These are the two things that
// must stay true afterwards, or the old directory is lost — or worse, pruned.
import { describe, expect, it } from 'vitest'
import {
  BARE_WORD_POOL_MEANINGS, RETIRED_POOL_MEANINGS, SCOPED_POOL_MEANINGS,
  isPoolAddress, poolMeaningOf,
} from './pool-registry.js'
import { validatePoolSpelling } from './molecule-address.js'

/** The address, worked out HERE rather than asked for. Asking the registry to
 *  derive it would register it, and "seeded from boot" is the whole property
 *  under test: a walk that runs before any module loads must still be told
 *  this directory is a pool. */
const addressOf = async (meaning: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(meaning))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

describe('retired pool meanings', () => {
  it('are still known pool addresses — a root walk must never take one for a lineage bag', async () => {
    for (const meaning of RETIRED_POOL_MEANINGS) {
      const address = await addressOf(meaning)
      expect(await isPoolAddress(address), `${meaning} is not a known pool address`).toBe(true)
      expect(await poolMeaningOf(address)).toBe(meaning)
    }
  })

  it('are not live meanings — nothing may be written under a spelling that was retired', () => {
    for (const meaning of RETIRED_POOL_MEANINGS) {
      expect(SCOPED_POOL_MEANINGS, `${meaning} is still live`).not.toContain(meaning)
      expect(BARE_WORD_POOL_MEANINGS, `${meaning} is still live`).not.toContain(meaning)
    }
  })

  it('the Solomon talk pool was respelled to one colon, and the old address is retired', async () => {
    expect(SCOPED_POOL_MEANINGS).toContain('games:solomon-talk')
    expect(RETIRED_POOL_MEANINGS).toContain('games:solomon:talk')
    // The live spelling passes the rule the old one broke.
    expect(validatePoolSpelling('games:solomon-talk').ok).toBe(true)
    expect(validatePoolSpelling('games:solomon:talk').ok).toBe(false)
    // And they are genuinely different places.
    expect(await addressOf('games:solomon-talk')).not.toBe(await addressOf('games:solomon:talk'))
  })
})

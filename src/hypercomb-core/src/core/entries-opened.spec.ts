// entries-opened.spec.ts — the leader's record of the entry pools they opened
// (documentation/open-entry-pools.md) is a seeded meaning and a document:
// one current record, never replicated, never swept.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SCOPED_POOL_MEANINGS, poolMeaningOf } from './pool-registry.js'
import { poolKindOfAddress, poolKindOfMeaning } from './pool-kinds.js'

const sign = (meaning: string): string => createHash('sha256').update(meaning, 'utf8').digest('hex')

describe('entries:opened', () => {
  it('is seeded in the registry, so its address is a pool before anything derives it', async () => {
    expect(SCOPED_POOL_MEANINGS).toContain('entries:opened')
    expect(await poolMeaningOf(sign('entries:opened'))).toBe('entries:opened')
  })

  it('is declared a document: it keeps versions and never travels to a peer', async () => {
    const facts = poolKindOfMeaning('entries:opened')
    expect(facts?.kind).toBe('document')
    expect(facts?.replicates).toBe(false)
    expect((await poolKindOfAddress(sign('entries:opened')))?.kind).toBe('document')
  })

  it('the pool\'s own address is never a meaning: only the record is', () => {
    expect(SCOPED_POOL_MEANINGS.filter(meaning => meaning.startsWith('entries'))).toEqual(['entries:opened'])
  })
})

import { describe, expect, it } from 'vitest'
import { promotedPointer, promotesHead, promotionRecord } from './promote.js'
import { isReservedRootKey } from './hive-link.js'

const HEAD = 'a'.repeat(64)
const OLDER = 'b'.repeat(64)
const PLAN = 'c'.repeat(64)
const DERIVATION = 'd'.repeat(64)

describe('promote', () => {
  it('names the promotion under a reserved key, so it is a pointer and never a branch', () => {
    expect(promotedPointer('revolucion')).toBe('promoted:revolucion')
    expect(isReservedRootKey(promotedPointer('revolucion'))).toBe(true)
  })

  it('writes the same bytes for the same promotion', () => {
    expect(promotionRecord(HEAD, PLAN, DERIVATION)).toBe(promotionRecord(HEAD, PLAN, DERIVATION))
  })

  it('promotes the head it was made for, with a plan, a derivation, or both', () => {
    expect(promotesHead(promotionRecord(HEAD, PLAN, DERIVATION), HEAD)).toBe(true)
    expect(promotesHead(promotionRecord(HEAD, PLAN, null), HEAD)).toBe(true)
    expect(promotesHead(promotionRecord(HEAD, null, DERIVATION), HEAD)).toBe(true)
  })

  it('stops promoting once the branch is published again', () => {
    expect(promotesHead(promotionRecord(OLDER, PLAN, DERIVATION), HEAD)).toBe(false)
  })

  it('promotes nothing when there was nothing to optimize, or the record is not one', () => {
    expect(promotesHead(promotionRecord(HEAD, null, null), HEAD)).toBe(false)
    expect(promotesHead('not json', HEAD)).toBe(false)
    expect(promotesHead(JSON.stringify({ kind: 'plan', head: HEAD }), HEAD)).toBe(false)
    expect(promotesHead(promotionRecord('short', PLAN, DERIVATION), 'short')).toBe(false)
  })
})

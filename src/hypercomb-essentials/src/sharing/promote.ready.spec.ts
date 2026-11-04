import { describe, expect, it } from 'vitest'
import { readyToPromote } from './promote.js'

const row = (over = {}) => ({
  state: 'live', live: 'a'.repeat(64), promoted: false, busyPhase: null,
  doors: null as string[] | null, ownLabels: { 'hypercomb.com': 'presentation' }, ...over,
})

describe('promote only from development', () => {
  it('is offered when live, unchanged, on a subdomain of its own', () => {
    expect(readyToPromote(row())).toBe(true)
  })
  it('is not offered at a domain root path', () => {
    expect(readyToPromote(row({ ownLabels: {} }))).toBe(false)
  })
  it('is not offered when the branch moved on, is promoted, or is busy', () => {
    expect(readyToPromote(row({ state: 'drift' }))).toBe(false)
    expect(readyToPromote(row({ promoted: true }))).toBe(false)
    expect(readyToPromote(row({ busyPhase: 'staging' }))).toBe(false)
  })
  it('is not offered when the subdomain zone is switched off', () => {
    expect(readyToPromote(row({ doors: ['jwize.com'] }))).toBe(false)
  })
})

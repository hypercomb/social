// The visitor's side of "the lights travel with the tree": a publication
// carries the behaviours it was dressed in, and a read-only visit adopts them
// wholesale. These tests pin the three things that make it safe — it replaces
// rather than merges, it slams the cohort ledger shut, and it never claims a
// change it did not make.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  adoptPublishedLights,
  isKindGloballyOff,
  GLOBAL_ON_KEY,
  GLOBAL_OFF_KEY,
  SEEDED_COHORTS_KEY,
} from './behavior-enablement.js'

const read = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null')

describe('adoptPublishedLights', () => {
  beforeEach(() => {
    localStorage.clear()
    // The caches are keyed off the storage event; a direct clear needs a
    // write through the real door to drop them.
    adoptPublishedLights(['seed:reset'])
    localStorage.clear()
  })

  it('lights exactly what the publication carries', () => {
    expect(adoptPublishedLights(['visual:document:body', 'visual:website:page'])).toBe(true)
    expect(read(GLOBAL_ON_KEY)).toEqual(['visual:document:body', 'visual:website:page'])
    expect(isKindGloballyOff('visual:document:body')).toBe(false)
    expect(isKindGloballyOff('visual:website:page')).toBe(false)
  })

  it('leaves every kind the publication did NOT carry dark', () => {
    adoptPublishedLights(['visual:document:body'])
    expect(isKindGloballyOff('visual:lightbox:gallery')).toBe(true)
    expect(isKindGloballyOff('game:arkanoid')).toBe(true)
  })

  // The whole point: a previous visit to a DIFFERENT site must not leak into
  // this one. Union would show neither site as it was published.
  it('REPLACES a prior list rather than merging with it', () => {
    adoptPublishedLights(['visual:lightbox:gallery', 'game:solomon'])
    adoptPublishedLights(['visual:document:body'])
    expect(read(GLOBAL_ON_KEY)).toEqual(['visual:document:body'])
    expect(isKindGloballyOff('visual:lightbox:gallery')).toBe(true)
  })

  // A reader chose nothing, so nothing may light itself behind them later —
  // the same guarantee the dark start makes, for the same reason.
  it('stamps the cohort ledger so no later seed can light anything', () => {
    adoptPublishedLights(['visual:document:body'])
    expect(read(SEEDED_COHORTS_KEY)).toEqual(['*'])
  })

  it('keeps the withheld-wire mirror consistent with the one switch', () => {
    localStorage.setItem(GLOBAL_OFF_KEY, JSON.stringify(['visual:document:body', 'game:roper']))
    adoptPublishedLights(['visual:document:body'])
    expect(read(GLOBAL_OFF_KEY)).toEqual(['game:roper'])
  })

  it('reports no change when the lights already match', () => {
    expect(adoptPublishedLights(['a', 'b'])).toBe(true)
    expect(adoptPublishedLights(['b', 'a'])).toBe(false)
  })

  it('drops blanks and duplicates rather than storing them', () => {
    adoptPublishedLights(['a', '  a  ', '', '   ', 'b'])
    expect(read(GLOBAL_ON_KEY)).toEqual(['a', 'b'])
  })

  // An empty list is a real answer — "the publisher lit nothing" — and is
  // distinct from a publication that carries no mark at all, which the visit
  // path filters out before it ever calls this.
  it('accepts an empty list as a deliberate all-dark arrangement', () => {
    adoptPublishedLights(['a'])
    expect(adoptPublishedLights([])).toBe(true)
    expect(read(GLOBAL_ON_KEY)).toEqual([])
    expect(isKindGloballyOff('a')).toBe(true)
  })
})

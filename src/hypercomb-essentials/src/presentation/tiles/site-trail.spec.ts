// site-trail.spec.ts — the path through a site, walked back one page at a time.

import { describe, expect, it } from 'vitest'
import { SiteTrail } from './site-trail.js'

describe('the trail through a site', () => {
  it('walks back the pages in the order they were left, then has nothing', () => {
    const trail = new SiteTrail()
    trail.left(['site'], ['site', 'a'])
    trail.left(['site', 'a'], ['site', 'a', 'b'])
    expect(trail.back()).toEqual(['site', 'a'])
    expect(trail.back()).toEqual(['site'])
    expect(trail.back()).toBeNull()
  })

  it('remembers a page visited twice as two steps: the path, not the places', () => {
    const trail = new SiteTrail()
    trail.left(['a'], ['b'])
    trail.left(['b'], ['a'])
    expect(trail.length).toBe(2)
    expect(trail.back()).toEqual(['b'])
    expect(trail.back()).toEqual(['a'])
  })

  it('does not count staying on the same page as a visit', () => {
    const trail = new SiteTrail()
    trail.left(['a'], ['a'])
    expect(trail.length).toBe(0)
  })

  it('keeps at most its limit, dropping the oldest pages', () => {
    const trail = new SiteTrail(2)
    trail.left(['a'], ['b'])
    trail.left(['b'], ['c'])
    trail.left(['c'], ['d'])
    expect(trail.back()).toEqual(['c'])
    expect(trail.back()).toEqual(['b'])
    expect(trail.back()).toBeNull()
  })

  it('starts over on clear', () => {
    const trail = new SiteTrail()
    trail.left(['a'], ['b'])
    trail.clear()
    expect(trail.back()).toBeNull()
  })

  it('keeps its own copy of a page, so a caller changing theirs changes nothing', () => {
    const trail = new SiteTrail()
    const from = ['a']
    trail.left(from, ['b'])
    from.push('x')
    expect(trail.back()).toEqual(['a'])
  })
})

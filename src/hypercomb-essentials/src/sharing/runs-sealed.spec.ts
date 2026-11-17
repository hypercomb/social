// runs-sealed.spec.ts — A PAGE THIS HIVE DID NOT AUTHOR NEVER RUNS AS THIS HIVE
// (jwize 2026-11-16: "how do we keep safe from someone's community entry
// because we are literally letting it in our hive … You are putting yourself
// and others at risk if you accept unvetted code" … "make sure we aren't
// vulnerable").
//
// A page that may run is mounted in one of two ways: in the hive's own document
// (where it holds the hive's storage, signing key and services) or in a sealed
// frame of its own origin. Only the participant's own pages get the first, and
// "own" is a property of the page's SIGNATURE (the sign('authored') pool), not
// of where it sits or which domain a host named: those are device-local and
// move (a cut and paste drops the adopted-root record; a new device has none).

import { beforeEach, describe, expect, it } from 'vitest'
import { featureNeedsReview, isForeignContent, runsSealed } from './feature-availability.js'
import { _resetAdoptedRootsCache, markAdoptedRoot, markCarriedRoot } from './adopted-roots.js'
import { markAuthored } from './authored-sigs.js'

const page = (c: string): string => c.repeat(64)

beforeEach(() => {
  localStorage.clear()
  _resetAdoptedRootsCache()
  delete document.documentElement.dataset['hypercombMode']
  document.getElementById('hc-managed-site')?.remove()
  localStorage.setItem('hc:nostrmesh:self-domain', 'jwize.com')
})

describe('fail closed: a page runs in the hive only when this hive authored it', () => {
  it('a page published by another domain', () => {
    expect(runsSealed(['news'], page('a'), 'https://elsewhere.com/')).toBe(true)
  })

  it('a page in a branch folded in from a peer, whatever domain it names', () => {
    markAdoptedRoot(['games'])
    expect(runsSealed(['games', 'arkanoid'], page('a'), '')).toBe(true)
    expect(runsSealed(['games', 'arkanoid'], page('a'), 'jwize.com')).toBe(true)
  })

  it('a peer\'s page whose branch record was lost — cut and pasted, a new device — still runs sealed', () => {
    // No adopted root, no carried root, no domain: nothing says whose it is.
    expect(runsSealed(['archive', 'stuff', 'peer'], page('a'), '')).toBe(true)
  })

  it('a trusted domain or an allowed root lets it run, never run as you', () => {
    localStorage.setItem('hc:community:domains', JSON.stringify(['friend.com']))
    expect(featureNeedsReview(['x'], page('a'), 'friend.com')).toBe(false)
    expect(runsSealed(['x'], page('a'), 'friend.com')).toBe(true)
  })

  it('a page you wrote runs in the page itself, wherever it sits', () => {
    markAuthored(page('b'))
    expect(runsSealed(['home'], page('b'), '')).toBe(false)
    markAdoptedRoot(['games'])
    expect(runsSealed(['games', 'mine'], page('b'), 'elsewhere.com')).toBe(false)
  })
})

describe('on a published visitor shell the publisher\'s own pages are its own origin\'s', () => {
  it('its own pages run as any website does; another domain\'s or a peer\'s run sealed', () => {
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(runsSealed(['card'], page('c'), '')).toBe(false)
    expect(runsSealed(['card'], page('c'), 'jwize.com')).toBe(false)
    expect(runsSealed(['card'], page('c'), 'elsewhere.com')).toBe(true)
    markCarriedRoot(['card', 'theirs'])
    expect(runsSealed(['card', 'theirs'], page('c'), '')).toBe(true)
  })
})

describe('a carried tile is foreign to the review gate too', () => {
  it('before 2026-11-16 a peer\'s page moved onto your pages ran with no review at all', () => {
    markCarriedRoot(['home', 'their-card'])
    expect(isForeignContent(['home', 'their-card'], '')).toBe(true)
    expect(featureNeedsReview(['home', 'their-card'], page('c'), '')).toBe(true)
    expect(featureNeedsReview(['home', 'mine'], page('c'), '')).toBe(false)
  })
})

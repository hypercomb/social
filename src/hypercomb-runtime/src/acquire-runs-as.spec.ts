// acquire-runs-as.spec.ts — a managed site door runs as its zone.
//
// business-card.jwize.com, opened through /@hypercomb, installs jwize.com's
// package on its first visit. A cold page has no attester (attesters are bees,
// and no bee is here yet), so the gate would refuse a foreign host's package —
// and did: the setup's Install button refused the same way on every press. The
// zone's own worker serves that page only on its own site door, so the zone's
// package is the page's own. runsAs honours that claim only for a zone the host
// actually sits under.

import { describe, expect, it } from 'vitest'
import { runsAs } from './acquire'
import { activationAuthority } from './activation-authority'

const PKG = 'a'.repeat(64)

describe('runsAs — who a page is to the activation gate', () => {
  it('is the zone a site door hangs off, when asked', () => {
    expect(runsAs('business-card.jwize.com', 'jwize.com')).toBe('jwize.com')
    expect(runsAs('business-card.jwize.com:443', 'jwize.com')).toBe('jwize.com')
    expect(runsAs('Business-Card.JWIZE.com', 'JWIZE.com')).toBe('jwize.com')
  })

  it('is the page\'s own host when nothing is asked', () => {
    expect(runsAs('business-card.jwize.com')).toBe('business-card.jwize.com')
    expect(runsAs('business-card.jwize.com', '')).toBe('business-card.jwize.com')
  })

  it('never a zone the host does not sit under', () => {
    expect(runsAs('business-card.jwize.com', 'hypercomb.com')).toBe('business-card.jwize.com')
    // A look-alike suffix is not a parent.
    expect(runsAs('evil-jwize.com', 'jwize.com')).toBe('evil-jwize.com')
    // The host itself, or a bare word, is no promotion.
    expect(runsAs('jwize.com', 'jwize.com')).toBe('jwize.com')
    expect(runsAs('business-card.jwize.com', 'com')).toBe('business-card.jwize.com')
  })
})

describe('the gate, asked as a managed site door', () => {
  it('admits the zone\'s package with no attester loaded', async () => {
    const verdict = await activationAuthority({
      packageSig: PKG, zone: 'jwize.com', self: runsAs('business-card.jwize.com', 'jwize.com'), installed: null, attester: null,
    })
    expect(verdict).toEqual({ ok: true, by: 'self' })
  })

  it('still refuses that package to the bare site door, and any other host\'s to the managed one', async () => {
    const bare = await activationAuthority({
      packageSig: PKG, zone: 'jwize.com', self: 'business-card.jwize.com', installed: null, attester: null,
    })
    expect(bare.ok).toBe(false)
    const other = await activationAuthority({
      packageSig: PKG, zone: 'elsewhere.example', self: runsAs('business-card.jwize.com', 'jwize.com'), installed: null, attester: null,
    })
    expect(other.ok).toBe(false)
  })
})

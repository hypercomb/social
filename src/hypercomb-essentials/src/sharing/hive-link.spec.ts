// hive-link.spec.ts — install channels ride the ONE signed index.

import { describe, expect, it } from 'vitest'
import { installChannelKey, installRootOf, INSTALL_CHANNEL_PREFIX } from './hive-link.js'

describe('install channels', () => {

  it('derives the reserved colon key — unreachable by any folded lineage', () => {
    expect(installChannelKey('essentials')).toBe('install:essentials')
    expect(installChannelKey('  Essentials ')).toBe('install:essentials')
    expect(installChannelKey('essentials').startsWith(INSTALL_CHANNEL_PREFIX)).toBe(true)
    // lineageKey folds non-letter/number to '-', so a location can never mint
    // a ':' key — the reservation holds by construction.
    expect(installChannelKey('essentials')).toContain(':')
  })

  it('reads the channel root from verified index roots', () => {
    const sig = 'c'.repeat(64)
    const roots = { arkanoid: 'a'.repeat(64), 'install:essentials': sig }
    expect(installRootOf(roots, 'essentials')).toBe(sig)
  })

  it('returns null for an absent channel or a malformed root', () => {
    expect(installRootOf({}, 'essentials')).toBeNull()
    expect(installRootOf({ 'install:essentials': 'not-a-sig' }, 'essentials')).toBeNull()
    expect(installRootOf({ essentials: 'b'.repeat(64) }, 'essentials')).toBeNull()   // bare key ≠ channel
  })
})

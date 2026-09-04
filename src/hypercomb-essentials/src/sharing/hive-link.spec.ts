// hive-link.spec.ts — install channels ride the ONE signed index.

import { describe, expect, it } from 'vitest'
import {
  bridgeMaySetRootKey, installChannelKey, installRootOf, INSTALL_CHANNEL_PREFIX,
  BRIDGE_FORBIDDEN_ROOT_KEYS, HIVE_FORMAT_ROOT_KEY, VOCABULARY_ROOT_KEY,
} from './hive-link.js'

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

describe('what the bridge may set', () => {
  it('an install stamp, and nothing else — an allow-list, so an omission fails closed', () => {
    expect(bridgeMaySetRootKey('install:essentials')).toBe(true)
    expect(bridgeMaySetRootKey(installChannelKey('shim'))).toBe(true)
    // every reserved key that is a PARTICIPANT act
    expect(bridgeMaySetRootKey(VOCABULARY_ROOT_KEY)).toBe(false)
    expect(bridgeMaySetRootKey(HIVE_FORMAT_ROOT_KEY)).toBe(false)
    // a colon alone is not permission; nor is a lineage root; nor a malformed channel
    expect(bridgeMaySetRootKey('anything:else')).toBe(false)
    expect(bridgeMaySetRootKey('arkanoid')).toBe(false)
    expect(bridgeMaySetRootKey('install:')).toBe(false)
    expect(bridgeMaySetRootKey('install:Bad Channel')).toBe(false)
    expect(bridgeMaySetRootKey('')).toBe(false)
  })

  it('the named refusals are each refused by the allow-list, so the two can never disagree', () => {
    for (const key of BRIDGE_FORBIDDEN_ROOT_KEYS) expect(bridgeMaySetRootKey(key)).toBe(false)
    expect(BRIDGE_FORBIDDEN_ROOT_KEYS).toContain(HIVE_FORMAT_ROOT_KEY)
  })
})

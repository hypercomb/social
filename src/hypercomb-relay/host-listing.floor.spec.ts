// host-listing.floor.spec.ts
//
// The floor file names each floor meaning's LISTING POLICY, and every host
// shape lists by it (the relay and the blossom worker through host-listing.js,
// the native host through crates/serve). A policy must agree with the kind the
// pool's minter declared in core (pool-kinds.ts): a `document` pool listed as
// a `set` would hand out every earlier version. This is the one place both
// sides are in reach, so it runs under the root vitest (`src/`), not node:test.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { poolKindOfMeaning } from '@hypercomb/core'

const floor = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'host-listing.floor.json'), 'utf8'),
) as Record<string, string>

describe('host listing floor', () => {
  it('lists the four contract pools', () => {
    expect(Object.keys(floor)).toEqual(['host:packages', 'host:offerings', 'community:hosts', 'community:offers'])
  })

  it('gives every floor meaning the kind core declares for it', () => {
    for (const [meaning, policy] of Object.entries(floor)) {
      expect(poolKindOfMeaning(meaning)?.kind, meaning).toBe(policy)
    }
  })
})

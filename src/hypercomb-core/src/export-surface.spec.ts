// hypercomb-core/src/export-surface.spec.ts
//
// Core's export surface is a PROTOCOL. Installed packages import from whatever
// core the live shell ships, so a name that disappears breaks every package
// that still imports it ("does not provide an export named …"), in the same
// browser that is supposed to offer the upgrade. That has happened three times:
// canonicalRootSegments, then ATOMIZER_IOC_PREFIX, both caught live.
//
// `export-surface.floor.json` holds every runtime export name. A name may be
// ADDED to core freely; one missing from core fails here. To retire a name,
// keep exporting it: delegate to its successor, or park it in
// `retired-exports.ts`. Add new exports to the floor once they have shipped.

import { describe, expect, it } from 'vitest'
import * as core from './index.js'
import floor from './export-surface.floor.json'

describe('core export surface', () => {
  it('still exports every name an installed package may import', () => {
    const have = new Set(Object.keys(core))
    expect(floor.filter(name => !have.has(name))).toEqual([])
  })
})

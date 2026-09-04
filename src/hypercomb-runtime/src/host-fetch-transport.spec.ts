import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'store.ts'), 'utf8')

// NO TRANSPORT IS NOT A MISS.
//
// The content broker is a bee — on a cold boot it registers after the first
// render pass has already asked for bytes. Treating "no broker yet" as a host
// miss negative-cached the signature for a full minute, and on a published
// site (where EVERY byte comes from the origin) that window covered the whole
// first paint: tile props never resolved, the paint fell back to substrate
// art, and the published picture never appeared for the session.
//
// THIS SPEC READS SOURCE, SO IT IS ONLY AS GOOD AS THE FILE IT READS. It used
// to sit in `hypercomb-shared/core`, and when the store moved here it went on
// reading the 11-line re-export stub left behind at that path. Two of its
// tests failed loudly — but the `.not.toMatch` one PASSED, vacuously, because
// nothing in a stub matches anything: the regression it exists to catch could
// have shipped under a green test. A missing file throws and is loud; a file
// that survives as a husk is silent, so the first test proves the target is
// the store itself before any assertion trusts it.
describe('store host fetch — transport vs miss', () => {
  it('reads the store itself, not a re-export stub', () => {
    expect(SRC).toContain('#hostFetchMissUntil')
    expect(SRC).toContain('#layerHostMissUntil')
    expect(SRC.split('\n').length).toBeGreaterThan(500)
  })

  it('bails out before the miss window when no broker is registered (resources)', () => {
    expect(SRC).toMatch(/if \(!broker\?\.fetchBySig\) return null\s*\n\s*const bytes = await broker\.fetchBySig\(signature, 'resource'\)/)
  })

  it('bails out before the miss window when no broker is registered (layers)', () => {
    expect(SRC).toMatch(/if \(!broker\?\.fetchBySig\) return null\s*\n\s*const bytes = await broker\.fetchBySig\(signature, 'layer'\)/)
  })

  it('never optional-chains the fetch call into a miss record', () => {
    expect(SRC).not.toMatch(/const bytes = await broker\?\.fetchBySig\?\.\(/)
  })
})

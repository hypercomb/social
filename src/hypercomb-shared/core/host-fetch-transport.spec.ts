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
describe('store host fetch — transport vs miss', () => {
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

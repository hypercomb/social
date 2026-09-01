import { describe, it, expect } from 'vitest'
import { chooseSealChildHandle } from './seal-preference.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'history.service.ts'), 'utf8')

// A children slot may carry a metadata INCIDENCE (`{meta:1, layer, relation}`)
// instead of the child's layer signature. A lineage bag's markers are always
// bare layer sigs, so testing the incidence for bag membership can never match
// — every wrapped child then reads as `hint-off-lineage` and the seal honours a
// stale hint forever. That is why an edited tile's new picture could never
// reach a publish (proven on /susan, 2026-08-29).
describe('sealSubtree — incidence-wrapped child hints', () => {
  it('the bag-membership test runs on the TERMINAL layer sig, not the slot entry', () => {
    expect(SRC).toMatch(/const terminalHint = this\.#terminalLayerSig\(childSig\)/)
    expect(SRC).toMatch(/hintSig: terminalHint,/)
    expect(SRC).not.toMatch(/hintSig: String\(cs\),/)
  })

  it('honouring the hint carries the original slot entry, never the unwrapped sig', () => {
    expect(SRC).toMatch(/sealedChildren\.push\(decision\.reason === 'hint-off-lineage' \? childSig : decision\.handle\)/)
  })

  it('an unchanged child keeps its slot entry verbatim', () => {
    expect(SRC).toMatch(/if \(sealed === terminalHint\) \{ sealedChildren\.push\(childSig\); continue \}/)
  })

  it('#terminalLayerSig follows the incidence map and is cycle-bounded', () => {
    expect(SRC).toMatch(/readonly #terminalLayerSig = \(sig: string\): string =>/)
    expect(SRC).toMatch(/const next = this\.#metaLayerTarget\.get\(current\)/)
    expect(SRC).toMatch(/if \(seen\.has\(current\)\) return current/)
  })

  // The arbitration itself is unchanged — these pin the decisions the fix
  // depends on, so a future edit to seal-preference cannot silently invert it.
  it('a hint present in the bag freshens; an absent one is honoured', () => {
    expect(chooseSealChildHandle({ hintSig: 'a'.repeat(64), sealSig: 'b'.repeat(64), bagSigs: ['a'.repeat(64)] }))
      .toEqual({ handle: 'b'.repeat(64), reason: 'freshened' })
    expect(chooseSealChildHandle({ hintSig: 'a'.repeat(64), sealSig: 'b'.repeat(64), bagSigs: ['c'.repeat(64)] }))
      .toEqual({ handle: 'a'.repeat(64), reason: 'hint-off-lineage' })
  })
})

// The roots that ran here before (acquire.ts previousRoots / nextPreviousRoots): what the
// activation record remembers so the shell's root screen can offer a way back.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextPreviousRoots, previousRoots } from './acquire'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('the roots that ran here before', () => {
  it('puts the root being left first, and never lists the root being taken as its own past', () => {
    expect(nextPreviousRoots(A, B, [])).toEqual([A])
    expect(nextPreviousRoots(B, C, [A])).toEqual([B, A])
    // Going back to an earlier root takes it out of the past.
    expect(nextPreviousRoots(C, A, [B, A])).toEqual([C, B])
  })

  it('changes nothing when the same root is activated again — a switch, a pick, a repair', () => {
    expect(nextPreviousRoots(B, B, [A])).toEqual([A])
    expect(nextPreviousRoots(null, A, [])).toEqual([])
  })

  it('keeps five, each once, and only signatures', () => {
    const many = ['1', '2', '3', '4', '5', '6'].map(digit => digit.repeat(64))
    expect(nextPreviousRoots(A, B, many)).toEqual([A, ...many.slice(0, 4)])
    expect(nextPreviousRoots(A, B, [A, A, 'nope'])).toEqual([A])
  })

  it('reads the record, and a record from before this, or a damaged one, as no past', () => {
    expect(previousRoots({ previous: [A, B, A, 'x', 7] })).toEqual([A, B])
    for (const none of [null, undefined, {}, { previous: 'a' }, { version: 2, bees: [] }, 'text']) expect(previousRoots(none)).toEqual([])
  })

  it('rides in the activation record — no write of its own', () => {
    const source = readFileSync(join(__dirname, 'acquire.ts'), 'utf8')
    const activate = source.slice(source.indexOf('const activate = async ('), source.indexOf('const writeBags = async'))
    expect(activate.indexOf('const leaving = installedPackageSig()')).toBeLessThan(activate.indexOf('stampInstalledPackage(packageSig)'))
    expect(activate).toMatch(/previous: nextPreviousRoots\(leaving, packageSig, earlier\),/)
    expect([...activate.matchAll(/localStorage\.setItem\(/g)]).toHaveLength(2)
  })
})

// bags.spec.ts — the import-map bags, computed rather than fetched.
//
// These pin the FORMAT, because the format is the address: the bag signature
// is the sha256 of the entries, so a stray character does not make a
// slightly-wrong bag — it makes a bag nobody else has. The shape must stay
// byte-identical to `writeBag` in hypercomb-essentials/scripts/build-module.ts.

import { describe, expect, it } from 'vitest'
import { aliasOf, bagEntryName, bagSignature, beeEntries, dependencyEntries, orderedEntries } from './bags'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('aliasOf', () => {

  it('reads the alias the build writes at the head of a dependency', () => {
    expect(aliasOf(bytes('// @hypercomb/essentials/editor\nvar x = 1'))).toBe('@hypercomb/essentials/editor')
  })

  it('answers empty for a dependency that carries no alias line', () => {
    expect(aliasOf(bytes('var x = 1'))).toBe('')
    expect(aliasOf(null)).toBe('')
  })

  it('reads only the first line, however large the module', () => {
    expect(aliasOf(bytes(`// @scope/name\n${'x'.repeat(10_000)}`))).toBe('@scope/name')
  })
})

describe('entry shape', () => {

  it('pairs a dependency alias with its signature, both on their own line', () => {
    expect(dependencyEntries([SIG_A], () => '@scope/name')).toEqual([
      { sig: SIG_A, content: `@scope/name\n${SIG_A}\n` },
    ])
  })

  it('gives a bee an empty alias line — it is not imported by name', () => {
    expect(beeEntries([SIG_A])).toEqual([{ sig: SIG_A, content: `\n${SIG_A}\n` }])
  })
})

describe('bagSignature', () => {

  it('is independent of the order entries are offered in', async () => {
    const forward = dependencyEntries([SIG_A, SIG_B], sig => (sig === SIG_A ? '@a' : '@b'))
    const backward = dependencyEntries([SIG_B, SIG_A], sig => (sig === SIG_A ? '@a' : '@b'))

    expect(await bagSignature(forward)).toBe(await bagSignature(backward))
  })

  it('changes when an alias changes — the address is over the content', async () => {
    const before = await bagSignature(dependencyEntries([SIG_A], () => '@a'))
    const after = await bagSignature(dependencyEntries([SIG_A], () => '@renamed'))

    expect(before).not.toBe(after)
  })

  it('is a signature', async () => {
    expect(await bagSignature(beeEntries([SIG_A]))).toMatch(/^[a-f0-9]{64}$/)
  })

  it('distinguishes a bee bag from a dependency bag of the same members', async () => {
    // The alias line is empty for one and not the other, so the same set of
    // signatures lands at two addresses — which is why each pool holds its own.
    expect(await bagSignature(beeEntries([SIG_A])))
      .not.toBe(await bagSignature(dependencyEntries([SIG_A], () => '@a')))
  })
})

describe('write order', () => {

  it('sorts by signature, so index i means the same member to every builder', () => {
    const entries = dependencyEntries([SIG_B, SIG_A], () => '')
    expect(orderedEntries(entries).map(e => e.sig)).toEqual([SIG_A, SIG_B])
  })

  it('names entries at the conformance marker width', () => {
    expect(bagEntryName(0)).toBe('00000000')
    expect(bagEntryName(42)).toBe('00000042')
  })
})

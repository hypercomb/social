// hypercomb-shared/core/mark-set.spec.ts
//
// The canonical form is an INTEROPERABILITY contract, not an implementation
// detail, and it had already drifted once — each registry carried a private
// copy and they stopped agreeing. These tests are the mechanical guard that was
// missing: they pin the property both registries depend on, and the last one
// pins it across the two registries themselves so a future private `#canonical`
// cannot quietly reappear.

import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['register'] = () => { /* noop */ }
  g['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = { register: () => { /* noop */ }, get: () => undefined }
})

const { canonicalMarks, markSetBytes, markSetSignature } = await import('./mark-set')

describe('canonical mark set', () => {
  it('is a property of the SET, not of the picking order', () => {
    expect(canonicalMarks(['b', 'a'])).toEqual(canonicalMarks(['a', 'b']))
  })

  it('trims, drops blanks, and de-duplicates', () => {
    expect(canonicalMarks([' a ', 'a', '', '   ', 'b'])).toEqual(['a', 'b'])
  })

  it('is idempotent, so callers may pass a canonical set back in', () => {
    const once = canonicalMarks(['b', 'a'])
    expect(canonicalMarks(once)).toEqual(once)
  })

  // THE ONE THAT MATTERS. `localeCompare` answers by the runtime's collation,
  // so the same marks on two machines could hash to two addresses — and the two
  // registries, sorting differently, did exactly that to each other.
  it('orders by code unit, never by collation', () => {
    // Under most collations 'a' sorts before 'B'; by code unit 'B' (0x42)
    // precedes 'a' (0x61). This asserts the byte-stable answer.
    expect(canonicalMarks(['a', 'B'])).toEqual(['B', 'a'])
    expect(canonicalMarks(['a', 'B'])).not.toEqual(['a', 'B'].sort((x, y) => x.localeCompare(y)))
  })

  it('an empty set has no signature', async () => {
    expect(await markSetSignature([])).toBeNull()
    expect(await markSetSignature(['  '])).toBeNull()
  })

  it('the same set signs identically however it was assembled', async () => {
    expect(await markSetSignature([' b', 'a', 'a'])).toBe(await markSetSignature(['a', 'b']))
  })

  it('the bytes carry the canonical set, so the sig and the resource agree', () => {
    expect(markSetBytes(['b', 'a'])).toBe(JSON.stringify({ marks: ['a', 'b'] }))
  })
})

describe('a bouquet and an interest are the same bytes', () => {
  // The claim in both registries' `#bytes`: a set assembled as one can be
  // adopted as the other without conversion. It was FALSE while each sorted its
  // own way — one set of marks landed on two resources. Drive the real
  // registries, not the helper, so a re-privatised canonicaliser fails here.
  it('one set of marks lands on ONE resource, whichever registry assembled it', async () => {
    const { BouquetRegistry } = await import('./bouquet-registry')
    const { InterestRegistry } = await import('./interest-registry')
    const marks = ['Review', 'cigars', 'B', 'a']

    const bouquetSig = await new BouquetRegistry().signatureOf(marks)
    const interestSig = await new InterestRegistry().signatureOf([...marks].reverse())

    expect(bouquetSig).toBeTruthy()
    expect(interestSig).toBe(bouquetSig)
  })
})

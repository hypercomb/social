import { describe, expect, it } from 'vitest'
import {
  buildCanonicalReferencePayload,
  buildCanonicalReferenceRecord,
  buildCanonicalVariantRecord,
  canonicalReferenceName,
  canonicalReferenceRoute,
  normalizeReferenceMarks,
} from './canonical-reference.js'

const SIG = 'a'.repeat(64)
const BOUQUET = 'b'.repeat(64)

describe('canonical portal reference grammar', () => {
  it('keeps a name one safe segment, and a route a list of them', () => {
    expect(canonicalReferenceName('  peo/ple\\  ')).toBe('people')
    expect(canonicalReferenceRoute(['nest', ' peo/ple ', '', null])).toEqual(['nest', 'people'])
  })

  it('points at WHERE THE TARGET LIVES — the route is kept, never a root copy', () => {
    expect(buildCanonicalReferencePayload({ targetSegments: ['nest', 'people'], targetSig: SIG }))
      .toEqual({ targetSegments: ['nest', 'people'], targetSig: SIG })
  })

  it('marks only an explicit Portal row as a root-default editor', () => {
    expect(buildCanonicalReferencePayload({ targetSegments: ['jaime'] }))
      .toEqual({ targetSegments: ['jaime'] })
    expect(buildCanonicalReferencePayload({ targetSegments: ['jaime'], editsRootDefault: true }))
      .toEqual({ targetSegments: ['jaime'], editsRootDefault: true })
  })

  it('drops a targetSig that is not a signature rather than carrying it', () => {
    expect('targetSig' in buildCanonicalReferencePayload({ targetSegments: ['a'], targetSig: 'nope' }))
      .toBe(false)
  })

  it('normalizes demands so identical meaning mints identical bytes', () => {
    expect(normalizeReferenceMarks(['work', 'family', 'work', ''])).toEqual(['family', 'work'])
    const a = buildCanonicalReferenceRecord({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: ['work', 'family'], requiredBouquet: BOUQUET,
    })
    const b = buildCanonicalReferenceRecord({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: ['family', 'work'], requiredBouquet: BOUQUET,
    })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a).toEqual({
      kind: 'reference',
      appliesTo: [],
      payload: {
        targetSegments: ['people'],
        targetSig: SIG,
        requiredMarks: ['family', 'work'],
        requiredBouquet: BOUQUET,
      },
      refs: [BOUQUET],
    })
  })

  it('retains a same-name meaning as one layer-addressed pool candidate', () => {
    expect(buildCanonicalVariantRecord({ name: ' people ', layerSig: SIG })).toEqual({
      kind: 'canonical:variant',
      name: 'people',
      payload: { layerSig: SIG },
      refs: [SIG],
    })
    expect(buildCanonicalVariantRecord({ name: 'people', layerSig: 'not-a-sig' })).toBeNull()
  })
})

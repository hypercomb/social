import { describe, expect, it } from 'vitest'
import {
  buildCanonicalReferencePayload,
  buildCanonicalReferenceRecord,
  buildCanonicalVariantRecord,
  canonicalReferenceName,
  canonicalRootSegments,
  normalizeReferenceMarks,
} from './canonical-reference.js'

const SIG = 'a'.repeat(64)
const BOUQUET = 'b'.repeat(64)

describe('canonical portal reference grammar', () => {
  it('derives one root segment from the fixed name', () => {
    expect(canonicalReferenceName('  peo/ple\\\u0001  ')).toBe('people')
    expect(canonicalRootSegments('people')).toEqual(['people'])
  })

  it('never retains the discovery lineage in the reference payload', () => {
    const payload = buildCanonicalReferencePayload({
      name: 'people',
      targetSig: SIG,
    })
    expect(payload).toEqual({ targetSegments: ['people'], targetSig: SIG })
  })

  it('marks only an explicit Portal row as a root-default editor', () => {
    expect(buildCanonicalReferencePayload({ name: 'jaime' }))
      .toEqual({ targetSegments: ['jaime'] })
    expect(buildCanonicalReferencePayload({ name: 'jaime', editsRootDefault: true }))
      .toEqual({ targetSegments: ['jaime'], editsRootDefault: true })
  })

  it('normalizes demands so identical meaning mints identical bytes', () => {
    expect(normalizeReferenceMarks(['work', 'family', 'work', ''])).toEqual(['family', 'work'])
    const a = buildCanonicalReferenceRecord({
      name: 'people', targetSig: SIG, requiredMarks: ['work', 'family'], requiredBouquet: BOUQUET,
    })
    const b = buildCanonicalReferenceRecord({
      name: 'people', targetSig: SIG, requiredMarks: ['family', 'work'], requiredBouquet: BOUQUET,
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

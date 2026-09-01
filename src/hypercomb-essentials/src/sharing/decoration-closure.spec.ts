// decoration-closure.spec.ts — the closure carries dependencies, never
// referents.
//
// Two guards pinned here, both descendants of the group-decoration 404
// cascade: a REFERENCE record hand-rolled without `buildReferenceRecord`
// still gets its `requiredBouquet` bytes carried (or a shared portal arrives
// with a demand nobody can expand), and `targetSig` — an identity pointer in
// every use it has — must never be auto-declared into a closure by the
// payload harvest (`writeDecoration` refs auto-declare rides on
// `collectSigsDeep`).

import { describe, expect, it, vi } from 'vitest'
import { collectSigsDeep, decorationClosureSigs } from './decoration-closure.js'

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)
const BOUQUET = SIG('b')
const TARGET = SIG('7')
const GROUP = SIG('9')

const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

describe('collectSigsDeep', () => {
  it('harvests sigs from values but never from targetSig or groupSig keys', () => {
    const sigs = collectSigsDeep({
      requiredBouquet: BOUQUET,
      targetSig: TARGET,
      groupSig: GROUP,
      nested: [{ targetSig: TARGET }],
    })
    expect(sigs).toContain(BOUQUET)
    expect(sigs).not.toContain(TARGET)
    expect(sigs).not.toContain(GROUP)
  })
})

describe('decorationClosureSigs — reference records', () => {
  const noFetch = async (): Promise<null> => null

  it('returns declared refs untouched (forward path)', async () => {
    const record = bytes({
      kind: 'reference', appliesTo: [],
      payload: { targetSegments: ['people'], requiredBouquet: BOUQUET },
      refs: [BOUQUET],
    })
    expect(await decorationClosureSigs(record, noFetch)).toEqual([BOUQUET])
  })

  it('falls back to payload.requiredBouquet when a hand-rolled record has no refs', async () => {
    const record = bytes({
      kind: 'reference', appliesTo: [],
      payload: { targetSegments: ['people'], targetSig: TARGET, requiredBouquet: BOUQUET },
    })
    expect(await decorationClosureSigs(record, noFetch)).toEqual([BOUQUET])
  })

  it('declares nothing for a plain reference — targetSig is a lineage address', async () => {
    const record = bytes({
      kind: 'reference', appliesTo: [],
      payload: { targetSegments: ['people'], targetSig: TARGET },
    })
    expect(await decorationClosureSigs(record, noFetch)).toEqual([])
  })

  it('never fetches — the reference closure is payload-resident', async () => {
    const fetchHtml = vi.fn(async () => null)
    await decorationClosureSigs(
      bytes({ kind: 'reference', appliesTo: [], payload: { requiredBouquet: BOUQUET } }),
      fetchHtml,
    )
    expect(fetchHtml).not.toHaveBeenCalled()
  })
})

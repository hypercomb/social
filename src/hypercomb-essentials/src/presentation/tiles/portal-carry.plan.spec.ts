// portal-carry.plan.spec.ts — a take carries the source page and the listed
// sig, never a cut.

import { describe, expect, it } from 'vitest'
import { takePayload } from './portal-carry.plan'

const SIG = 'c'.repeat(64)

describe('take payload', () => {
  it('carries the label, the SOURCE page, and the listed sig when known', () => {
    const here = ['business', 'people']
    expect(takePayload('ann', here, SIG)).toEqual({ label: 'ann', segments: here, sig: SIG })
    expect(takePayload('ann', here, null)).toEqual({ label: 'ann', segments: here })
  })

  it('marks an atom no page lists as loose: its sig is the only handle on it', () => {
    expect(takePayload('cut', [], SIG, true)).toEqual({ label: 'cut', segments: [], sig: SIG, loose: true })
  })

  it('copies the segments so a later navigation cannot rewrite a sent take', () => {
    const here = ['page']
    const sent = takePayload('tile', here)
    here.push('deeper')
    expect(sent.segments).toEqual(['page'])
  })
})

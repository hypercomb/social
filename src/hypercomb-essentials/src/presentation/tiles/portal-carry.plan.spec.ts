// portal-carry.plan.spec.ts — the handle's release: a Portals row still adds
// to that portal, the Portals window stages, and everywhere else is a take
// that carries the source page and the listed sig, never a cut.

import { describe, expect, it } from 'vitest'
import { planHandleRelease, takePayload } from './portal-carry.plan'

const SIG = 'c'.repeat(64)

describe('handle release', () => {
  it('over a Portals row adds to that portal', () => {
    expect(planHandleRelease({ portalKey: 'drafts', overIndex: true })).toEqual({ kind: 'portal', targetKey: 'drafts' })
  })

  it('over the Portals window stages', () => {
    expect(planHandleRelease({ portalKey: null, overIndex: true })).toEqual({ kind: 'stage' })
  })

  it('anywhere else is a take', () => {
    expect(planHandleRelease({})).toEqual({ kind: 'take' })
    expect(planHandleRelease({ portalKey: '', overIndex: false })).toEqual({ kind: 'take' })
  })
})

describe('take payload', () => {
  it('carries the label, the SOURCE page, and the listed sig when known', () => {
    const here = ['business', 'people']
    expect(takePayload('ann', here, SIG)).toEqual({ label: 'ann', segments: here, sig: SIG })
    expect(takePayload('ann', here, null)).toEqual({ label: 'ann', segments: here })
  })

  it('copies the segments so a later navigation cannot rewrite a sent take', () => {
    const here = ['page']
    const sent = takePayload('tile', here)
    here.push('deeper')
    expect(sent.segments).toEqual(['page'])
  })
})

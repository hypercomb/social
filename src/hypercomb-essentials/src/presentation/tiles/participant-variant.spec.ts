import { describe, expect, it } from 'vitest'

import { participantVariantVisual } from './participant-variant.js'

const POINT = 'a'.repeat(64)
const FLAT = 'b'.repeat(64)

describe('participantVariantVisual', () => {
  it('projects the selected participant as one complete visual, not an image-only mix', () => {
    const point = participantVariantVisual({
      small: { image: POINT },
      flat: { small: { image: FLAT } },
      border: { color: '#336699' },
      background: { color: '#102030' },
      tags: ['jazz', 'live'],
      link: 'https://example.test/alice',
      hideText: true,
      participant: true,
    }, false)

    expect(point).toEqual({
      imageSig: POINT,
      borderColor: [0.2, 0.4, 0.6],
      tags: ['jazz', 'live'],
      hasLink: true,
      hasSubstrate: false,
      hideText: true,
    })
    expect(participantVariantVisual({ small: { image: POINT }, flat: { small: { image: FLAT } } }, true).imageSig).toBe(FLAT)
  })

  it('never invents missing peer properties from a local fallback', () => {
    expect(participantVariantVisual({}, false)).toEqual({
      tags: [],
      hasLink: false,
      hasSubstrate: false,
      hideText: false,
    })
  })
})

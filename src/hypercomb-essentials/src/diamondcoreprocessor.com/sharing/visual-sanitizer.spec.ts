import { describe, expect, it } from 'vitest'

import { sanitizeVisual } from './visual-sanitizer.js'

const SMALL = 'a'.repeat(64)
const LARGE = 'b'.repeat(64)
const LAYER = 'c'.repeat(64)

describe('sanitizeVisual participant variants', () => {
  it('admits the complete inert editor projection and localized display titles', () => {
    expect(sanitizeVisual({
      name: 'people',
      layerSig: LAYER,
      small: { image: SMALL },
      large: { image: LARGE, x: 12, y: -3, scale: 1.4, code: '<script>' },
      flat: { small: { image: SMALL }, large: { x: 2, y: 4, scale: 0.8 } },
      background: { color: '#102030', style: 'url(javascript:bad)' },
      border: { color: '336699' },
      tags: ['music'],
      link: 'https://example.test/alice',
      hideText: true,
      participant: true,
      titles: { en: 'Alice People', ja: 'アリスの人々' },
      onclick: 'evil()',
    })).toEqual({
      name: 'people',
      layerSig: LAYER,
      small: { image: SMALL },
      large: { image: LARGE, x: 12, y: -3, scale: 1.4 },
      flat: { small: { image: SMALL }, large: { x: 2, y: 4, scale: 0.8 } },
      background: { color: '#102030' },
      border: { color: '336699' },
      tags: ['music'],
      link: 'https://example.test/alice',
      hideText: true,
      participant: true,
      titles: { en: 'Alice People', ja: 'アリスの人々' },
    })
  })

  it('keeps the identity name while dropping unsafe presentation text and colors', () => {
    expect(sanitizeVisual({
      name: 'people',
      titles: { en: 'bad\nlabel', '<script>': 'bad' },
      background: { color: 'url(javascript:bad)' },
      border: { color: 'red' },
    })).toEqual({ name: 'people' })
  })
})

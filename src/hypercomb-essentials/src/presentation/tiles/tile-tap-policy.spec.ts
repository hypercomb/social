import { describe, expect, it } from 'vitest'
import { clickNeedsCoordinateHitTest, resolveTilePress, usesTileCloseUp } from './tile-tap-policy.js'

describe('mobile tile tap policy', () => {
  it.each([
    { touch: true, mobile: false, reason: 'finger on a touch surface' },
    { touch: true, mobile: true, reason: 'finger on a phone' },
    { touch: false, mobile: true, reason: 'stylus or accessibility mouse on a phone' },
  ])('opens the close-up for a $reason', ({ touch, mobile }) => {
    expect(usesTileCloseUp(touch, mobile)).toBe(true)
  })

  it('leaves a desktop mouse on the direct desktop path', () => {
    expect(usesTileCloseUp(false, false)).toBe(false)
  })
})

describe('pressed tile binding', () => {
  const occupied = new Map([
    ['0,0', { label: 'first', index: 0 }],
    ['1,0', { label: 'second', index: 1 }],
  ])

  it('uses the pressed coordinate on the same render even when hover state may be stale', () => {
    expect(resolveTilePress(
      { generation: 7, axial: { q: 1, r: 0 }, label: 'second' },
      7,
      occupied,
    )).toEqual({ q: 1, r: 0, index: 1 })
  })

  it('swallows a same-generation click if the captured coordinate no longer names that tile', () => {
    expect(resolveTilePress(
      { generation: 7, axial: { q: 0, r: 0 }, label: 'second' },
      7,
      occupied,
    )).toBeNull()
  })

  it('follows the captured label when a render moves it during the gesture', () => {
    expect(resolveTilePress(
      { generation: 6, axial: { q: 9, r: 9 }, label: 'second' },
      7,
      occupied,
    )).toEqual({ q: 1, r: 0, index: 1 })
  })

  it('swallows a click when a rebuilt render no longer contains the pressed tile', () => {
    expect(resolveTilePress(
      { generation: 6, axial: { q: 9, r: 9 }, label: 'gone' },
      7,
      occupied,
    )).toBeNull()
  })

  it('freshly hit-tests an empty press instead of reusing the prior tile hover', () => {
    expect(clickNeedsCoordinateHitTest(null, { q: 1, r: 0 }, 1)).toBe(true)
  })

  it('does not replace a tile already bound from its pointerdown', () => {
    expect(clickNeedsCoordinateHitTest(
      { generation: 7, axial: { q: 1, r: 0 }, label: 'second' },
      { q: 1, r: 0 },
      1,
    )).toBe(false)
  })
})

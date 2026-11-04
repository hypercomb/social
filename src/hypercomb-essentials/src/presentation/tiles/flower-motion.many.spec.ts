// flower-motion.many.spec.ts — the many-tiles stack, as the hive draws it.
//
// When the quick menu's flower speaks for two or more tiles its middle is not
// the subject's tile but the stack (quickmenu/quick-menu.layer.ts FlowerCell
// `many`). show-cell pours it in plain honey and tile-name sets its glyph and
// count, both by these two decisions; it stays slot 0, so it never blooms.

import { describe, expect, it } from 'vitest'
import { bloomAt, flowerRingKey, flowerSlots, manyHoneyMode, pouredInHoney } from './flower-motion.js'

describe('which flower cells are poured in honey', () => {
  it('every option and the way back', () => {
    expect(pouredInHoney({ honey: true })).toBe(true)
    expect(pouredInHoney({ honey: true, back: true } as { honey: boolean })).toBe(true)
  })

  it('never the subject tile, nor a flower with no honey in it (the guide\'s ideas)', () => {
    expect(pouredInHoney({ subject: true })).toBe(false)
    expect(pouredInHoney({ subject: true, honey: true })).toBe(false)
    expect(pouredInHoney({ subject: true, honey: true, many: 1 })).toBe(false)
    expect(pouredInHoney({})).toBe(false)
  })

  it('the subject that stands for two or more tiles: the stack', () => {
    expect(pouredInHoney({ subject: true, honey: true, many: 2 })).toBe(true)
    expect(pouredInHoney({ subject: true, many: 5 })).toBe(false)
  })
})

describe('the stack\'s honey', () => {
  it('is plain honey at rest and the still pre-lit honey while the middle blinks, never the drip', () => {
    expect(manyHoneyMode(false)).toBe(3)
    expect(manyHoneyMode(undefined)).toBe(3)
    expect(manyHoneyMode(true)).toBe(5)
  })

  it('stays in the middle\'s slot, so it never blooms', () => {
    const cells = [
      { x: 0, y: 0, subject: true },
      { x: 10, y: 0 },
      { x: -10, y: 0 },
    ]
    const slots = flowerSlots(cells, false)
    expect(slots[0]).toBe(0)
    expect(bloomAt(0, slots[0])).toBe(1)
    expect(bloomAt(0, slots[1])).toBeLessThan(1)
  })

  it('is the same ring as long as the subject is: the count is not part of the key', () => {
    const ring = (many: number) => flowerRingKey([
      { q: 0, r: 0, label: 'sunrise', subject: true, honey: true, many } as { q: number; r: number; label: string; subject: boolean; honey: boolean },
      { q: 1, r: 0, label: 'images', honey: true },
    ])
    expect(ring(2)).toBe(ring(3))
  })
})

// The one rule this file exists to hold: a picture a person put on a tile
// is theirs forever, and nothing automatic may overwrite it. Every case
// below is a shape that reached a real hive and was mistaken for a default.

import { describe, expect, it } from 'vitest'
import { hasTileImage, isParticipantImage } from './tile-properties.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('picture ownership', () => {
  it('a tile with no picture belongs to nobody', () => {
    expect(hasTileImage({})).toBe(false)
    expect(hasTileImage({ index: 3, tags: ['x'] })).toBe(false)
    expect(isParticipantImage({})).toBe(false)
  })

  it('a substrate default is ours to move', () => {
    expect(isParticipantImage({ small: { image: A }, flat: { small: { image: B } }, substrate: true })).toBe(false)
  })

  it('an unmarked picture came from a person', () => {
    expect(isParticipantImage({ small: { image: A } })).toBe(true)
    expect(isParticipantImage({ imageSig: A })).toBe(true)
    expect(isParticipantImage({ flat: { small: { image: B } } })).toBe(true)
  })

  it('the mark is final', () => {
    expect(isParticipantImage({ small: { image: A }, participant: true })).toBe(true)
  })

  // THE REGRESSION. `writeTilePropertiesAt` merges over what is there, so an
  // edit on a once-defaulted tile inherited `substrate: true` — and a
  // hive-wide `/background <theme>.force-global` then re-dressed hand-made
  // tiles. The editor's full-resolution original is the proof of ownership,
  // and it outranks the inherited mark.
  it('an inherited substrate mark never outranks the original', () => {
    expect(isParticipantImage({
      small: { image: A },
      large: { image: B, x: -12, y: 40, scale: 1.4 },
      substrate: true,
    })).toBe(true)
  })

  it('junk in the picture keys is not a picture', () => {
    for (const junk of [{ small: { image: 'nope' } }, { imageSig: 42 }, { large: { image: null } }, null, 'x']) {
      expect(hasTileImage(junk)).toBe(false)
      expect(isParticipantImage(junk)).toBe(false)
    }
  })
})

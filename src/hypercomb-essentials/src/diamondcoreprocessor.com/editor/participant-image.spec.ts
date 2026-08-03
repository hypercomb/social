// The one rule this file exists to hold: a picture a person put on a tile
// is theirs forever, and nothing automatic may overwrite it. Every case
// below is a shape that reached a real hive and was mistaken for a default.

import { describe, expect, it } from 'vitest'
import { hasTileImage, isParticipantImage, withoutSubstrateImage } from './tile-properties.js'

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

  // Filler must not travel. A participant receiving someone else's default
  // sees it where their OWN default belongs, and it looks chosen.
  describe('what goes on the wire', () => {
    it('strips a default, keeping everything that is not the picture', () => {
      const out = withoutSubstrateImage({
        small: { image: A }, flat: { small: { image: B } }, substrate: true,
        index: 4, tags: ['x'], link: 'https://e.com',
      })
      expect(out).toEqual({ index: 4, tags: ['x'], link: 'https://e.com', substrate: true })
    })

    it('leaves a chosen picture completely alone', () => {
      const theirs = { small: { image: A }, flat: { small: { image: B } }, participant: true, index: 2 }
      expect(withoutSubstrateImage(theirs)).toBe(theirs)
      const preMark = { small: { image: A }, large: { image: B, x: 0, y: 0, scale: 1 }, substrate: true }
      expect(withoutSubstrateImage(preMark)).toBe(preMark)
    })

    it('keeps a flat bag that holds more than the picture', () => {
      const out = withoutSubstrateImage({
        small: { image: A }, flat: { small: { image: B }, large: { x: 1, y: 2, scale: 1 } }, substrate: true,
      })
      expect(out).toEqual({ flat: { large: { x: 1, y: 2, scale: 1 } }, substrate: true })
    })

    it('passes a tile with no picture straight through', () => {
      const bare = { index: 1, tags: [] }
      expect(withoutSubstrateImage(bare)).toBe(bare)
    })
  })

  it('junk in the picture keys is not a picture', () => {
    for (const junk of [{ small: { image: 'nope' } }, { imageSig: 42 }, { large: { image: null } }, null, 'x']) {
      expect(hasTileImage(junk)).toBe(false)
      expect(isParticipantImage(junk)).toBe(false)
    }
  })
})

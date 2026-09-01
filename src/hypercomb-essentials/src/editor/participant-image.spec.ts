// The one rule this file exists to hold: a picture a person put on a tile
// is theirs forever, and nothing automatic may overwrite it. Every case
// below is a shape that reached a real hive and was mistaken for a default.

import { describe, expect, it } from 'vitest'
import { hasTileImage, isParticipantImage, primaryTileImageSig, tilePictureCandidates, unframedTileImageSig, withoutSubstrateImage } from './tile-properties.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

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

  // A rectangle must never be handed a hex capture. The capture is cropped
  // to the hexagon's aspect over the tile's background colour, and every
  // tile saved through the editor before the frame stopped being baked
  // carries the gold hex stroke IN ITS PIXELS — fine on a rim, a gold
  // hexagon drawn across the middle of the picture anywhere else.
  describe('the picture a rectangle should show', () => {
    it('is the editor original when the tile has one', () => {
      expect(unframedTileImageSig({ small: { image: A }, large: { image: B, x: 0, y: 0, scale: 1 } })).toBe(B)
      // …and the hexagons still want the capture, framed for their shape.
      expect(primaryTileImageSig({ small: { image: A }, large: { image: B, x: 0, y: 0, scale: 1 } })).toBe(A)
    })

    it('falls back to the smalls when there is no original', () => {
      // A substrate default and an adopted peer picture are both smalls
      // with no `large` — and both are frameless anyway.
      expect(unframedTileImageSig({ small: { image: A }, substrate: true })).toBe(A)
      expect(unframedTileImageSig({ flat: { small: { image: B } } })).toBe(B)
      expect(unframedTileImageSig({ imageSig: A })).toBe(A)
    })

    it('offers the fallbacks in order, so a reader can take one it HOLDS', () => {
      // Adoption carries the props blob, not the heavy original — the
      // receiver names a `large` it does not have. A reader that took the
      // name on faith would paint a broken image where a framed one was.
      expect(tilePictureCandidates({
        large: { image: A }, small: { image: B }, flat: { small: { image: C } },
      })).toEqual([A, B, C])
      expect(tilePictureCandidates({ small: { image: B }, large: { image: 'nope' } })).toEqual([B])
      expect(tilePictureCandidates({ index: 1 })).toEqual([])
    })

    it('is nothing when the tile carries no picture', () => {
      expect(unframedTileImageSig({ index: 2, tags: ['x'] })).toBeUndefined()
      for (const junk of [{ large: { image: 'nope' } }, { large: { image: null } }, null, 'x', 42]) {
        expect(unframedTileImageSig(junk)).toBeUndefined()
      }
    })
  })

  it('junk in the picture keys is not a picture', () => {
    for (const junk of [{ small: { image: 'nope' } }, { imageSig: 42 }, { large: { image: null } }, null, 'x']) {
      expect(hasTileImage(junk)).toBe(false)
      expect(isParticipantImage(junk)).toBe(false)
    }
  })
})

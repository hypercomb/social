import { describe, expect, it } from 'vitest'
import { inheritTileProperties, sparseTileOverrides, TILE_PROPERTY_PINS } from './tile-property-inheritance.js'

describe('tile property inheritance', () => {
  it('uses root properties as defaults and lets the outer lineage replace them', () => {
    const rootImage = 'a'.repeat(64)
    const outerImage = 'b'.repeat(64)

    expect(inheritTileProperties(
      { imageSig: rootImage, border: { color: '#112233' }, tags: ['root'] },
      { imageSig: outerImage, tags: ['outer'] },
    )).toEqual({
      imageSig: outerImage,
      border: { color: '#112233' },
      tags: ['outer'],
    })
  })

  it('inherits Life incidences by signature without rewriting them', () => {
    const imageIncidence = 'c'.repeat(64)
    const inherited = inheritTileProperties(
      { small: { image: imageIncidence } },
      { index: 7 },
    )

    expect(inherited).toEqual({ small: { image: imageIncidence }, index: 7 })
    expect((inherited.small as { image: string }).image).toBe(imageIncidence)
  })

  it('does not materialize inherited defaults during an outer editor save', () => {
    const imageIncidence = 'd'.repeat(64)
    expect(sparseTileOverrides(
      { small: { image: imageIncidence }, border: { color: '#112233' } },
      { small: { image: imageIncidence }, border: { color: '#112233' }, index: 9 },
    )).toEqual({ index: 9 })
  })

  it('retains a pinned outer value even when it currently equals the root', () => {
    expect(sparseTileOverrides(
      { border: { color: '#112233' } },
      { border: { color: '#112233' }, [TILE_PROPERTY_PINS]: ['border'] },
    )).toEqual({
      border: { color: '#112233' },
      [TILE_PROPERTY_PINS]: ['border'],
    })
  })

  it('lets a pinned absent outer key suppress the root default', () => {
    expect(inheritTileProperties(
      { imageSig: 'e'.repeat(64), tags: ['root'] },
      { index: 3, [TILE_PROPERTY_PINS]: ['imageSig'] },
    )).toEqual({ index: 3, tags: ['root'], [TILE_PROPERTY_PINS]: ['imageSig'] })
  })

  it('lets an inner/root pin block an outer overwrite', () => {
    expect(inheritTileProperties(
      { imageSig: 'f'.repeat(64), [TILE_PROPERTY_PINS]: ['imageSig'] },
      { imageSig: '0'.repeat(64), index: 2 },
    )).toEqual({
      imageSig: 'f'.repeat(64),
      index: 2,
      [TILE_PROPERTY_PINS]: ['imageSig'],
    })
  })

  it('lets a pinned absent root key lock the property off', () => {
    expect(inheritTileProperties(
      { [TILE_PROPERTY_PINS]: ['imageSig'] },
      { imageSig: '0'.repeat(64), index: 2 },
    )).toEqual({ index: 2, [TILE_PROPERTY_PINS]: ['imageSig'] })
  })

  it('does not copy an inherited root pin into the sparse outer object', () => {
    expect(sparseTileOverrides(
      { imageSig: 'f'.repeat(64), [TILE_PROPERTY_PINS]: ['imageSig'] },
      { imageSig: 'f'.repeat(64), index: 4, [TILE_PROPERTY_PINS]: ['imageSig'] },
    )).toEqual({ index: 4 })
  })
})

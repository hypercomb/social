import { describe, expect, it } from 'vitest'
import { creationGlyph, freeCreationName, openHoles } from './layout-creations.js'
import {
  builtinLayout, composeLayout, nodeOf, withNodeAt, withVarAt,
} from './layout-template.js'

const rail = builtinLayout('rail')!
const split = builtinLayout('split')!
const bookends = builtinLayout('bookends')!

describe('a creation draws the design AS IT STANDS', () => {
  it('keeps every level\'s turn, and replaces every level\'s measurements', () => {
    // The two halves of a level's variables answer different questions. A
    // MEASURE is a length, and a length that made sense on a page is nonsense
    // in a 40px chip — so it is replaced. A CONFIGURATION is which way the
    // container runs, which IS the shape, so it is kept.
    const turned = withVarAt(nodeOf(rail, rail.vars), [], 'direction', 'column')
    const glyph = creationGlyph(turned)
    expect(glyph).toMatch(/flex-direction:column/)
    // The 14rem rail is asked for as a share instead: three chips wide is not
    // a rail, it is the whole chip.
    expect(glyph).toMatch(/--hc-layout-rail:22%/)
    expect(glyph).not.toMatch(/14rem/)
  })

  it('turns a NESTED level without turning the one above it', () => {
    const design = withVarAt(
      withNodeAt(nodeOf(split, {}), ['one'], nodeOf(split, {})),
      ['one'], 'direction', 'column')
    const glyph = creationGlyph(design)
    expect(glyph.match(/flex-direction:column/g)).toHaveLength(1)
    expect(glyph.match(/flex-direction:row/g)).toHaveLength(1)
  })

  it('draws the same arrangement the real container would', () => {
    // Not a second drawing routine: the chip and the page come from one pure
    // composer, so a chip cannot advertise a shape the design does not make.
    const design = withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(split, {}))
    const glyph = creationGlyph(design)
    const real = composeLayout(design).html
    const shape = (html: string): string[] =>
      [...html.matchAll(/data-hc-(?:container|hole)="([a-z-]+)"/g)].map(m => m[1])
    expect(shape(glyph)).toEqual(shape(real))
  })
})

describe('what a creation offers', () => {
  it('counts the holes still open — a filled one is not somewhere to drop', () => {
    // bookends: head | (body = the page) | tail → two open.
    expect(openHoles(nodeOf(bookends, bookends.vars))).toBe(2)
    // Nest a split in `head` and that hole stops being one: its own two are.
    expect(openHoles(withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(split, {}))))
      .toBe(3)
  })

  it('never takes a name a primitive answers to', () => {
    // One shelf shows both types, and which one a drop meant would otherwise
    // depend on lookup order.
    expect(freeCreationName('rail')).toBe('rail-2')
    expect(freeCreationName('bookends')).toBe('bookends-2')
    expect(freeCreationName('My Shell')).toBe('my-shell')
  })
})

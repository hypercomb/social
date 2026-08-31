import { describe, expect, it } from 'vitest'
import {
  assemble,
  containerFor,
  derivedContainer,
  isolate,
  slotsIn,
} from './division-assembly.js'
import { SLOT_ATTR, divisionPlan } from './visual-division.js'

const HERO = '<h1>Intake</h1><style>h1{color:red}</style>'

describe('the container a frame derives', () => {
  it('gives one hole per part', () => {
    expect(slotsIn(derivedContainer(divisionPlan(3, 'row'))!)).toEqual([0, 1, 2])
    expect(slotsIn(derivedContainer(divisionPlan(5, 'stack'))!)).toEqual([0, 1, 2, 3, 4])
  })

  it('has no container for a spiral — its holes are regions, not boxes', () => {
    expect(derivedContainer(divisionPlan(7, 'spiral'))).toBeNull()
    expect(derivedContainer(divisionPlan(7))).toBeNull()
  })

  it('is nothing when there is nothing to divide', () => {
    expect(derivedContainer(divisionPlan(0, 'row'))).toBeNull()
  })

  it('NEVER states a height — that omission is what makes a part portable', () => {
    for (const flow of ['stack', 'row', 'grid'] as const) {
      const html = derivedContainer(divisionPlan(4, flow))!
      expect(html).not.toMatch(/height/i)
      expect(html).not.toMatch(/\d+\s*px/)
    }
  })

  it('carries weight as proportion, never as size', () => {
    const html = derivedContainer(divisionPlan(2, 'row', [3, 1]))!
    expect(html).toContain('flex:3 1 0')
    expect(html).toContain('flex:1 1 0')
  })

  it('keeps a long unbroken word from bursting its track', () => {
    // min-width:0 in a flex track — without it one part's content decides
    // every other part's width, and the division stops dividing.
    expect(derivedContainer(divisionPlan(3, 'row'))!.match(/min-width:0/g)).toHaveLength(3)
  })

  it('names no part anywhere in the container', () => {
    const html = derivedContainer(divisionPlan(3, 'row'))!
    expect(html).not.toMatch(/[0-9a-f]{64}/)
    expect(slotsIn(html)).toEqual([0, 1, 2])
  })
})

describe('seating a part into a hole', () => {
  const container = derivedContainer(divisionPlan(3, 'row'))!

  it('fills the hole its position names', () => {
    const out = assemble(container, [{ index: 1, html: HERO }])
    expect(out).toContain(HERO)
    // and only that hole
    expect(out.match(/shadowrootmode/g)).toHaveLength(1)
  })

  it('leaves an unfilled hole exactly as the container drew it', () => {
    expect(assemble(container, [])).toBe(container)
    expect(assemble(container, [{ index: 0 }])).toBe(container)
  })

  it('never fails on a part that cannot be served — the page still renders', () => {
    const out = assemble(container, [{ index: 0, html: HERO }, { index: 2 }])
    expect(out).toContain(HERO)
    expect(slotsIn(out)).toEqual([0, 1, 2])
  })

  it('drops a fill the container declared no hole for', () => {
    const out = assemble(container, [{ index: 9, html: HERO }])
    expect(out).toBe(container)
  })

  it('does not clobber content a designer already put in a hole', () => {
    const authored = `<div ${SLOT_ATTR}="0">already here</div>`
    expect(assemble(authored, [{ index: 0, html: HERO }])).toBe(authored)
  })

  it('carries the part into a shadow root so it looks like itself anywhere', () => {
    const out = assemble(container, [{ index: 0, html: HERO }])
    expect(out).toContain('<template shadowrootmode="open">')
    // The part's own <style> travels INSIDE the boundary, so it cannot be
    // restyled by the page hosting it — and cannot leak onto it either.
    const inside = out.slice(out.indexOf('shadowrootmode'))
    expect(inside).toContain('<style>h1{color:red}</style>')
  })

  it('keeps the part’s text in the document, for a crawler with no JS', () => {
    const out = assemble(container, [{ index: 0, html: HERO }])
    expect(out).toContain('<h1>Intake</h1>')
  })

  it('is the same composition whoever runs it', () => {
    const once = assemble(container, [{ index: 0, html: HERO }])
    expect(assemble(container, [{ index: 0, html: HERO }])).toBe(once)
  })
})

describe('hand-authored containers', () => {
  it('are used in preference to the derived one', () => {
    const authored = `<main><section ${SLOT_ATTR}="0"></section></main>`
    const found = containerFor(divisionPlan(3, 'row'), authored)!
    expect(found.html).toBe(authored)
    expect(found.slots).toEqual([0])
  })

  it('fall back to the derived container when the whole has no page yet', () => {
    const found = containerFor(divisionPlan(2, 'stack'), null)!
    expect(found.slots).toEqual([0, 1])
  })

  it('read holes off any element, in any attribute order', () => {
    const authored = `<section class="a" ${SLOT_ATTR}='2' id="x"></section><div ${SLOT_ATTR}=0></div>`
    expect(slotsIn(authored)).toEqual([2, 0])
    expect(assemble(authored, [{ index: 2, html: HERO }])).toContain(HERO)
  })

  it('treat what they cannot understand as not a hole', () => {
    expect(slotsIn(`<div ${SLOT_ATTR}="hero"></div>`)).toEqual([])
    expect(slotsIn('')).toEqual([])
  })

  it('give a spiral frame no container even when nothing is authored', () => {
    expect(containerFor(divisionPlan(7, 'spiral'), null)).toBeNull()
  })
})

describe('isolation', () => {
  it('wraps a fragment declaratively — static HTML, no script needed', () => {
    expect(isolate('<p>x</p>')).toBe('<template shadowrootmode="open"><p>x</p></template>')
  })
})

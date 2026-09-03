import { describe, expect, it } from 'vitest'
import {
  BUILTIN_LAYOUTS,
  CONFIGURATION_AXES,
  QUARTER_TURNS,
  builtinLayout,
  composeLayout,
  configurationOf,
  nodeAt,
  nodeOf,
  withNodeAt,
  withVarAt,
  holeIndex,
  holeKeyAt,
  layoutTemplateRecord,
  memberHoles,
  parseLayoutTemplate,
  sanitizeVars,
  seatSelf,
  meaningsIn,
  meaningsOf,
  miniatureVars,
  sanitizeMarks,
  sanitizeMeaning,
  templateContainer,
  templateSlug,
  turnOf,
  turnedDirection,
  variablesOf,
  type LayoutTemplate,
} from './layout-template.js'
import { containerFor, slotsIn } from './division-assembly.js'
import { divisionPlan } from './visual-division.js'

const bookends = builtinLayout('bookends')!

/** A wrapping row with a full-width band at each end. Not in the library — a
 *  page shell is a `stack` with something nested in its middle — but a band is
 *  a real hole kind and this is where it is exercised. */
const banded = parseLayoutTemplate({
  kind: 'layout-template', version: 1, name: 'banded', flow: 'wrap',
  holes: [
    { key: 'top', fill: 'fixed', band: true },
    { key: 'left', fill: 'fixed' },
    { key: 'middle', fill: 'fluid' },
    { key: 'right', fill: 'fixed' },
    { key: 'bottom', fill: 'fixed', band: true },
  ],
  vars: { space: '0rem', padding: '0rem', top: '3.5rem', left: '4rem', right: '10rem', bottom: '1rem' },
})!

/** A column, parsed rather than built in. Every primitive is DRAWN as a row
 *  and turned to the other three quarters, so `flow: 'column'` is a shape a
 *  stored template may still declare and nothing in the library asks for. */
const columnFlow = parseLayoutTemplate({
  kind: 'layout-template', version: 1, name: 'column-flow', flow: 'column',
  holes: [{ key: 'top', fill: 'fixed' }, { key: 'body', fill: 'fluid' }],
  vars: { top: '3.5rem' },
})!

describe('the built-ins', () => {
  it('are six primitives, as data', () => {
    // There were twenty. Sixteen of them were another one turned, mirrored or
    // counted higher, and every one of those is a GESTURE now — a quarter-turn
    // or a primitive dropped into a primitive's hole.
    expect(BUILTIN_LAYOUTS).toHaveLength(6)
    expect(BUILTIN_LAYOUTS.map(t => t.name)).toEqual([
      'single', 'split', 'rail', 'thirds', 'bookends', 'measure',
    ])
  })

  it('go no further than three holes — the fourth is a nesting', () => {
    for (const template of BUILTIN_LAYOUTS) {
      expect(template.holes.length).toBeLessThanOrEqual(3)
    }
    // Four even shares is `split` with a `split` in each hole: the same
    // arrangement `quarters` used to be a chip for, and one the participant
    // keeps on the shelf under a name of their own.
    const four = withNodeAt(
      withNodeAt(nodeOf(builtinLayout('split')!, {}), ['one'], nodeOf(builtinLayout('split')!, {})),
      ['two'], nodeOf(builtinLayout('split')!, {}))
    expect(composeLayout(four).leaves).toHaveLength(4)
  })

  it('are every one of them ONE-DIMENSIONAL, and none of them wraps', () => {
    // A flexbox container has a single axis. Two dimensions is a container
    // with a container nested in one of its holes — which is the gesture the
    // designer exists for, and the only shape that is correct at every size.
    //
    // A wrapping row cannot give the remainder to one line, so it looks
    // finished at exactly one size. `wrap` stays a flow a stored template may
    // declare; nothing built in asks for it.
    for (const template of BUILTIN_LAYOUTS) {
      expect(template.flow).toBe('row')
      expect(template.holes.some(h => h.band)).toBe(false)
    }
  })

  it('every built-in mints and reads back as itself', () => {
    for (const template of BUILTIN_LAYOUTS) {
      expect(parseLayoutTemplate(layoutTemplateRecord(template))).toEqual(template)
      // And every one of them draws something.
      expect(templateContainer(template)).toMatch(/data-hc-container/)
    }
  })

  it('round-trip through the stored record unchanged — same shape, same sig', () => {
    for (const template of BUILTIN_LAYOUTS) {
      expect(parseLayoutTemplate(layoutTemplateRecord(template))).toEqual(template)
    }
  })

  it('name no SIDE, because a side stops being true the moment it is turned', () => {
    // `left-rail`, `right-rail`, `header-body` and `body-footer` were four
    // chips for one shape seen from four ends. They are `rail`, turned.
    for (const template of BUILTIN_LAYOUTS) {
      expect(template.name).not.toMatch(/left|right|top|bottom|header|footer/)
      for (const hole of template.holes) {
        expect(hole.key).not.toMatch(/left|right|top|bottom/)
      }
    }
  })

  it('names fold, so "Split" and "split" are one layout', () => {
    expect(templateSlug('Split')).toBe('split')
    expect(builtinLayout('Split')).toBe(builtinLayout('split'))
  })
})

describe('holes are an interface', () => {
  it('numbers only the MEMBER holes — a self hole is not one', () => {
    expect(memberHoles(bookends).map(h => h.key)).toEqual(['head', 'tail'])
    expect(holeKeyAt(bookends, 0)).toBe('head')
    expect(holeKeyAt(bookends, 1)).toBe('tail')
    expect(holeIndex(bookends, 'body')).toBe(-1)
  })

  it('so member positions do not shift when a template gains a self hole', () => {
    const without = parseLayoutTemplate({
      ...layoutTemplateRecord(bookends),
      holes: bookends.holes.map(h => ({ ...h, self: undefined })),
    })!
    expect(holeIndex(bookends, 'tail')).toBe(1)
    expect(holeIndex(without, 'tail')).toBe(2)
  })

  it('gives every member hole a slot index and the self hole none', () => {
    const html = templateContainer(bookends)
    expect(slotsIn(html)).toEqual([0, 1])
    expect(html.match(/data-hc-hole=/g)).toHaveLength(3)
    expect(html.match(/data-hc-self/g)).toHaveLength(1)
  })

  it('never states the cross axis on a hole — that is what makes a part fit', () => {
    // A row layout's holes declare flex only; an EXTENT on the cross axis
    // would refuse any part taller than the designer imagined. `min-height:0`
    // is the flex-track guard, not an extent.
    const html = templateContainer(bookends)
    expect(html).not.toMatch(/[^-]height:/)
  })

  it('a band takes the full line and its extent on the other axis', () => {
    const html = templateContainer(banded)
    // Shrinkable, like everything else — it was the last flex-shrink:0.
    expect(html).toMatch(/flex:0 1 100%;height:var\(--hc-layout-top,0px\)/)
    expect(html).toMatch(/flex:0 1 100%;height:var\(--hc-layout-bottom,0px\)/)
  })

  it('gives every track min-width:0 — one long word must not widen its share', () => {
    // Five holes plus the container itself.
    expect(templateContainer(banded).match(/min-width:0/g)).toHaveLength(6)
    // Every hole of every built-in, too — a missing one is a track that a long
    // unbroken word can blow out.
    for (const template of BUILTIN_LAYOUTS) {
      expect(templateContainer(template).match(/min-width:0/g))
        .toHaveLength(template.holes.length + 1)
    }
  })
})

describe('the variables', () => {
  it('are one unprefixed vocabulary, not one namespace per layout type', () => {
    for (const template of BUILTIN_LAYOUTS) {
      const html = templateContainer(template)
      expect(html).toMatch(/--hc-layout-space/)
      // What a per-layout namespace looks like, and why it cannot appear:
      // --split-space, --rail-space, --bookends-space each stop inheriting.
      expect(html).not.toMatch(/--(split|rail|bookends|measure)-/)
    }
  })

  it('are listed as the two universal ones plus one per FIXED hole', () => {
    expect(variablesOf(banded)).toEqual(['space', 'padding', 'top', 'left', 'right', 'bottom'])
    // A fluid hole takes the remainder, so it has nothing to set.
    expect(variablesOf(banded)).not.toContain('middle')
  })

  it('are declared only where they are overridden, so nesting inherits', () => {
    const root = templateContainer(bookends, bookends.vars)
    const nested = templateContainer(bookends, { space: '2rem' })
    expect(root).toMatch(/--hc-layout-head:10rem/)
    // The nested container says ONE thing. Everything else still falls through
    // from the container above it — which is exactly what a re-declared alias
    // would have broken.
    expect(nested).toMatch(/--hc-layout-space:2rem/)
    // A hole still READS its variable — that is the inheritance working. What
    // must not appear is a re-DECLARATION.
    expect(nested).not.toMatch(/--hc-layout-head:/)
    expect(nested).not.toMatch(/--hc-layout-padding:/)
  })

  it('space through gap and inset through padding — no margins, no resets', () => {
    const html = templateContainer(bookends)
    expect(html).toMatch(/gap:var\(--hc-layout-space,0\)/)
    expect(html).toMatch(/padding:var\(--hc-layout-padding,0\)/)
    expect(html).not.toMatch(/margin/)
  })

  it('fall back to 0 rather than to a guess', () => {
    expect(templateContainer(bookends, {})).toMatch(/gap:var\(--hc-layout-space,0\)/)
  })

  it('drop anything that is not a slug pointing at a length', () => {
    // Dropped, never folded: `bad;key` → `badkey` would be a variable nobody
    // wrote, sizing a hole nobody named.
    expect(sanitizeVars({ left: '10rem', 'bad;key': '1rem', right: 'red;}' }))
      .toEqual({ left: '10rem' })
    expect(sanitizeVars({ pad: 'calc(100% - 2rem)' })).toEqual({ pad: 'calc(100% - 2rem)' })
  })

  it('cannot break out of the style attribute', () => {
    const html = templateContainer(bookends, { head: '1rem;position:fixed' })
    expect(html).not.toMatch(/position:fixed/)
  })
})

describe('arity is data', () => {
  it('an eleven-hole layout needs no code — no nth-child anywhere', () => {
    const wide = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'wide', flow: 'row',
      holes: Array.from({ length: 11 }, (_, k) => ({ key: `h${k}`, fill: 'fluid' })),
      vars: {},
    })!
    const html = templateContainer(wide)
    expect(slotsIn(html)).toHaveLength(11)
    expect(html).not.toMatch(/nth-child/)
  })

  it('refuses a duplicate hole key — two holes on one variable is one hole', () => {
    const template = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'dup', flow: 'row',
      holes: [{ key: 'a', fill: 'fixed' }, { key: 'a', fill: 'fluid' }],
      vars: {},
    })!
    expect(template.holes).toHaveLength(1)
  })

  it('allows at most one self hole — a container has one page', () => {
    const template = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'two-selves', flow: 'row',
      holes: [
        { key: 'a', fill: 'fluid', self: true },
        { key: 'b', fill: 'fluid', self: true },
      ],
      vars: {},
    })!
    expect(template.holes.filter(h => h.self)).toHaveLength(1)
  })

  it('is null for anything that is not a template, so a dangling sig degrades', () => {
    expect(parseLayoutTemplate(null)).toBeNull()
    expect(parseLayoutTemplate({ kind: 'pattern', name: 'honeycomb' })).toBeNull()
    expect(parseLayoutTemplate({ kind: 'layout-template', name: 'x', flow: 'spiral', holes: [] })).toBeNull()
  })
})

describe('the container keeps its own page', () => {
  it('seats it into the self hole', () => {
    const out = seatSelf(templateContainer(bookends), '<p>mine</p>')
    expect(out).toMatch(/data-hc-self[^>]*><p>mine<\/p><\/div>/)
  })

  it('leaves a template without one exactly as drawn', () => {
    const fifty = builtinLayout('split')!
    const drawn = templateContainer(fifty)
    expect(seatSelf(drawn, '<p>mine</p>')).toBe(drawn)
  })

  it('is a no-op with nothing to seat', () => {
    const drawn = templateContainer(bookends)
    expect(seatSelf(drawn, '')).toBe(drawn)
  })
})

describe('containerFor — three sources, in order', () => {
  const plan = divisionPlan(3, 'row')
  const bound = { node: nodeOf(bookends, bookends.vars) }

  it('1. an authored page THAT DECLARES HOLES wins over everything', () => {
    const authored = '<main><div data-hc-slot="0"></div></main>'
    expect(containerFor(plan, authored, bound)!.html).toBe(authored)
  })

  it('2. a bound layout beats the derived container', () => {
    const out = containerFor(plan, '<p>page</p>', bound)!
    expect(out.html).toMatch(/data-hc-container="bookends"/)
    expect(out.slots).toEqual([0, 1])
  })

  it('   and the page it had goes in isolated, so it cannot restyle the frame', () => {
    const out = containerFor(plan, '<p>page</p>', bound)!
    expect(out.html).toMatch(/<template shadowrootmode="open"><p>page<\/p><\/template>/)
  })

  it('3. the derived container when nothing is bound — unchanged behaviour', () => {
    const out = containerFor(plan, '', null)!
    expect(out.html).toMatch(/data-hc-container="row"/)
    expect(out.slots).toEqual([0, 1, 2])
  })

  it('a page with no holes and no layout is still just the page', () => {
    expect(containerFor(plan, '<p>page</p>', null)!.html).toBe('<p>page</p>')
  })

  it('a spiral gets no container, bound or not — its holes are regions', () => {
    expect(containerFor(divisionPlan(7, 'spiral'), '', null)).toBeNull()
  })
})

describe('a layout holds nobody', () => {
  it('names no part anywhere in the container it draws', () => {
    // The whole point: a hole states a share of the axis. If a part name could
    // reach the container, the whole would depend on the part.
    const html = templateContainer(banded, banded.vars)
    for (const forbidden of ['sig', 'segments', 'lineage', 'cell']) {
      expect(html).not.toMatch(new RegExp(forbidden, 'i'))
    }
  })

  it('is the same bytes for the same shape — N targets are N references', () => {
    const a: LayoutTemplate = layoutTemplateRecord(bookends)
    const b: LayoutTemplate = layoutTemplateRecord(parseLayoutTemplate(layoutTemplateRecord(bookends))!)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('a layout nests in a hole, with or without content there', () => {
  const root = nodeOf(bookends, bookends.vars)

  it('numbers the LEAVES, so nesting never moves another seat', () => {
    // bookends: head | (body = its own page) | tail  →  leaves 0,1
    expect(composeLayout(root).leaves.map(l => l.key)).toEqual(['head', 'tail'])

    // Nest a three-way `thirds` in `head`. That hole stops being a seat and
    // its own three leaves take positions 0,1,2 — read off the finished
    // arrangement, which is the thing content is actually seated into.
    const nested = withNodeAt(root, ['head'], nodeOf(builtinLayout('thirds')!, {}))
    expect(composeLayout(nested).leaves.map(l => l.path.join('/')))
      .toEqual(['head/one', 'head/two', 'head/three', 'tail'])
  })

  it('nests to any depth', () => {
    let node = root
    let path: string[] = ['head']
    for (let depth = 0; depth < 5; depth++) {
      node = withNodeAt(node, path, nodeOf(builtinLayout('split')!, {}))
      path = [...path, 'one']
    }
    expect(nodeAt(node, ['head', 'one', 'one', 'one', 'one'])).not.toBeNull()
    expect(composeLayout(node).leaves.length).toBeGreaterThan(5)
  })

  it('needs nothing in the hole first — a shape is designed before it is filled', () => {
    const nested = withNodeAt(root, ['tail'], nodeOf(builtinLayout('split')!, {}))
    expect(nodeAt(nested, ['tail'])?.template.name).toBe('split')
  })

  it('takes one back out without touching anything else', () => {
    const nested = withNodeAt(root, ['head'], nodeOf(builtinLayout('thirds')!, {}))
    const back = withNodeAt(nested, ['head'], null)
    expect(composeLayout(back).leaves.map(l => l.key)).toEqual(['head', 'tail'])
  })

  it('refuses a path through a hole nothing is nested in', () => {
    // You cannot drop into a hole that is not on the screen, so a path naming
    // one is a caller bug — inventing the levels would hide it.
    expect(withNodeAt(root, ['head', 'deeper'], nodeOf(bookends, {}))).toBe(root)
  })

  it('only the ROOT keeps a self hole — there is one page here', () => {
    const nested = withNodeAt(root, ['head'], nodeOf(bookends, {}))
    expect(composeLayout(nested).html.match(/data-hc-self/g)).toHaveLength(1)
  })

  it('writes hole behaviour onto the element, so a border can say what it is', () => {
    const html = composeLayout(root).html
    expect(html).toMatch(/data-hc-hole="head"[^>]*data-hc-fill="fixed"/)
    expect(html).toMatch(/data-hc-hole="body"[^>]*data-hc-fill="fluid"/)
    expect(composeLayout(nodeOf(banded, banded.vars)).html).toMatch(/data-hc-band/)
  })

  it('addresses every hole by path', () => {
    const nested = withNodeAt(root, ['head'], nodeOf(builtinLayout('split')!, {}))
    expect(composeLayout(nested).html).toMatch(/data-hc-path="head\/two"/)
  })
})

describe('a nested level declares only its own changes', () => {
  it('so everything else keeps falling through from above', () => {
    // The root declares two measurements; the nested level changes ONE.
    const nested = withNodeAt(
      nodeOf(bookends, { ...bookends.vars, space: '1rem' }),
      ['head'], nodeOf(bookends, {}))
    const html = composeLayout(withVarAt(nested, ['head'], 'space', '2rem')).html

    // `space` is declared twice — once at each level that set it.
    expect(html.match(/--hc-layout-space:/g)).toHaveLength(2)
    // `head` is declared ONCE, at the root. The nested bookends has a `head`
    // hole too and says nothing about it: it reads the one above. That single
    // asymmetry is the entire inheritance model.
    expect(html.match(/--hc-layout-head:/g)).toHaveLength(1)
  })

  it('sets a variable on the level the path names and nowhere else', () => {
    const nested = withNodeAt(
      nodeOf(bookends, bookends.vars), ['head'], nodeOf(bookends, {}))
    const out = withVarAt(nested, ['head'], 'head', '3rem')
    expect(nodeAt(out, ['head'])?.vars['head']).toBe('3rem')
    expect(out.vars['head']).toBe('10rem')
  })
})

describe('a layout is extended with data, never with fields', () => {
  const withBag = parseLayoutTemplate({
    kind: 'layout-template', version: 1, name: 'bagged', flow: 'row',
    marks: ['Full Bleed', 'quiet', 'quiet'],
    holes: [
      { key: 'rail', fill: 'fixed', vars: { align: 'center', overflow: 'auto', tint: '40%' } },
      { key: 'body', fill: 'fluid' },
    ],
    vars: { rail: '12rem' },
  })!

  it('resolves the two properties it reads from scoped variables', () => {
    const html = templateContainer(withBag)
    expect(html).toMatch(/align-self:var\(--hc-layout-rail-align,auto\)/)
    expect(html).toMatch(/overflow:var\(--hc-layout-rail-overflow,visible\)/)
    // The fallbacks are the CSS defaults, so a hole that says nothing behaves
    // exactly as it did before the bag existed.
    expect(templateContainer(builtinLayout('split')!))
      .toMatch(/align-self:var\(--hc-layout-one-align,auto\)/)
  })

  it('declares every OTHER name for whatever is seated there to read', () => {
    // `tint` means nothing to this file. It is written anyway, scoped to the
    // hole — a custom property crosses a declarative shadow boundary, so the
    // part styles itself from the hole it is sitting in.
    expect(templateContainer(withBag)).toMatch(/--hc-layout-rail-tint:40%/)
  })

  it('cannot break out of the style attribute through a hole bag', () => {
    const nasty = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'nasty', flow: 'row',
      holes: [{ key: 'a', fill: 'fluid', vars: { align: 'center;position:fixed' } }],
      vars: {},
    })!
    expect(templateContainer(nasty)).not.toMatch(/position:fixed/)
  })

  it('carries marks as ONE attribute value, folded and sorted', () => {
    const html = templateContainer(withBag)
    expect(html).toMatch(/data-hc-mark="full-bleed quiet"/)
    expect(sanitizeMarks(['b', 'a', 'a'])).toEqual(['a', 'b'])
  })

  it('cannot close the attribute through a mark', () => {
    // Folded to a slug before it is ever escaped — two independent reasons it
    // cannot become an attribute of its own.
    const marks = sanitizeMarks(['" onclick=alert(1) x'])
    expect(marks.join(' ')).not.toMatch(/["=]/)
    const template = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'x', flow: 'row',
      holes: [{ key: 'a', fill: 'fluid', marks: ['" onclick=alert(1)'] }],
      vars: {},
    })!
    const html = templateContainer(template)
    // The letters survive INSIDE the value — `onclick-alert-1` is a label, and
    // a label is inert. What must not exist is an ATTRIBUTE: no `onclick=`,
    // and the quote never closes early.
    expect(html).not.toMatch(/\sonclick\s*=/)
    expect(html).toMatch(/data-hc-mark="onclick-alert-1"/)
  })

  it('never lets data name an attribute — the emitted set is fixed', () => {
    const html = templateContainer(withBag)
    const names = [...html.matchAll(/\s([a-zA-Z-]+)=/g)].map(m => m[1])
    for (const name of new Set(names)) {
      expect([
        'data-hc-container', 'data-hc-slot', 'data-hc-hole', 'data-hc-path',
        'data-hc-fill', 'data-hc-band', 'data-hc-mark', 'style',
      ]).toContain(name)
    }
  })

  it('mints the same record whatever order the bags were written in', () => {
    const one = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'o', flow: 'row',
      marks: ['b', 'a'], holes: [{ key: 'a', fill: 'fluid' }], vars: {},
    })!
    const two = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'o', flow: 'row',
      marks: ['a', 'b'], holes: [{ key: 'a', fill: 'fluid' }], vars: {},
    })!
    expect(JSON.stringify(layoutTemplateRecord(one)))
      .toBe(JSON.stringify(layoutTemplateRecord(two)))
  })
})

describe('a hole always fits the space it is allotted', () => {
  it('a fixed hole holds its measure UNTIL it does not fit, then gives way', () => {
    // flex-shrink 1, not 0. Zero is the obvious reading of "fixed" and it is
    // wrong at every scale but one: two 10rem rails in a 34px chip overflow by
    // 286px, silently, because flex overflow does not clip.
    expect(templateContainer(bookends)).toMatch(/flex:0 1 var\(--hc-layout-head,0px\)/)
    expect(templateContainer(bookends)).toMatch(/flex:0 1 var\(--hc-layout-tail,0px\)/)
  })

  it('a wrapping container fills its box rather than packing to the top', () => {
    // Without this the bands draw at their measure and the body line collapses
    // to its own content height, leaving the arrangement sitting in the top of
    // whatever space it was given.
    expect(templateContainer(banded)).toMatch(/align-content:stretch/)
    // Every container now states its whole configuration, resolved — a
    // single-axis flow simply has no lines for `align-content` to act on.
    expect(templateContainer(bookends)).toMatch(/flex-wrap:nowrap/)
    expect(templateContainer(columnFlow)).toMatch(/flex-direction:column/)
  })

  it('a band is clamped to the line it was given', () => {
    const html = templateContainer(banded)
    expect(html).toMatch(/height:var\(--hc-layout-top,0px\);max-height:100%/)
    expect(html).toMatch(/height:var\(--hc-layout-bottom,0px\);max-height:100%/)
  })

  it('refuses a band on a flow that cannot break a line', () => {
    // `flex-basis: 100%` of the main axis is exact in `wrap`, where the band is
    // alone on its line, and an unconditional overflow in a nowrap row where
    // every sibling is added on top of it. The type said `wrap` only; a stored
    // record is data, not a type, so the parser is where it is enforced.
    const column = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'col', flow: 'column',
      holes: [{ key: 'rail', fill: 'fixed', band: true }, { key: 'body', fill: 'fluid' }],
      vars: { rail: '10rem' },
    })!
    expect(column.holes[0].band).toBeUndefined()
    expect(templateContainer(column)).not.toMatch(/flex:0 1 100%/)
  })

  it('bounds the container itself, at every depth', () => {
    // Every other rule here is about the holes. Without these the CONTAINER is
    // the thing that overflows, and it does so at every level of nesting.
    for (const template of BUILTIN_LAYOUTS) {
      const html = templateContainer(template)
      expect(html).toMatch(/max-width:100%/)
      expect(html).toMatch(/overflow:var\(--hc-layout-overflow,visible\)/)
    }
  })

  it('a miniature asks for shares, so the arrangement reads at any size', () => {
    // Not a special case and not a CSS override: the same layout, given
    // measurements suited to the space. A rail declared at 10rem is three
    // times a 34-pixel chip.
    expect(miniatureVars(bookends)).toEqual({
      // `overflow: hidden` is the block axis: `max-width:100%` clamps every
      // width case, but an auto-height chain has no percentage to clamp
      // against, so the one box with a definite height says so.
      space: '1px', padding: '0rem', overflow: 'hidden',
      head: '22%', tail: '22%',
    })
    // A fluid hole takes the remainder and needs no measurement at any scale.
    expect(miniatureVars(bookends)).not.toHaveProperty('body')
  })

  it('gives every fixed hole in every built-in a share', () => {
    for (const template of BUILTIN_LAYOUTS) {
      const vars = miniatureVars(template)
      for (const hole of template.holes) {
        if (hole.fill === 'fixed') expect(vars[hole.key]).toBe('22%')
      }
      // No hole EXTENT survives as an absolute length — a zero gutter is
      // still zero at any size, which is why `padding` is exempt.
      for (const hole of template.holes) {
        if (vars[hole.key]) expect(vars[hole.key]).toMatch(/%$/)
      }
      expect(vars['overflow']).toBe('hidden')
    }
  })
})

describe('the flex configuration is data, and it does not inherit', () => {
  it('takes its defaults from the flow, which is shorthand for two axes', () => {
    expect(configurationOf(builtinLayout('split')!))
      .toEqual({ direction: 'row', wrap: 'nowrap', justify: 'flex-start', align: 'stretch', alignContent: 'stretch' })
    expect(configurationOf(columnFlow).direction).toBe('column')
    expect(configurationOf(banded).wrap).toBe('wrap')
  })

  it('lets a variable win over the flow', () => {
    const config = configurationOf(builtinLayout('split')!, {
      direction: 'column', justify: 'space-between', align: 'center',
    })
    expect(config.direction).toBe('column')
    expect(config.justify).toBe('space-between')
    expect(config.align).toBe('center')
  })

  it('drops a value that is not in the vocabulary, leaving the default', () => {
    // Default-deny: a closed list is why no keyword here can carry anything
    // into a style attribute.
    const config = configurationOf(builtinLayout('split')!, {
      direction: 'sideways', justify: 'red;position:fixed', align: '',
    })
    expect(config.direction).toBe('row')
    expect(config.justify).toBe('flex-start')
    expect(config.align).toBe('stretch')
    expect(templateContainer(builtinLayout('split')!, { justify: 'red;position:fixed' }))
      .not.toMatch(/position:fixed/)
  })

  it('is RESOLVED on each container, so a column nested in a row stays a column', () => {
    // The one deliberate asymmetry in the model. If direction inherited,
    // nesting a column inside a row — the entire point of nesting — would be
    // impossible.
    const nested = withNodeAt(
      nodeOf(builtinLayout('split')!, { direction: 'row' }),
      ['one'],
      nodeOf(builtinLayout('split')!, { direction: 'column' }),
    )
    const html = composeLayout(nested).html
    expect(html.match(/flex-direction:row/g)).toHaveLength(1)
    expect(html.match(/flex-direction:column/g)).toHaveLength(1)
    // And nothing about the configuration is written as a variable, which is
    // what would let it fall through.
    expect(html).not.toMatch(/--hc-layout-direction/)
  })

  it('states every axis on every container, so nothing is left to resolve', () => {
    for (const template of BUILTIN_LAYOUTS) {
      const html = templateContainer(template)
      for (const property of [
        'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
      ]) {
        expect(html).toMatch(new RegExp(`${property}:`))
      }
    }
  })
})

describe('a layout is drawn one way and turned to the other three', () => {
  it('spells the four quarters clockwise, from ONE list', () => {
    expect(QUARTER_TURNS).toEqual(['row', 'column', 'row-reverse', 'column-reverse'])
    // The rotation IS the direction vocabulary rather than a second copy of
    // it: two lists of the same four values eventually disagree, and the day
    // somebody tidies one into alphabetical order a turn stops being a
    // quarter.
    expect(CONFIGURATION_AXES.find(axis => axis.name === 'direction')?.values)
      .toEqual(QUARTER_TURNS)
  })

  it('draws every primitive at quarter zero', () => {
    for (const template of BUILTIN_LAYOUTS) {
      expect(turnOf(template)).toBe(0)
    }
  })

  it('turns one quarter at a time, and comes round', () => {
    expect(turnedDirection(bookends)).toBe('column')
    expect(turnedDirection(bookends, { direction: 'column' })).toBe('row-reverse')
    expect(turnedDirection(bookends, { direction: 'row-reverse' })).toBe('column-reverse')
    expect(turnedDirection(bookends, { direction: 'column-reverse' })).toBe('row')
    // And backwards, so a turn is undone by turning rather than by counting
    // to three.
    expect(turnedDirection(bookends, {}, -1)).toBe('column-reverse')
  })

  it('starts from where a container STANDS, not from how it was drawn', () => {
    // A level that has never been turned is at the quarter its flow implies.
    // Computing from `row` regardless would make the first press on a column
    // land back where it started.
    expect(turnOf(columnFlow)).toBe(1)
    expect(turnedDirection(columnFlow)).toBe('row-reverse')
  })

  it('REWRITES NOTHING ABOUT A HOLE ON THE WAY ROUND', () => {
    // This is the whole reason the library draws one way. A hole never states
    // its cross axis, so a fixed hole's `flex-basis` is a WIDTH in a row and a
    // HEIGHT in a column from the same bytes — the browser's own flexbox does
    // the work, and a turned container is laid out exactly as it would have
    // been if it had been drawn that way to begin with.
    const row = templateContainer(bookends, bookends.vars)
    const turned = templateContainer(bookends, { ...bookends.vars, direction: 'column' })

    const holesOf = (html: string): string[] =>
      [...html.matchAll(/<div [^>]*data-hc-hole[^>]*>/g)].map(match => match[0])
    expect(holesOf(turned)).toEqual(holesOf(row))
    // The ONE difference anywhere in the container is the axis it runs on.
    expect(row).toMatch(/flex-direction:row/)
    expect(turned).toMatch(/flex-direction:column/)
    expect(turned.replace('flex-direction:column', 'flex-direction:row')).toBe(row)
  })

  it('is a fact about ONE container, so it does not fall through', () => {
    // Turning a level must not turn what is nested in it — nesting a column
    // inside a row is the entire point of nesting, and it is why the
    // configuration is resolved on each container instead of inherited.
    const nested = withNodeAt(
      nodeOf(bookends, bookends.vars), ['head'], nodeOf(builtinLayout('split')!, {}))
    const html = composeLayout(withVarAt(nested, [], 'direction', 'column')).html
    expect(html.match(/flex-direction:column/g)).toHaveLength(1)
    expect(html.match(/flex-direction:row/g)).toHaveLength(1)
    // And it is never published as a custom property, which is what would let
    // it fall through.
    expect(html).not.toMatch(/--hc-layout-direction/)
  })

  it('is what makes four old chips one primitive', () => {
    // `left-rail`, `right-rail`, `header-body` and `body-footer` were four
    // arrangements of one shape. Each is `rail` at a different quarter, and
    // the measured hole takes its measure on whichever axis it lands on.
    const rail = builtinLayout('rail')!
    const drawn = new Set(
      QUARTER_TURNS.map(direction => templateContainer(rail, { ...rail.vars, direction })))
    expect(drawn.size).toBe(4)
    for (const html of drawn) {
      expect(html).toMatch(/flex:0 1 var\(--hc-layout-rail,0px\)/)
    }
  })
})

describe('a hole says what belongs in it, and names nobody', () => {
  const withMeaning = parseLayoutTemplate({
    kind: 'layout-template', version: 1, name: 'page', flow: 'row',
    holes: [
      { key: 'rail', fill: 'fixed', meaning: 'site:navigation' },
      { key: 'body', fill: 'fluid', meaning: 'Site: Main Article' },
      { key: 'aside', fill: 'fixed' },
    ],
    vars: { rail: '10rem', aside: '10rem' },
  })!

  it('folds a conventional name, so one spelling is one meaning', () => {
    expect(sanitizeMeaning('Site: Main Article')).toBe('site:main-article')
    expect(withMeaning.holes[1].meaning).toBe('site:main-article')
  })

  it('refuses an unscoped name — a bare word is one somebody else is using', () => {
    // The colon is what keeps a name agreed across hives that never
    // coordinate from colliding with everything else named by a bare word.
    expect(sanitizeMeaning('masthead')).toBe('')
    expect(sanitizeMeaning(':nothing')).toBe('')
    expect(sanitizeMeaning('site:')).toBe('')
    const bare = parseLayoutTemplate({
      kind: 'layout-template', version: 1, name: 'x', flow: 'row',
      holes: [{ key: 'a', fill: 'fluid', meaning: 'masthead' }], vars: {},
    })!
    expect(bare.holes[0].meaning).toBeUndefined()
  })

  it('states the name on the hole, and the address only when one is resolved', () => {
    // Without a resolver the hole keeps its meaning and gets no target: a hole
    // nobody can fill YET, which is not the same as a broken one.
    const plain = templateContainer(withMeaning)
    expect(plain).toMatch(/data-hc-meaning="site:navigation"/)
    expect(plain).not.toMatch(/data-hc-target/)

    const addressed = templateContainer(withMeaning, undefined,
      meaning => meaning === 'site:navigation' ? 'a'.repeat(64) : undefined)
    expect(addressed).toMatch(/data-hc-meaning="site:navigation" data-hc-target="a{64}"/)
    // The one it could not resolve still states what it is for.
    expect(addressed).toMatch(/data-hc-meaning="site:main-article"/)
    expect(addressed.match(/data-hc-target/g)).toHaveLength(1)
  })

  it('says nothing at all for a hole that is for nothing in particular', () => {
    const html = templateContainer(withMeaning)
    const aside = html.slice(html.indexOf('data-hc-hole="aside"'))
    expect(aside).not.toMatch(/data-hc-meaning/)
  })

  it('collects every name in an arrangement, to any depth, for one resolve pass', () => {
    expect(meaningsOf(withMeaning)).toEqual(['site:navigation', 'site:main-article'])
    const nested = withNodeAt(nodeOf(withMeaning, {}), ['rail'], nodeOf(withMeaning, {}))
    // Deduped: the same name twice is one address to resolve.
    expect(meaningsIn(nested)).toEqual(['site:navigation', 'site:main-article'])
  })

  it('carries the meaning onto the leaf, so a seater can ask what fits', () => {
    const leaves = composeLayout(nodeOf(withMeaning, {})).leaves
    expect(leaves.map(l => l.meaning))
      .toEqual(['site:navigation', 'site:main-article', undefined])
  })
})

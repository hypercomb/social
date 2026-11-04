// quick-menu.overlay.spec.ts — the honey ring in a DOM.
//
//   · a menu is built once, whole: shared defs with ids unique per menu, every
//     reference resolving inside its own svg, a bounded node count
//   · the gesture builds nothing: paint, highlight, cancel and the centre
//     override create no elements, and a state that did not change writes nothing
//   · rest is calm, lit moves one drip, back and cancel are bare of honey, and
//     reduced motion never starts the drip
//   · a word with no drawing is text-only; the label is the only rewritten text

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { QuickMenuOverlay } from './quick-menu.overlay.js'
import {
  HONEY, LAYOUT, SHEEN, backIcon, backgroundFor, bloomDelayMs, cancelIcon, emptyIcon, HONEY_STYLE_ID, manyIcon, motionFor,
  sheenDelayS, sheenZones,
} from './quick-menu.honey.js'
import type { HoneyArt } from './quick-menu.honey-art.js'
import { iconPath } from './quick-menu.icons.js'
import type { QuickMenuDefinition, QuickMenuDirection } from './quick-menu.types.js'

const registry = new QuickMenuRegistry()
const labelOf = (slot: { label: string }): string => slot.label
const ROOT = registry.byName('root') as QuickMenuDefinition
const VIEW = registry.byName('root:view') as QuickMenuDefinition

let overlay: QuickMenuOverlay
let reduced = false

type Pending = { cb: (service: unknown) => void }
let themeWaiters: Pending[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.querySelector(`#${HONEY_STYLE_ID}`)?.remove()
  document.documentElement.style.removeProperty('--md-is-light')
  reduced = false
  themeWaiters = []
  vi.useFakeTimers()
  // jsdom has no canvas: a stand-in that measures half an em per character.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const context = { font: '', measureText: (text: string) => ({ width: text.length * parseFloat(context.font.split('px')[0].replace('400 ', '')) * 0.5 }) }
    return context as unknown as CanvasRenderingContext2D
  } as never)
  ;(globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({ matches: reduced && query.includes('reduce') })
  ;(globalThis as { ioc?: unknown }).ioc = {
    get: () => undefined,
    whenReady: (_key: string, cb: (service: unknown) => void) => { themeWaiters.push({ cb }) },
  }
  overlay = new QuickMenuOverlay()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const slotGroups = (svg: SVGSVGElement): SVGGElement[] =>
  [...svg.children].filter(c => c.tagName === 'g' && c.querySelector('text')) as SVGGElement[]

function paint(definition = ROOT, back: QuickMenuDirection | null = null): SVGSVGElement {
  overlay.warm([definition], labelOf)
  overlay.paint(definition, { x: 300, y: 300 }, back, labelOf, 'back')
  return document.querySelector('#hc-quick-menu svg') as SVGSVGElement
}

/** The slot group whose label is `word`. */
function slot(svg: SVGSVGElement, word: string): SVGGElement {
  const found = slotGroups(svg).find(g => g.querySelector('text')?.textContent === word)
  if (!found) throw new Error(`no slot "${word}"`)
  return found
}

const part = (g: Element, selector: string): Element => g.querySelector(selector) as Element
const isLit = (g: Element): boolean => (part(g, '.hc-qm-lit') as SVGElement).style.opacity === '1'
const running = (g: Element): boolean => part(g, '.hc-qd').classList.contains('hc-qd-run')
const iconShown = (g: Element): boolean => part(g, '.hc-qm-ico').getAttribute('display') !== 'none'

describe('the built menu', () => {
  it('builds one svg of seven slots with its defs inside', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    expect(slotGroups(svg)).toHaveLength(7)
    const defs = svg.querySelector('defs') as SVGDefsElement
    expect(defs).toBeTruthy()
    const names = [...defs.querySelectorAll('[id]')].map(e => e.id.replace(/^hq\d+-/, ''))
    for (const wanted of ['body', 'lit', 'back', 'backlit', 'cancel', 'bloom', 'lip', 'bead', 'men', 'trn', 'sliv', 'hex']) {
      expect(names).toContain(wanted)
    }
  })

  it('resolves every url(#id) inside its own svg', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    const ids = new Set([...svg.querySelectorAll('[id]')].map(e => e.id))
    const refs: string[] = []
    for (const el of svg.querySelectorAll('*')) {
      for (const attr of ['fill', 'stroke', 'clip-path']) {
        const match = el.getAttribute(attr)?.match(/^url\(#([^)]+)\)$/)
        if (match) refs.push(match[1])
      }
    }
    expect(refs.length).toBeGreaterThan(40)
    for (const ref of refs) expect(ids.has(ref), ref).toBe(true)
  })

  it('gives every menu its own ids, so two never collide in one document', () => {
    const a = overlay.ensure(ROOT, labelOf).svg
    const b = overlay.ensure(VIEW, labelOf).svg
    const idsOf = (svg: Element): string[] => [...svg.querySelectorAll('[id]')].map(e => e.id)
    const shared = idsOf(a).filter(id => idsOf(b).includes(id))
    expect(shared).toEqual([])
    expect(new Set(idsOf(a)).size).toBe(idsOf(a).length)
  })

  it('stays within a node budget', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    expect(svg.querySelectorAll("*").length).toBeLessThan(300)
    // and no filter, blur, mask or pattern anywhere
    for (const tag of ['filter', 'feGaussianBlur', 'mask', 'pattern']) expect(svg.querySelectorAll(tag)).toHaveLength(0)
  })

  it('builds once and hands back the same subtree', () => {
    expect(overlay.ensure(ROOT, labelOf)).toBe(overlay.ensure(ROOT, labelOf))
  })

  it('writes one document stylesheet, once', () => {
    overlay.warm([ROOT, VIEW], labelOf)
    new QuickMenuOverlay().warm([ROOT], labelOf)
    expect(document.querySelectorAll(`#${HONEY_STYLE_ID}`)).toHaveLength(1)
  })

  it('warms the first menu now and the rest one idle tick each', () => {
    const all = registry.all()
    overlay.warm(all, labelOf)
    // the first is ready at once; each other menu waits for its own tick
    const svgs = new Set<unknown>([overlay.ensure(all[0], labelOf)])
    expect(svgs.size).toBe(1)
    const ns = vi.spyOn(document, 'createElementNS')
    vi.advanceTimersByTime(0)
    const afterOne = ns.mock.calls.length
    vi.runAllTimers()
    expect(ns.mock.calls.length).toBeGreaterThan(afterOne)
    // by the end every menu is built, and asking again builds nothing
    ns.mockClear()
    for (const d of all) overlay.ensure(d, labelOf)
    expect(ns).not.toHaveBeenCalled()
  })

  it('marks every decorative node aria-hidden and keeps the words readable', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    expect(svg.getAttribute('aria-hidden')).toBeNull()
    expect(svg.getAttribute('role')).toBe('group')
    expect(svg.getAttribute('aria-label')).toBe('Hive')
    for (const g of slotGroups(svg)) {
      expect(part(g, '.hc-hq').getAttribute('aria-hidden')).toBe('true')
      expect(part(g, '.hc-qm-ico').getAttribute('aria-hidden')).toBe('true')
      expect(part(g, 'text').getAttribute('aria-hidden')).toBeNull()
      expect(part(g, 'text').textContent).toBeTruthy()
    }
  })

  it('lays the icon over the label in the specified places', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    const tags = slot(svg, 'shelf')
    expect(part(tags, '.hc-qm-ico').getAttribute('transform')).toBe('translate(-12,-21)')
    expect(part(tags, 'text').getAttribute('y')).toBe('19')
    expect(part(tags, 'text').getAttribute('font-size')).toBe('11.5')
    expect(part(tags, 'text').getAttribute('font-weight')).toBe('400')
    expect(part(tags, 'text').getAttribute('letter-spacing')).toBe('0.02em')
    const centre = slot(svg, 'command')
    expect(part(centre, '.hc-qm-ico').getAttribute('transform')).toBe('translate(-14,-24) scale(1.1667)')
    expect(part(centre, 'text').getAttribute('y')).toBe('21')
    expect(part(tags, '.hc-qm-ico path').getAttribute('d')).toBe(iconPath('bookmark'))
  })

  it('lays out the honey in the specified stack', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    const g = slot(svg, 'shelf')
    const order = [...g.children].map(c => c.getAttribute('class') ?? c.tagName)
    const at = (name: string): number => order.findIndex(c => c.includes(name))
    expect(at('hc-qm-base')).toBeLessThan(at('hc-qm-lit'))
    expect(at('hc-qm-lit')).toBeLessThan(at('hc-hq'))
    expect(at('hc-hq')).toBeLessThan(at('hc-qm-rim'))
    expect(at('hc-qm-rim')).toBeLessThan(at('hc-qm-ico'))
    expect(at('hc-qm-ico')).toBeLessThan(at('hc-qm-ink'))
    // the lit polygon is the only thing that fades
    expect((part(g, '.hc-qm-lit') as SVGElement).style.opacity).toBe('0')
  })

  it('keeps the drip B nodes on their own keyframes: neck, bead with its shade and glint, a drop', () => {
    const { svg } = overlay.ensure(ROOT, labelOf)
    const g = slot(svg, 'shelf')
    const drip = part(g, '.hc-qd')
    expect(drip.querySelectorAll('.hc-qd-drip > .hc-qd-neck')).toHaveLength(1)
    expect(drip.querySelectorAll('.hc-qd-drip > .hc-qd-bead')).toHaveLength(2) // the bead and its shade
    expect(drip.querySelectorAll('.hc-qd-drip > .hc-qd-glint')).toHaveLength(1)
    expect(drip.querySelectorAll('.hc-qd-blob')).toHaveLength(1)
    // every animated node knows where it pivots, in slot-local units
    for (const el of drip.querySelectorAll('.hc-qd-drip, .hc-qd-neck, .hc-qd-bead, .hc-qd-glint, .hc-qd-blob')) {
      expect(el.getAttribute('style')).toMatch(/transform-origin:-?[\d.]+px -?[\d.]+px/)
    }
    expect(part(g, '.hc-qd-neck').getAttribute('style')).toMatch(/--sy-swell:[\d.]+;--sy-neck:[\d.]+/)
    // at rest the drop is invisible
    expect(part(g, '.hc-qd-blob').getAttribute('opacity')).toBe('0')
  })

  it('differs by slot but not by open: the same slot looks the same every time', () => {
    const first = overlay.ensure(ROOT, labelOf).svg
    const lips = slotGroups(first).map(g => part(g, '.hc-hq path[fill$="-lip)"]').getAttribute('d'))
    expect(new Set(lips).size).toBe(7)
    const again = new QuickMenuOverlay().ensure(ROOT, labelOf).svg
    expect(slotGroups(again).map(g => part(g, '.hc-hq path[fill$="-lip)"]').getAttribute('d'))).toEqual(lips)
  })
})

describe('on the gesture', () => {
  it('creates no element while painting, lighting, arming or overriding', () => {
    overlay.warm([ROOT], labelOf)
    const ns = vi.spyOn(document, 'createElementNS')
    const el = vi.spyOn(document, 'createElement')
    overlay.paint(ROOT, { x: 300, y: 300 }, 'west', labelOf, 'back')
    overlay.highlight('east')
    overlay.highlight('southwest')
    overlay.highlight('west')
    overlay.highlight('centre')
    overlay.setCursor(10, 12)
    overlay.setCancelArmed(true)
    overlay.setCancelArmed(false)
    overlay.setCentreOverride('a tile name that is long')
    overlay.setCentreOverride(null)
    overlay.highlight(null)
    overlay.clear()
    expect(ns).not.toHaveBeenCalled()
    expect(el).not.toHaveBeenCalled()
  })

  it('writes nothing when a state did not change', () => {
    const svg = paint()
    overlay.highlight('east')
    const writes = vi.spyOn(Element.prototype, 'setAttribute')
    overlay.setCentreOverride('same')
    writes.mockClear()
    overlay.setCentreOverride('same') // textContent again, but the slot's state is unchanged
    expect(writes).not.toHaveBeenCalled()
    expect(svg.isConnected).toBe(true)
  })

  it('does not rewrite a lit slot that is lit again', () => {
    paint()
    overlay.highlight('east')
    const writes = vi.spyOn(Element.prototype, 'setAttribute')
    overlay.highlight('east')
    expect(writes).not.toHaveBeenCalled()
  })

  it('rewrites only the label text node, never the icon or the shape', () => {
    const svg = paint()
    const g = slot(svg, 'shelf')
    const before = part(g, '.hc-qm-ico path').getAttribute('d')
    overlay.highlight('southeast')
    expect(part(g, '.hc-qm-ico path').getAttribute('d')).toBe(before)
    expect(part(g, 'text').textContent).toBe('shelf')
  })
})

describe('states', () => {
  it('REST is calm: honey on, nothing moving, cream ink', () => {
    const svg = paint()
    const g = slot(svg, 'shelf')
    expect(part(g, '.hc-hq').getAttribute('display')).toBeNull()
    expect(isLit(g)).toBe(false)
    expect(running(g)).toBe(false)
    expect(part(g, 'text').getAttribute('fill')).toBe(HONEY.ink.rest)
    expect(part(g, '.hc-qm-ico path').getAttribute('fill')).toBe(HONEY.ink.rest)
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.steel)
    expect(part(g, '.hc-qm-base').getAttribute('fill')).toMatch(/-body\)$/)
    expect(part(g, '.hc-qm-base').getAttribute('fill-opacity')).toBe('0.92')
  })

  it('LIT lifts the body, turns the rim gold, flips the ink and runs one drip', () => {
    const svg = paint()
    overlay.highlight('southeast')
    const g = slot(svg, 'shelf')
    expect(isLit(g)).toBe(true)
    expect(part(g, '.hc-qm-lit').getAttribute('fill')).toMatch(/-lit\)$/)
    expect(part(g, '.hc-qm-lit').getAttribute('stroke-opacity')).toBe('0.22')
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.lit.rim)
    expect(part(g, '.hc-qm-rim').getAttribute('stroke-width')).toBe('1.6')
    expect(part(g, 'text').getAttribute('fill')).toBe(HONEY.ink.lit)
    expect(part(g, '.hc-qm-ico path').getAttribute('fill')).toBe(HONEY.ink.lit)
    expect(running(g)).toBe(true)
    expect(Number(part(g, 'path[stroke-linecap]').getAttribute('stroke-opacity'))).toBeGreaterThan(0.6)
    expect(part(g, 'circle[fill="#fffaf0"]').getAttribute('r')).toBe(HONEY.glint.rLit.toFixed(2))
    // exactly one slot is lit and exactly one drip runs
    expect(slotGroups(svg).filter(isLit)).toHaveLength(1)
    expect(slotGroups(svg).filter(running)).toHaveLength(1)
  })

  it('returns a tile that stops being lit to its frozen rest pose', () => {
    const svg = paint()
    overlay.highlight('southeast')
    overlay.highlight('east')
    const tags = slot(svg, 'shelf')
    expect(isLit(tags)).toBe(false)
    expect(running(tags)).toBe(false)
    expect(part(tags, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.steel)
    expect(part(tags, 'text').getAttribute('fill')).toBe(HONEY.ink.rest)
    expect(part(tags, 'circle[fill="#fffaf0"]').getAttribute('r')).toBe(HONEY.glint.rRest.toFixed(2))
    expect(isLit(slot(svg, 'collections'))).toBe(true)
  })

  it('never starts the drip under reduced motion, and says so', () => {
    reduced = true
    const svg = paint()
    overlay.highlight('southeast')
    const g = slot(svg, 'shelf')
    expect(svg.getAttribute('data-motion')).toBe('still')
    expect(isLit(g)).toBe(true) // lit is rim, luminance and ink: not motion
    expect(running(g)).toBe(false)
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.lit.rim)
  })

  it('reads reduced motion at every paint', () => {
    const svg = paint()
    overlay.highlight('southeast')
    expect(running(slot(svg, 'shelf'))).toBe(true)
    overlay.clear()
    reduced = true
    overlay.paint(ROOT, { x: 300, y: 300 }, null, labelOf, 'back')
    overlay.highlight('southeast')
    expect(running(slot(svg, 'shelf'))).toBe(false)
    expect(svg.getAttribute('data-motion')).toBe('still')
  })

  it('BACK is crystallised: no honey, dashed dim rim, arrow_back, its own ramp', () => {
    // organize declares northeast ('done'); a nested ring paints its way back there
    const def = registry.byName('selection:organize') as QuickMenuDefinition
    overlay.warm([def], labelOf)
    overlay.paint(def, { x: 300, y: 300 }, 'northeast', labelOf, 'back')
    const ring = document.querySelector('#hc-quick-menu svg') as SVGSVGElement
    const g = slot(ring, 'back')
    expect(part(g, '.hc-hq').getAttribute('display')).toBe('none')
    expect(part(g, '.hc-qm-rim').getAttribute('stroke-dasharray')).toBe('4 4')
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.back.rim)
    expect(part(g, '.hc-qm-base').getAttribute('fill')).toMatch(/-back\)$/)
    expect(part(g, '.hc-qm-ico path').getAttribute('d')).toBe(iconPath(backIcon))
    expect(part(g, 'text').getAttribute('fill')).toBe(HONEY.ink.back)
    expect(running(g)).toBe(false)
    // the other slots keep their honey
    expect(part(slot(ring, 'arrange'), '.hc-hq').getAttribute('display')).toBeNull()
  })

  it('BACK LIT keeps the dashes and lights the back ramp without gold or drips', () => {
    const def = registry.byName('selection:organize') as QuickMenuDefinition
    overlay.warm([def], labelOf)
    overlay.paint(def, { x: 300, y: 300 }, 'northeast', labelOf, 'back')
    overlay.highlight('northeast')
    const g = slot(document.querySelector('#hc-quick-menu svg') as SVGSVGElement, 'back')
    expect(isLit(g)).toBe(true)
    expect(part(g, '.hc-qm-lit').getAttribute('fill')).toMatch(/-backlit\)$/)
    expect(part(g, '.hc-qm-lit').getAttribute('stroke-opacity')).toBe('0')
    expect(part(g, '.hc-qm-rim').getAttribute('stroke-dasharray')).toBe('4 4')
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.back.rimLit)
    expect(part(g, '.hc-hq').getAttribute('display')).toBe('none')
    expect(running(g)).toBe(false)
    // and a back slot comes off again cleanly
    overlay.highlight('east')
    expect(isLit(g)).toBe(false)
  })

  it('CANCEL is burnt honey: brick rim, close glyph, the word cancel, no honey', () => {
    const svg = paint()
    overlay.cancelLabel = 'cancel'
    overlay.setCancelArmed(true)
    const g = slot(svg, 'cancel')
    expect(part(g, '.hc-hq').getAttribute('display')).toBe('none')
    expect(part(g, '.hc-qm-base').getAttribute('fill')).toMatch(/-cancel\)$/)
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.cancel.rim)
    expect(part(g, '.hc-qm-ico path').getAttribute('d')).toBe(iconPath(cancelIcon))
    expect(part(g, 'text').getAttribute('fill')).toBe(HONEY.ink.cancel)
    expect(iconShown(g)).toBe(true)
    // the cue acts on the rim alone
    overlay.highlight('centre')
    expect(part(g, '.hc-qm-rim').getAttribute('stroke-opacity')).toBe('1')
    expect(running(g)).toBe(false)
    // disarming restores the verb, its glyph and its honey
    overlay.setCancelArmed(false)
    expect(part(g, 'text').textContent).toBe('command')
    expect(part(g, '.hc-qm-ico path').getAttribute('d')).toBe(iconPath('terminal'))
    expect(part(g, '.hc-hq').getAttribute('display')).toBeNull()
  })

  it('CENTRE OVERRIDE shows the word text-only and puts the icon back on clear', () => {
    const svg = paint()
    overlay.setCentreOverride('a very long tile name')
    const g = slot(svg, 'a very long…')
    expect(iconShown(g)).toBe(false)
    expect(part(g, 'text').getAttribute('y')).toBe(String(LAYOUT.textOnly.labelY))
    overlay.setCentreOverride(null)
    expect(part(g, 'text').textContent).toBe('command')
    expect(iconShown(g)).toBe(true)
    expect(part(g, 'text').getAttribute('y')).toBe('21')
    // the next summon never inherits a per-summon word
    overlay.setCentreOverride('mine')
    overlay.paint(ROOT, { x: 300, y: 300 }, null, labelOf, 'back')
    expect(part(g, 'text').textContent).toBe('command')
    expect(iconShown(g)).toBe(true)
  })

  it('THE MANY-TILES RING draws the stack in its middle: the hive glyph, the count, never lit', () => {
    const many = registry.byName('selection:many') as QuickMenuDefinition
    const svg = paint(many)
    // six cells: the five verbs and the stack the definition does not declare
    expect(slotGroups(svg)).toHaveLength(6)
    overlay.setCentreMany(3)
    const g = slot(svg, '3 tiles')
    expect(iconShown(g)).toBe(true)
    expect(part(g, '.hc-qm-ico path').getAttribute('d')).toBe(iconPath(manyIcon))
    // the middle is where the pointer rests, and the stack still never lights
    overlay.highlight('centre')
    expect(isLit(g)).toBe(false)
    expect(running(g)).toBe(false)
    // leaving the dead zone makes it the way out, and coming home the stack again
    overlay.setCancelArmed(true)
    expect(part(g, 'text').textContent).toBe('cancel')
    overlay.setCancelArmed(false)
    expect(part(g, 'text').textContent).toBe('3 tiles')
    // the next summon starts from the built middle
    overlay.paint(many, { x: 300, y: 300 }, null, labelOf, 'back')
    expect(part(g, 'text').textContent).toBe('tiles')
  })

  it('no other ring gains a middle it did not declare', () => {
    const edit = registry.byName('selection:edit') as QuickMenuDefinition
    expect(slotGroups(paint(edit))).toHaveLength(edit.slots.length)
  })
})

describe('the crafted backgrounds', () => {
  /** The pictures as quick-menu.honey-art.ts hands them over, minus the drawing. */
  function art(failed: readonly number[] = []): HoneyArt {
    return {
      count: 10, width: 280, height: 322, pad: 2,
      ready: Array.from({ length: 10 }, (_, i) => !failed.includes(i)),
      atlas: document.createElement('canvas'),
      rest: Array.from({ length: 10 }, (_, i) => (failed.includes(i) ? null : `blob:rest-${i}`)),
      lit: Array.from({ length: 10 }, (_, i) => (failed.includes(i) ? null : `blob:lit-${i}`)),
      texture: null,
    }
  }
  const href = (g: Element, which: '.hc-qm-art' | '.hc-qm-art-lit'): string | null => g.querySelector(which)?.getAttribute('href') ?? null
  const litShown = (g: Element): boolean => (part(g, '.hc-qm-art-lit') as SVGElement).style.opacity === '1'
  const DIRECTIONS: readonly QuickMenuDirection[] = ['centre', 'east', 'southeast', 'southwest', 'west', 'northwest', 'northeast']

  it('dresses every option in its own background: none twice in a ring, each the one backgroundFor names', () => {
    overlay.useArt(art())
    const { svg } = overlay.ensure(ROOT, labelOf)
    const worn = slotGroups(svg).map(g => href(g, '.hc-qm-art'))
    expect(new Set(worn).size).toBe(7)
    const expected = DIRECTIONS.map(d => `blob:rest-${backgroundFor(ROOT.name, d)}`)
    expect(new Set(worn)).toEqual(new Set(expected))
    for (const g of slotGroups(svg)) {
      const rest = href(g, '.hc-qm-art')!
      expect(href(g, '.hc-qm-art-lit')).toBe(rest.replace('rest', 'lit'))
      // the picture is the whole point-top tile, clipped to the hexagon by a
      // frame that never moves; inside it the picture drifts
      const image = part(g, '.hc-qm-art')
      expect([image.getAttribute('x'), image.getAttribute('y'), image.getAttribute('width'), image.getAttribute('height')]).toEqual(['-40', '-46', '80', '92'])
      expect(image.parentElement?.getAttribute('class')).toBe('hc-qm-drift')
      expect(image.parentElement?.parentElement?.getAttribute('clip-path')).toMatch(/^url\(#hq\d+-hex\)$/)
      expect(image.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('replaces the procedural lip, bloom and sliver, and hangs the drip from the wall', () => {
    overlay.useArt(art())
    const { svg } = overlay.ensure(ROOT, labelOf)
    const g = slot(svg, 'shelf')
    expect(g.querySelector('path[fill$="-lip)"]')).toBeNull()
    expect(g.querySelector('[fill$="-bloom)"]')).toBeNull()
    expect(g.querySelector('[stroke$="-sliv)"]')).toBeNull()
    const honey = part(g, '.hc-hq')
    expect(honey.getAttribute('clip-path')).toMatch(/-hex\)$/)
    expect(honey.firstElementChild?.getAttribute('transform')).toMatch(/^translate\(0,-\d+(\.\d+)?\)$/)
    // the stack: base, the framed picture (rest under its lit copy), lit halo,
    // the light, drip, rim
    const order = [...g.children].map(c => c.getAttribute('class') ?? c.tagName)
    const at = (name: string): number => order.indexOf(name)
    expect(at('hc-qm-base')).toBeLessThan(at('hc-qm-frame'))
    const drift = [...part(g, '.hc-qm-drift').children].map(c => c.getAttribute('class'))
    expect(drift).toEqual(['hc-qm-art', 'hc-qm-art-lit'])
    expect(at('hc-qm-frame')).toBeLessThan(at('hc-qm-lit'))
    expect(at('hc-qm-lit')).toBeLessThan(at('hc-qm-sheen'))
    expect(at('hc-qm-sheen')).toBeLessThan(at('hc-hq'))
    expect(at('hc-hq')).toBeLessThan(at('hc-qm-rim'))
  })

  it('REST shows the picture and nothing else moves', () => {
    overlay.useArt(art())
    const svg = paint()
    const g = slot(svg, 'shelf')
    expect(part(g, '.hc-qm-art').getAttribute('display')).toBeNull()
    expect(litShown(g)).toBe(false)
    expect(part(g, '.hc-hq').getAttribute('display')).toBe('none')
    expect(running(g)).toBe(false)
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.steel)
    expect(part(g, 'text').getAttribute('fill')).toBe(HONEY.ink.rest)
  })

  it('LIT fades the pre-lit copy in, keeps the halo and gold rim, flips the ink, runs one drip', () => {
    overlay.useArt(art())
    const svg = paint()
    overlay.highlight('southeast')
    const g = slot(svg, 'shelf')
    expect(litShown(g)).toBe(true)
    expect(isLit(g)).toBe(true)
    expect(part(g, '.hc-qm-lit').getAttribute('fill')).toBe('none')
    expect(part(g, '.hc-qm-lit').getAttribute('stroke-opacity')).toBe(String(HONEY.lit.haloAlpha))
    expect(part(g, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.lit.rim)
    expect(part(g, 'text').getAttribute('fill')).toBe(HONEY.ink.lit)
    expect(part(g, '.hc-hq').getAttribute('display')).toBeNull()
    expect(running(g)).toBe(true)
    expect(slotGroups(svg).filter(litShown)).toHaveLength(1)
    // and back to rest
    overlay.highlight('east')
    expect(litShown(g)).toBe(false)
    expect(running(g)).toBe(false)
  })

  it('reduced motion lights the picture and never runs the drip', () => {
    reduced = true
    overlay.useArt(art())
    const svg = paint()
    overlay.highlight('southeast')
    const g = slot(svg, 'shelf')
    expect(litShown(g)).toBe(true)
    expect(running(g)).toBe(false)
  })

  it('BACK and CANCEL put the picture away and keep their own honey', () => {
    overlay.useArt(art())
    const def = registry.byName('selection:organize') as QuickMenuDefinition
    overlay.warm([def], labelOf)
    overlay.paint(def, { x: 300, y: 300 }, 'northeast', labelOf, 'back')
    const ring = document.querySelector('#hc-quick-menu svg') as SVGSVGElement
    const back = slot(ring, 'back')
    expect(part(back, '.hc-qm-art').getAttribute('display')).toBe('none')
    expect(part(back, '.hc-qm-art-lit').getAttribute('display')).toBe('none')
    expect(part(back, '.hc-qm-base').getAttribute('fill')).toMatch(/-back\)$/)
    const root = paint()
    overlay.cancelLabel = 'cancel'
    overlay.setCancelArmed(true)
    const centre = slot(root, 'cancel')
    expect(part(centre, '.hc-qm-art').getAttribute('display')).toBe('none')
    expect(part(centre, '.hc-qm-base').getAttribute('fill')).toMatch(/-cancel\)$/)
    overlay.setCancelArmed(false)
    expect(part(centre, '.hc-qm-art').getAttribute('display')).toBeNull()
  })

  it('a variation that failed to draw leaves its slot in the procedural honey', () => {
    const centreArt = backgroundFor(ROOT.name, 'centre')
    overlay.useArt(art([centreArt]))
    const { svg } = overlay.ensure(ROOT, labelOf)
    const centre = slot(svg, 'command')
    expect(centre.querySelector('.hc-qm-art')).toBeNull()
    expect(centre.querySelector('path[fill$="-lip)"]')).not.toBeNull()
    expect(slot(svg, 'shelf').querySelector('.hc-qm-art')).not.toBeNull()
  })

  it('pictures that arrive after warm rebuild what was warm, off the gesture', () => {
    overlay.warm([ROOT], labelOf)
    vi.runAllTimers()
    const before = overlay.ensure(ROOT, labelOf)
    expect(before.svg.querySelector('.hc-qm-art')).toBeNull()
    overlay.useArt(art())
    vi.runAllTimers()
    const after = overlay.ensure(ROOT, labelOf)
    expect(after).not.toBe(before)
    expect(after.svg.querySelectorAll('.hc-qm-art')).toHaveLength(7)
  })

  it('writes each tile\'s motion once, at build: its bloom, its drift, its turn for the light', () => {
    overlay.useArt(art())
    const { svg } = overlay.ensure(ROOT, labelOf)
    for (const [i, direction] of DIRECTIONS.entries()) {
      const g = slotGroups(svg).find(s => s.querySelector('.hc-qm-art')?.getAttribute('href') === `blob:rest-${backgroundFor(ROOT.name, direction)}`)!
      expect(g.getAttribute('class')).toBe('hc-qm-slot')
      expect(g.getAttribute('style')).toContain(`--hc-qm-bloom-delay:${bloomDelayMs(i)}ms`)
      const m = motionFor(backgroundFor(ROOT.name, direction), i)
      const drift = part(g, '.hc-qm-drift').getAttribute('style')!
      expect(drift).toContain(`--hc-qm-drift-period:${m.periodS}s`)
      expect(drift).toContain(`--hc-qm-dx:${m.dx}px`)
      expect(part(g, '.hc-qm-sheen').getAttribute('style')).toBe(`--hc-qm-sheen-delay:${sheenDelayS(i)}s`)
      // one band per region, the cap first
      const bands = [...g.querySelectorAll('.hc-qm-sheen-band')]
      expect(bands).toHaveLength(sheenZones().length)
      expect(bands[0].getAttribute('fill-opacity')).toBe(String(SHEEN.inkRest))
      expect(bands.at(-1)!.getAttribute('fill-opacity')).toBe(String(SHEEN.peakRest))
    }
  })

  it('the light is a touch stronger on the lit tile, and gone from back and cancel', () => {
    overlay.useArt(art())
    const svg = paint()
    overlay.highlight('southeast')
    const tags = slot(svg, 'shelf')
    const bands = [...tags.querySelectorAll('.hc-qm-sheen-band')]
    expect(bands[0].getAttribute('fill-opacity')).toBe(String(SHEEN.inkLit))
    expect(bands.at(-1)!.getAttribute('fill-opacity')).toBe(String(SHEEN.peakLit))
    expect(part(tags, '.hc-qm-sheen').getAttribute('display')).toBeNull()
    overlay.highlight('east')
    expect(bands.at(-1)!.getAttribute('fill-opacity')).toBe(String(SHEEN.peakRest))
    overlay.cancelLabel = 'cancel'
    overlay.setCancelArmed(true)
    expect(part(slot(svg, 'cancel'), '.hc-qm-sheen').getAttribute('display')).toBe('none')
    const def = registry.byName('selection:organize') as QuickMenuDefinition
    overlay.warm([def], labelOf)
    overlay.paint(def, { x: 300, y: 300 }, 'northeast', labelOf, 'back')
    const ring = document.querySelector('#hc-quick-menu svg') as SVGSVGElement
    expect(part(slot(ring, 'back'), '.hc-qm-sheen').getAttribute('display')).toBe('none')
  })

  it('under reduced motion the ring is still: the stylesheet only moves a live ring', () => {
    reduced = true
    overlay.useArt(art())
    const svg = paint()
    expect(svg.getAttribute('data-motion')).toBe('still')
    reduced = false
    overlay.clear()
    overlay.paint(ROOT, { x: 300, y: 300 }, null, labelOf, 'back')
    expect(svg.getAttribute('data-motion')).toBe('live')
  })

  it('the gesture still builds nothing', () => {
    overlay.useArt(art())
    overlay.warm([ROOT], labelOf)
    const ns = vi.spyOn(document, 'createElementNS')
    const el = vi.spyOn(document, 'createElement')
    overlay.paint(ROOT, { x: 300, y: 300 }, 'west', labelOf, 'back')
    overlay.highlight('east')
    overlay.highlight('centre')
    overlay.setCancelArmed(true)
    overlay.setCancelArmed(false)
    overlay.highlight(null)
    overlay.clear()
    expect(ns).not.toHaveBeenCalled()
    expect(el).not.toHaveBeenCalled()
  })
})

describe('the drawn pointer', () => {
  const cursor = (svg: SVGSVGElement): Element => svg.lastElementChild as Element

  it('is not drawn on the middle tile\'s icon at the moment of summoning', () => {
    const svg = paint()
    expect(cursor(svg).getAttribute('display')).toBe('none')
  })

  it('appears with the first movement and goes again when the ring is painted afresh', () => {
    const svg = paint()
    overlay.setCursor(6, -4)
    expect(cursor(svg).hasAttribute('display')).toBe(false)
    expect(cursor(svg).getAttribute('transform')).toMatch(/^translate\(/)
    overlay.paint(ROOT, { x: 300, y: 300 }, null, labelOf, 'back')
    expect(cursor(svg).getAttribute('display')).toBe('none')
  })
})

describe('label fits follow the web font', () => {
  /** document.fonts, enough of it to say 'loadingdone'. */
  function stubFonts(): EventTarget {
    const fonts = new EventTarget()
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    return fonts
  }
  afterEach(() => { Reflect.deleteProperty(document, 'fonts') })

  it('measures again when a face arrives after the first warm', () => {
    const fonts = stubFonts()
    overlay.warm([ROOT], labelOf)
    vi.runAllTimers()
    const before = overlay.ensure(ROOT, labelOf)
    fonts.dispatchEvent(new Event('loadingdone'))
    fonts.dispatchEvent(new Event('loadingdone')) // a burst is one rewarm
    vi.runAllTimers()
    const after = overlay.ensure(ROOT, labelOf)
    expect(after).not.toBe(before)
  })

  it('watches the fonts once, however often it is warmed', () => {
    const fonts = stubFonts()
    const add = vi.spyOn(fonts, 'addEventListener')
    overlay.warm([ROOT], labelOf)
    overlay.warm([ROOT, VIEW], labelOf)
    expect(add).toHaveBeenCalledTimes(1)
  })
})

describe('the centre override is fitted by measure, never stretched', () => {
  /** Every character a full em wide, as a CJK name is. */
  let measured = 0
  function wide(): void {
    measured = 0
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function () {
      const context = { font: '', measureText: (text: string) => { measured++; return { width: [...text].length * parseFloat(context.font.split('px')[0].replace('400 ', '')) } } }
      return context as unknown as CanvasRenderingContext2D
    } as never)
  }

  it('cuts a name too wide even at the floor with an ellipsis, and sets no textLength', () => {
    wide()
    const svg = paint()
    overlay.setCentreOverride('日本語のタイル名前です')
    const text = part(slotGroups(svg).find(g => part(g, '.hc-qm-ico').getAttribute('display') === 'none') as Element, 'text')
    expect(text.textContent!.endsWith('…')).toBe(true)
    expect([...text.textContent!].length).toBeLessThan(10)
    expect(text.hasAttribute('textLength')).toBe(false)
    expect(Number(text.getAttribute('font-size'))).toBeGreaterThanOrEqual(LAYOUT.floorSize)
  })

  it('leaves a name that fits alone', () => {
    const svg = paint()
    overlay.setCentreOverride('mine')
    expect(slot(svg, 'mine').querySelector('text')!.hasAttribute('textLength')).toBe(false)
  })

  it('measures once per name: the same name again is a lookup', () => {
    wide()
    paint()
    overlay.setCentreOverride('日本語のタイル名前です')
    const after = measured
    expect(after).toBeGreaterThan(0)
    overlay.setCentreOverride(null)
    overlay.setCentreOverride('日本語のタイル名前です')
    expect(measured).toBe(after)
  })
})

describe('words without a drawing', () => {
  const seat: QuickMenuDefinition = {
    name: 'tile-seat:copy',
    title: 'copy',
    contexts: [],
    slots: [
      { direction: 'east', label: 'zebra', action: { kind: 'command', command: 'zebra' } },
      { direction: 'west', label: 'known', icon: 'not_a_glyph', action: { kind: 'command', command: 'x' } },
      { direction: 'northeast', label: '', icon: undefined, action: { kind: 'command', command: 'y' } },
      { direction: 'centre', label: 'shelf', icon: 'bookmark', action: { kind: 'effect', effect: 'shelf:toggle', payload: {} } },
      { direction: 'southeast', label: 'extraordinarily-long-seat-word', action: { kind: 'command', command: 'z' } },
    ],
  }

  it('is text-only: 13 px, centred, no stand-in glyph', () => {
    const { svg } = overlay.ensure(seat, labelOf)
    for (const word of ['zebra', 'known']) {
      const g = slot(svg, word)
      expect(iconShown(g)).toBe(false)
      expect(part(g, 'text').getAttribute('y')).toBe('4.5')
      expect(part(g, 'text').getAttribute('font-size')).toBe('13')
    }
  })

  it('shows more_horiz for an empty label and nothing else', () => {
    const { svg } = overlay.ensure(seat, labelOf)
    const empty = slotGroups(svg).find(g => part(g, 'text').textContent === '') as SVGGElement
    expect(iconShown(empty)).toBe(true)
    expect(part(empty, '.hc-qm-ico path').getAttribute('d')).toBe(iconPath(emptyIcon))
  })

  it('shrinks a long word at warm and squeezes only as the last resort', () => {
    const { svg } = overlay.ensure(seat, labelOf)
    const g = slot(svg, 'extraordinarily-long-seat-word')
    const size = Number(part(g, 'text').getAttribute('font-size'))
    expect(size).toBeLessThanOrEqual(LAYOUT.floorSize)
    expect(part(g, 'text').getAttribute('textLength')).toBe(String(LAYOUT.usableText))
    expect(part(g, 'text').getAttribute('lengthAdjust')).toBe('spacingAndGlyphs')
    // a short word is never squeezed
    expect(slot(svg, 'shelf').hasAttribute('textLength')).toBe(false)
  })
})

describe('the theme', () => {
  it('adds a contact edge on light themes only', () => {
    expect(overlay.ensure(ROOT, labelOf).svg.querySelectorAll('.hc-qm-shadow')).toHaveLength(0)
    document.documentElement.style.setProperty('--md-is-light', '1')
    const light = new QuickMenuOverlay()
    light.warm([VIEW], labelOf)
    const svg = light.ensure(VIEW, labelOf).svg
    expect(getComputedStyle(document.documentElement).getPropertyValue('--md-is-light').trim()).toBe('1')
    expect(svg.querySelectorAll('.hc-qm-shadow')).toHaveLength(6)
    expect(part(svg, '.hc-qm-rim').getAttribute('stroke')).toBe(HONEY.steelLight)
  })

  it('rebuilds what was warm when the theme changes', () => {
    registry.register(ROOT)
    const known = [ROOT, VIEW]
    ;(globalThis as unknown as { ioc: { get: () => unknown } }).ioc.get = () => registry
    overlay.warm(known, labelOf)
    vi.runAllTimers()
    expect(themeWaiters).toHaveLength(1)
    const before = overlay.ensure(ROOT, labelOf)
    const service = new EventTarget()
    themeWaiters[0].cb(service)
    document.documentElement.style.setProperty('--md-is-light', '1')
    service.dispatchEvent(new CustomEvent('change'))
    vi.runAllTimers()
    const after = overlay.ensure(ROOT, labelOf)
    expect(after).not.toBe(before)
    expect(after.svg.querySelectorAll('.hc-qm-shadow').length).toBeGreaterThan(0)
    expect(overlay.ensure(VIEW, labelOf)).toBeTruthy()
  })

  it('ignores a theme event that left --md-is-light as it was', () => {
    overlay.warm([ROOT, VIEW], labelOf)
    vi.runAllTimers()
    const before = overlay.ensure(ROOT, labelOf)
    const service = new EventTarget()
    themeWaiters[0].cb(service)
    // registerTheme and reassert both say 'change' without touching the one input
    service.dispatchEvent(new CustomEvent('change'))
    service.dispatchEvent(new CustomEvent('change'))
    const ns = vi.spyOn(document, 'createElementNS')
    vi.runAllTimers()
    expect(ns).not.toHaveBeenCalled()
    expect(overlay.ensure(ROOT, labelOf)).toBe(before)
  })

  it('a rebuild keeps the menus that were still waiting for their idle slot', () => {
    const all = registry.all()
    overlay.warm(all, labelOf)           // the first is built, the rest are queued
    const waiting = all.slice(2)
    expect(waiting.length).toBeGreaterThan(0)
    const service = new EventTarget()
    themeWaiters[0].cb(service)
    document.documentElement.style.setProperty('--md-is-light', '1')
    service.dispatchEvent(new CustomEvent('change'))
    vi.runAllTimers()
    // every menu is built by the idle pass: none is left for the gesture to build
    const ns = vi.spyOn(document, 'createElementNS')
    for (const d of all) overlay.ensure(d, labelOf)
    expect(ns).not.toHaveBeenCalled()
  })

  it('watches the theme once, however often it is warmed', () => {
    overlay.warm([ROOT], labelOf)
    overlay.warm([ROOT, VIEW], labelOf)
    expect(themeWaiters).toHaveLength(1)
  })
})

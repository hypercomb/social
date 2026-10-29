// editor/diagram/tile-diagram.spec.ts
//
// The DOM diagram, driven through a fake port, on the first model AND on a model
// that is nothing like it (a house, inline here, not registered). jsdom has no
// layout, so sizes come from layoutFor() through DiagramInput, and the few
// rectangles the code asks the DOM for are stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HEXAGON } from '../models/hexagon.model.js'
import { HIT, K, LIT } from '../models/model-kit.js'
import type { ModelGeometry, ModelPart, Pt, TileModel } from '../models/tile-model.js'
import type { FieldKey } from '../models/tile-model.js'
import { type FieldValue, type TileSessionPort } from './controls.js'
import { FIELDS, groupParts, kindOfPart } from './fields.js'
import { layoutFor } from './layout.js'
import { createTileDiagram, type DiagramInput, type TileDiagram } from './tile-diagram.js'

// ── a model that is not the first one ───────────────────────────────────────

interface HouseGeometry extends ModelGeometry { readonly pts: readonly Pt[]; readonly marker: Pt }

const houseGeometry = (S: number): HouseGeometry => {
  const P = ([[.04, .44], [.50, .05], [.70, .2196], [.70, .08], [.82, .08], [.82, .3213], [.96, .44], [.96, .98], [.04, .98]] as const)
    .map(([x, y]) => ({ x: x * S, y: y * S }))
  const c = { x: S / 2, y: S / 2 }
  const unit = S * 0.46
  const aa = Math.max(0.04 * unit, 1.5)
  const win = { x: .26 * S, y: .40 * S, w: .48 * S, h: .30 * S }
  const box = { ...win, cx: win.x + win.w / 2, cy: win.y + win.h / 2 }
  const wp = [{ x: win.x, y: win.y }, { x: win.x + win.w, y: win.y }, { x: win.x + win.w, y: win.y + win.h }, { x: win.x, y: win.y + win.h }]
  const outline = K.polyD(P)
  const bb = K.bbox(P)
  return {
    size: S, variant: '', c, unit, reach: Math.max(...P.map(q => Math.hypot(q.x - c.x, q.y - c.y))),
    outline, mask: K.rectD(win), fade: false, box, extent: { min: bb.x, max: bb.x + bb.w },
    rimWidth: 1.2 * aa, glowInset: 1.5 * aa, glowWidth: 3.5 * aa,
    band: { x: 0, y: .76 * S, w: S, h: .14 * S }, nameBox: { cx: c.x, cy: .83 * S, w: .6 * S, h: .14 * S }, nameFont: Math.max(9, 0.15 * unit),
    capture: '',
    inside: p => K.inPoly(P, p), insideMask: p => K.inRect(win, p), edgeDistance: p => K.distPoly(P, p),
    offset: (by, which) => K.polyD(K.offsetPoly(which === 'mask' ? wp : P, by)),
    ghostPath: null, ghostInside: () => false, ghostEdgeDistance: () => Infinity,
    groundShows: () => true,
    groundPath: pic => outline + K.rectD((pic ? K.inter(pic, win) : null) ?? win),
    pts: P, marker: { x: .76 * S, y: .08 * S },
  }
}
const chimney = (g: ModelGeometry): Pt => (g as HouseGeometry).marker
const reach = (g: ModelGeometry): number => Math.max(14, 0.05 * g.size)
const slop = (g: ModelGeometry): number => Math.max(12, g.rimWidth / 2 + 9)
const houseParts: readonly ModelPart<HouseGeometry>[] = [
  { id: 'plate', labelKey: 'editor.model.house.name', label: 'Name plate', fields: ['title', 'hideText'], side: 'left', z: 6,
    anchor: g => ({ x: .09 * g.size, y: .83 * g.size }), hit: HIT.band, lit: g => LIT.band(g) },
  { id: 'outline', labelKey: 'editor.model.house.rim', label: 'Outline', fields: ['border.color'], side: 'right', z: 5,
    anchor: g => ({ x: .96 * g.size, y: .62 * g.size }), hit: HIT.rim(slop), lit: g => LIT.ring(g) },
  { id: 'walls', labelKey: 'editor.model.house.fill', label: 'Walls', fields: ['background.color'], side: 'left', z: 2,
    anchor: g => ({ x: .12 * g.size, y: .62 * g.size }), hit: HIT.fill, lit: LIT.fill },
  { id: 'window', labelKey: 'editor.model.house.picture', label: 'Window', fields: ['picture'], side: 'left', z: 1,
    anchor: g => ({ x: .31 * g.size, y: .47 * g.size }), hit: HIT.picture, lit: LIT.picture },
  { id: 'chimney', labelKey: 'editor.model.house.link', label: 'Chimney link', fields: ['link'], side: 'right', z: 8,
    anchor: g => g.marker, hit: HIT.disc(chimney, reach), lit: LIT.disc(chimney, reach) },
]
const HOUSE: TileModel<HouseGeometry> = {
  id: 'house', labelKey: 'editor.model.house', label: 'house', variants: [], defaultVariant: '',
  geometry: houseGeometry, parts: houseParts,
  neighbours: g => [{ x: -g.size * 1.08, y: 0 }, { x: g.size * 1.08, y: 0 }],
}

const MODELS: readonly TileModel[] = [HEXAGON, HOUSE as unknown as TileModel]

// ── a fake port ─────────────────────────────────────────────────────────────

interface Rig {
  port: TileSessionPort
  S: { group: { count: number; labels: string[] } | null; status: { state: string; sibling?: string; siblingAddress?: string }; values: Record<string, FieldValue>; drafts: Record<string, string>; hasPicture: boolean }
  sets: [FieldKey, FieldValue][]
  fire(): void
  picture: { act: ReturnType<typeof vi.fn>; setVariant: ReturnType<typeof vi.fn> }
}

const makeRig = (input: HTMLInputElement): Rig => {
  const S: Rig['S'] = { group: null, status: { state: 'idle' }, values: { 'border.color': '#7fb069' }, drafts: {}, hasPicture: true }
  const listeners = new Set<() => void>()
  const sets: [FieldKey, FieldValue][] = []
  const picture = { act: vi.fn(), setVariant: vi.fn() }
  const port = {
    get group() { return S.group },
    value: (k: FieldKey) => S.values[k],
    set: (k: FieldKey, v: FieldValue) => { sets.push([k, v]); S.values[k] = v; listeners.forEach(f => f()) },
    fallback: (k: FieldKey) => (k === 'border.color' ? '#c8975a' : ''),
    layer: () => (S.group ? null : { base: 'inherited' as const, choice: null, offered: ['here', 'hide'] as const, choose: () => undefined }),
    name: {
      input,
      get value() { return input.value || 'Harbour dusk' }, stored: 'Harbour dusk', address: 'harbour-dusk', locale: 'en',
      get status() { return S.status }, dirty: false, throughPortal: false, focus: () => input.focus(), undo: () => undefined,
    },
    picture: {
      get has() { return S.hasPicture }, mode: 'fit' as const, linked: true, noOriginal: false, percent: 58, ratio: '3:2', slider01: 0.5,
      cameraAvailable: true, phone: false, act: picture.act, setSlider01: () => undefined,
      history: async () => [], twinUrl: (v: string) => `blob:twin-${v}`, setVariant: picture.setVariant,
    },
    link: { verdict: null, check: async () => undefined, clearVerdict: () => undefined },
    questions: {
      items: [{ id: 'q1', question: 'Which quay is this?' }, { id: 'q2', question: 'Is it lit at night?', answer: 'Yes, until ten.' }],
      draft: (id: string) => S.drafts[id] ?? '', setDraft: (id: string, t: string) => { S.drafts[id] = t }, reply: () => undefined,
    },
    onChange: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
  } as unknown as TileSessionPort
  return { port, S, sets, fire: () => listeners.forEach(f => f()), picture }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? ''))

interface Built { diagram: TileDiagram; rig: Rig; input: HTMLInputElement; viewport: HTMLElement; figure: HTMLElement; gesture: HTMLElement; home: HTMLElement; events: { onLight: ReturnType<typeof vi.fn>; onIntent: ReturnType<typeof vi.fn> }; model: TileModel }

const build = (model: TileModel): Built => {
  const viewport = document.createElement('div')
  const figure = document.createElement('div')
  const gesture = document.createElement('div')
  const home = document.createElement('div')
  const input = document.createElement('input')
  figure.append(gesture)
  viewport.append(figure, home)
  document.body.append(viewport)
  const rig = makeRig(input)
  const events = { onLight: vi.fn(), onIntent: vi.fn() }
  const diagram = createTileDiagram({ model, port: rig.port, viewport, figure, gesture, toolbarHome: home, t, events })
  return { diagram, rig, input, viewport, figure, gesture, home, events, model }
}

/** DiagramInput from the real layout pass, so the numbers are the page's own. */
const inputFor = (model: TileModel, o: { width?: number; height?: number; variant?: string; open?: string | null; scale?: number } = {}): DiagramInput => {
  const variant = o.variant ?? model.defaultVariant
  const em = 16 * (o.scale ?? 1)
  const w = o.width ?? 1440
  const lay = layoutFor({ rootWidth: w + 56, rootRem: 16, em, desk: { w, h: o.height ?? 900 }, model, variant })
  const g = model.geometry(lay.size, variant)
  const pic = { x: g.box.x + g.box.w * 0.1, y: g.box.y + g.box.h * 0.15, w: g.box.w * 0.8, h: g.box.h * 0.7 }
  return {
    size: lay.size, variant, unit: lay.unit, viewport: lay.viewport, layout: lay.layout, figure: lay.figure,
    picture: pic, hasPicture: true, showName: true, ghostName: false, gesturing: false, camera: false, open: o.open ?? null,
  }
}

const calloutOf = (b: Built, id: string): HTMLElement => b.viewport.querySelector<HTMLElement>(`.te-dg-callout[data-part="${id}"]`)!
const leaderOf = (b: Built, id: string): Element => b.viewport.querySelector(`.te-dg-lead[data-part="${id}"]`)!
const litOf = (b: Built, id: string): Element => b.figure.querySelector(`.te-dg-litg[data-part="${id}"]`)!
const partWith = (model: TileModel, key: FieldKey): ModelPart => model.parts.find(p => p.fields[0] === key)!
const fire = (el: Element, type: string, init: Record<string, unknown> = {}): void => {
  const e = new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', clientX: init.clientX as number ?? 0, clientY: init.clientY as number ?? 0, button: 0 })
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'mouse', ...init })) Object.defineProperty(e, k, { value: v, configurable: true })
  el.dispatchEvent(e)
}
const focusIn = (el: Element): void => { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) }

// the card body has a height only in a browser; give it one so growth and covering are exercised
let offsetHeight: PropertyDescriptor | undefined
beforeEach(() => {
  offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains('te-dg-body') && !this.hidden ? 180 : 0 },
  })
})
afterEach(() => {
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe.each(MODELS.map(m => [m.id, m] as const))('the diagram on the %s model', (_name, model) => {
  it('generates a callout, a leader and a lit group per part, in the model\'s order, and Questions last', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    const ids = Array.from(b.viewport.querySelectorAll('.te-dg-callout')).map(el => el.getAttribute('data-part'))
    expect(ids.slice(0, -1)).toEqual(model.parts.map(p => p.id))
    expect(ids[ids.length - 1]).toBe('~questions')
    expect(b.viewport.querySelectorAll('.te-dg-lead').length).toBe(model.parts.length)
    expect(b.figure.querySelectorAll('.te-dg-litg').length).toBe(model.parts.length)
    // behaviour by field kind: a colour part carries its swatch, nothing else does
    for (const p of model.parts) {
      const hasSwatch = !!calloutOf(b, p.id).querySelector('.te-dg-swc')
      expect(hasSwatch).toBe(kindOfPart(p) === 'colour')
    }
    // the lit layer is a sibling of the gesture surface, never inside it
    expect(b.gesture.querySelector('.te-dg-lit')).toBeNull()
    expect(b.figure.querySelector(':scope > .te-dg-lit')).not.toBeNull()
  })

  it('keeps only the four group fields in a group, with no Questions and no layer chips', () => {
    const b = build(model)
    b.rig.S.group = { count: 3, labels: ['a', 'b', 'c'] }
    b.diagram.update(inputFor(model))
    const kept = groupParts(model.parts)
    const ids = Array.from(b.viewport.querySelectorAll('.te-dg-callout')).map(el => el.getAttribute('data-part'))
    expect(ids).toEqual(kept.map(p => p.id))
    expect(b.viewport.querySelector('[data-part="~questions"]')).toBeNull()
    expect(b.viewport.querySelector('.te-dg-layer')).toBeNull()
    expect(b.viewport.querySelector('.te-dg-toolbar')).toBeNull()
    const fields = kept.flatMap(p => [...p.fields])
    expect(fields.every(k => FIELDS[k].group)).toBe(true)
    expect(fields.sort()).toEqual(['background.color', 'border.color', 'hideText', 'link'])
    // the group says how many tiles, in its own element, and the name input is gone
    expect(b.figure.querySelector('.te-band-label')?.textContent).toBe('3 tiles')
    expect(b.input.hidden).toBe(true)
    // leaving the group builds the single-tile set again
    b.rig.S.group = null
    b.diagram.update(inputFor(model))
    expect(b.viewport.querySelector('[data-part="~questions"]')).not.toBeNull()
  })

  it('lights the part, its leader and its tab together on hover, and on focus, strong over soft', () => {
    vi.useFakeTimers()
    const b = build(model)
    b.diagram.update(inputFor(model))
    const p = model.parts[1]
    const wrap = calloutOf(b, p.id)
    fire(wrap, 'pointerenter')
    for (const el of [wrap, leaderOf(b, p.id), litOf(b, p.id)]) expect(el.getAttribute('data-lit')).toBe('soft')
    // nothing else is lit
    expect(b.viewport.querySelectorAll('[data-lit]').length).toBe(3)
    // hover on the same part that has focus reads strong
    focusIn(wrap.querySelector('button')!)
    for (const el of [wrap, leaderOf(b, p.id), litOf(b, p.id)]) expect(el.getAttribute('data-lit')).toBe('strong')
    expect(b.events.onLight).toHaveBeenLastCalledWith(expect.objectContaining({ focus: p.id, hover: p.id }), expect.any(Map))
    // the grace: leaving the tab keeps the light for 120ms, then lets it go
    wrap.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    fire(wrap, 'pointerleave')
    expect(wrap.getAttribute('data-lit')).toBe('soft')
    vi.advanceTimersByTime(119)
    expect(wrap.getAttribute('data-lit')).toBe('soft')
    vi.advanceTimersByTime(2)
    expect(wrap.hasAttribute('data-lit')).toBe(false)
    expect(litOf(b, p.id).hasAttribute('data-lit')).toBe(false)
  })

  it('opens one card at a time on a tab click and moves no other tab', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    const pos = (): Record<string, string> => Object.fromEntries(Array.from(b.viewport.querySelectorAll<HTMLElement>('.te-dg-callout'))
      .map(el => [el.dataset.part!, `${el.style.left},${el.style.top}`]))
    const before = pos()
    const a = model.parts[0].id
    const c = model.parts[2].id
    ;(calloutOf(b, a).querySelector('.te-dg-tab') as HTMLElement).click()
    expect(calloutOf(b, a).hasAttribute('data-open')).toBe(true)
    expect((calloutOf(b, a).querySelector('.te-dg-lab') as HTMLElement).getAttribute('aria-expanded')).toBe('true')
    expect(calloutOf(b, a).querySelector<HTMLElement>('.te-dg-body')!.hidden).toBe(false)
    const open = pos()
    for (const [id, p] of Object.entries(before)) if (id !== a) expect(open[id]).toBe(p)
    // another click elsewhere switches: still only one is open
    ;(calloutOf(b, c).querySelector('.te-dg-tab') as HTMLElement).click()
    expect(b.viewport.querySelectorAll('.te-dg-callout[data-open]').length).toBe(1)
    expect(b.diagram.light.open).toBe(c)
    // a click outside every callout, the figure and the toolbar closes it
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(b.diagram.light.open).toBeNull()
  })

  it('leaves an open card to the Escape ladder on a right-button press outside, so one press closes one rung', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    ;(calloutOf(b, '~questions').querySelector('.te-dg-tab') as HTMLElement).click()
    expect(b.diagram.light.open).toBe('~questions')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    expect(b.diagram.light.open).toBe('~questions')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(b.diagram.light.open).toBeNull()
  })

  it('flips layout without rebuilding a node, and a half-typed answer survives both ways', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    ;(calloutOf(b, '~questions').querySelector('.te-dg-tab') as HTMLElement).click()
    const ta = calloutOf(b, '~questions').querySelector('textarea')!
    ta.value = 'north, I think'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const nodes = Array.from(b.viewport.querySelectorAll('.te-dg-callout, .te-dg-lead'))
    expect(b.viewport.querySelector('.te-dg')!.getAttribute('data-layout')).toBe('wide')
    const narrow = inputFor(model, { width: 700 })
    expect(narrow.layout).toBe('narrow')
    b.diagram.update({ ...narrow, open: null })
    expect(b.viewport.querySelector('.te-dg')!.getAttribute('data-layout')).toBe('narrow')
    expect(Array.from(b.viewport.querySelectorAll('.te-dg-callout, .te-dg-lead'))).toEqual(nodes)
    expect(calloutOf(b, '~questions').querySelector('textarea')).toBe(ta)
    expect(ta.value).toBe('north, I think')
    // narrow rows carry no inline position
    expect(calloutOf(b, model.parts[0].id).style.left).toBe('')
    b.diagram.update(inputFor(model))
    expect(b.viewport.querySelector('.te-dg')!.getAttribute('data-layout')).toBe('wide')
    expect(calloutOf(b, '~questions').querySelector('textarea')).toBe(ta)
    expect(ta.value).toBe('north, I think')
    expect(b.rig.S.drafts.q1).toBe('north, I think')
  })

  it('moves the toolbar node between its homes and never rebuilds it', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    const bar = b.viewport.querySelector('.te-dg-toolbar')!
    expect(bar.parentElement).toBe(b.home)
    b.diagram.update(inputFor(model, { width: 700 }))
    const imagePart = model.parts.find(p => kindOfPart(p) === 'image')!
    expect(bar.parentElement).toBe(calloutOf(b, imagePart.id).querySelector('.te-dg-body'))
    b.diagram.update(inputFor(model))
    expect(b.viewport.querySelector('.te-dg-toolbar')).toBe(bar)
    expect(bar.parentElement).toBe(b.home)
  })

  it('is idempotent: the same input twice changes nothing', () => {
    const b = build(model)
    const input = inputFor(model)
    b.diagram.update(input)
    const html = b.viewport.innerHTML + b.figure.innerHTML
    b.diagram.update({ ...input })
    expect(b.viewport.innerHTML + b.figure.innerHTML).toBe(html)
  })

  it('reports no crossings, overlaps or off-screen callouts across widths, variants and open cards', () => {
    const b = build(model)
    const variants = model.variants.length ? model.variants.map(v => v.id) : [model.defaultVariant]
    let wideRuns = 0
    for (const width of [1920, 1440, 1280, 1100, 1000]) {
      for (const scale of [1, 1.4]) {
        for (const variant of variants) {
          for (const open of [null, ...model.parts.map(p => p.id), '~questions']) {
            const input = inputFor(model, { width, variant, scale, open })
            b.diagram.update(input)
            const r = b.diagram.check()
            if (input.layout === 'wide') wideRuns++
            expect(r, `${width}px x${scale} ${variant} open=${open}`).toEqual({ crossings: 0, overlaps: [], offscreen: [] })
          }
        }
      }
    }
    expect(wideRuns).toBeGreaterThan(20)
  })

  it('answers partAt exactly as the model hits, highest z first', () => {
    const b = build(model)
    const input = inputFor(model)
    b.diagram.update(input)
    const S = input.size
    b.figure.getBoundingClientRect = () => ({ left: 100, top: 50, width: S, height: S, right: 100 + S, bottom: 50 + S, x: 100, y: 50, toJSON: () => ({}) })
    const g = b.diagram.geometry
    const ctx = b.diagram.context
    let sampled = 0
    for (let y = 0; y <= S; y += S / 24) {
      for (let x = 0; x <= S; x += S / 24) {
        const want = [...model.parts].sort((p, q) => q.z - p.z).find(p => p.hit({ x, y }, g, ctx))?.id ?? null
        expect(b.diagram.partAt(100 + x, 50 + y)).toBe(want)
        sampled++
      }
    }
    expect(sampled).toBeGreaterThan(500)
    // every part is reachable somewhere on the drawing
    const seen = new Set<string>()
    for (const p of model.parts) {
      const a = p.anchor(g, ctx)
      const at = b.diagram.partAt(100 + a.x, 50 + a.y)
      if (at) seen.add(at)
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  it('keeps focus in the name input across update()', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    expect(b.input.parentElement).toBe(b.figure)
    b.input.focus()
    expect(document.activeElement).toBe(b.input)
    b.diagram.update({ ...inputFor(model), picture: null, hasPicture: false })
    b.diagram.update(inputFor(model, { width: 1280 }))
    b.rig.fire()
    expect(document.activeElement).toBe(b.input)
    expect(b.input.parentElement).toBe(b.figure)
    expect(b.input.hidden).toBe(false)
  })

  it('acts on a click on a drawn part by the KIND of its primary field', () => {
    const b = build(model)
    const input = inputFor(model)
    b.diagram.update(input)
    const S = input.size
    b.figure.getBoundingClientRect = () => ({ left: 0, top: 0, width: S, height: S, right: S, bottom: S, x: 0, y: 0, toJSON: () => ({}) })
    const g = b.diagram.geometry
    const ctx = b.diagram.context
    const tap = (p: Pt): void => {
      fire(b.gesture, 'pointerdown', { clientX: p.x, clientY: p.y })
      fire(b.gesture, 'pointerup', { clientX: p.x, clientY: p.y })
    }
    // colour: the native input of the tab swatch is clicked
    const colour = model.parts.find(p => kindOfPart(p) === 'colour' && p.fields[0] === 'border.color')!
    const swatchInput = calloutOf(b, colour.id).querySelector<HTMLInputElement>('.te-dg-swc input')!
    const click = vi.spyOn(swatchInput, 'click')
    const spot = (p: ModelPart): Pt => p.anchor(g, ctx)
    const at = spot(colour)
    if (b.diagram.partAt(at.x, at.y) === colour.id) {
      tap(at)
      expect(click).toHaveBeenCalled()
    }
    // text: the shell is asked to focus the input, and the card opens
    const text = partWith(model, 'title')
    const ta = spot(text)
    expect(b.diagram.partAt(ta.x, ta.y)).toBe(text.id)
    tap(ta)
    expect(b.events.onIntent).toHaveBeenCalledWith({ part: text.id, activation: 'focus-text' })
    expect(b.diagram.light.open).toBe(text.id)
    // link: the card opens and takes focus
    const link = partWith(model, 'link')
    const la = spot(link)
    expect(b.diagram.partAt(la.x, la.y)).toBe(link.id)
    tap(la)
    expect(b.diagram.light.open).toBe(link.id)
    // a drag opens no card
    b.diagram.setLight({ open: null })
    fire(b.gesture, 'pointerdown', { clientX: la.x, clientY: la.y })
    fire(b.gesture, 'pointerup', { clientX: la.x + 30, clientY: la.y })
    expect(b.diagram.light.open).toBeNull()
  })

  it('pins on a first touch tap and acts on the second', () => {
    const b = build(model)
    const input = inputFor(model)
    b.diagram.update(input)
    const S = input.size
    b.figure.getBoundingClientRect = () => ({ left: 0, top: 0, width: S, height: S, right: S, bottom: S, x: 0, y: 0, toJSON: () => ({}) })
    const link = partWith(model, 'link')
    const a = link.anchor(b.diagram.geometry, b.diagram.context)
    const touch = (): void => {
      fire(b.gesture, 'pointerdown', { clientX: a.x, clientY: a.y, pointerType: 'touch' })
      fire(b.gesture, 'pointerup', { clientX: a.x, clientY: a.y, pointerType: 'touch' })
    }
    touch()
    expect(b.diagram.light.pin).toBe(link.id)
    expect(b.diagram.light.open).toBeNull()
    expect(calloutOf(b, link.id).getAttribute('data-lit')).toBe('strong')
    touch()
    expect(b.diagram.light.open).toBe(link.id)
    expect(b.diagram.light.pin).toBeNull()
  })

  it('sets the alert tone on the name part while its title is refused', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    const name = partWith(model, 'title')
    b.rig.S.status = { state: 'refused', sibling: 'Salt flats', siblingAddress: 'salt-flats' }
    b.rig.fire()
    for (const el of [calloutOf(b, name.id), leaderOf(b, name.id), litOf(b, name.id)]) {
      expect(el.getAttribute('data-tone')).toBe('alert')
      expect(el.getAttribute('data-lit')).toBe('strong')
    }
    expect(b.input.getAttribute('aria-invalid')).toBe('true')
  })

  it('lets the shell set the light from outside and tells the shell back', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    const name = partWith(model, 'title')
    b.diagram.setLight({ focus: name.id })
    expect(calloutOf(b, name.id).getAttribute('data-lit')).toBe('strong')
    expect(b.events.onLight).toHaveBeenLastCalledWith({ hover: null, focus: name.id, open: null, pin: null }, new Map([[name.id, 'strong']]))
    b.diagram.setLight({ open: name.id })
    b.diagram.setLight({ open: null })
    expect(calloutOf(b, name.id).hasAttribute('data-open')).toBe(false)
  })

  it('removes everything it added on dispose', () => {
    const b = build(model)
    b.diagram.update(inputFor(model))
    b.diagram.dispose()
    expect(b.viewport.querySelector('.te-dg')).toBeNull()
    expect(b.figure.querySelector('.te-dg-lit')).toBeNull()
    expect(b.viewport.querySelector('.te-dg-toolbar')).toBeNull()
    b.rig.fire()
    b.diagram.update(inputFor(model))
    expect(b.viewport.querySelector('.te-dg')).toBeNull()
  })
})

describe('the diagram on the first model only', () => {
  it('shows the capture box and its size while the shape or the picture is lit, and lifts the fade', () => {
    vi.useFakeTimers()
    const b = build(HEXAGON as unknown as TileModel)
    b.diagram.update(inputFor(HEXAGON as unknown as TileModel))
    expect(b.figure.querySelector('.te-dg-capture')!.hasAttribute('data-lit')).toBe(false)
    expect(b.viewport.querySelector<HTMLElement>('.te-dg-dim')!.hidden).toBe(true)
    const hex = HEXAGON as unknown as TileModel
    fire(calloutOf(b, partWith(hex, 'orientation').id), 'pointerenter')
    expect(b.figure.querySelector('.te-dg-capture')!.getAttribute('data-lit')).toBe('soft')
    expect(b.viewport.querySelector<HTMLElement>('.te-dg-dim')!.textContent).toMatch(/\d+ x \d+ px, as saved/)
    expect(b.viewport.getAttribute('data-lift')).toBe('false')
    fire(calloutOf(b, partWith(hex, 'orientation').id), 'pointerleave')
    vi.advanceTimersByTime(130)
    fire(calloutOf(b, partWith(hex, 'picture').id), 'pointerenter')
    expect(b.viewport.getAttribute('data-lift')).toBe('true')
    expect(b.figure.getAttribute('data-lift')).toBe('true')
    fire(calloutOf(b, partWith(hex, 'picture').id), 'pointerleave')
    vi.advanceTimersByTime(130)
    expect(b.viewport.getAttribute('data-lift')).toBe('false')
  })

  it('cycles the variant when the shape part is clicked, by kind', () => {
    const b = build(HEXAGON as unknown as TileModel)
    const input = inputFor(HEXAGON as unknown as TileModel)
    b.diagram.update(input)
    const S = input.size
    b.figure.getBoundingClientRect = () => ({ left: 0, top: 0, width: S, height: S, right: S, bottom: S, x: 0, y: 0, toJSON: () => ({}) })
    const shape = partWith(HEXAGON as unknown as TileModel, 'orientation')
    const a = shape.anchor(b.diagram.geometry, b.diagram.context)
    fire(b.gesture, 'pointerdown', { clientX: a.x, clientY: a.y })
    fire(b.gesture, 'pointerup', { clientX: a.x, clientY: a.y })
    expect(b.rig.picture.setVariant).toHaveBeenCalledTimes(1)
    expect(b.rig.picture.setVariant).toHaveBeenCalledWith(HEXAGON.variants[1].id)
  })

  it('keeps the tabs where they are when the variant turns', () => {
    const b = build(HEXAGON as unknown as TileModel)
    b.diagram.update(inputFor(HEXAGON as unknown as TileModel))
    const rows = (): string[] => Array.from(b.viewport.querySelectorAll<HTMLElement>('.te-dg-callout')).map(el => `${el.dataset.part}:${el.style.left}`)
    const before = rows()
    b.diagram.update(inputFor(HEXAGON as unknown as TileModel, { variant: HEXAGON.variants[1].id }))
    expect(rows()).toEqual(before)
    expect(b.diagram.geometry.variant).toBe('flat-top')
  })

  it('writes colour from the tab swatch and fills the tab glance', () => {
    const b = build(HEXAGON as unknown as TileModel)
    b.diagram.update(inputFor(HEXAGON as unknown as TileModel))
    const rim = partWith(HEXAGON as unknown as TileModel, 'border.color')
    const inp = calloutOf(b, rim.id).querySelector<HTMLInputElement>('.te-dg-swc input')!
    expect(calloutOf(b, rim.id).querySelector('.te-dg-val')!.textContent).toBe('#7fb069')
    inp.value = '#112233'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    expect(b.rig.sets).toEqual([['border.color', '#112233']])
    expect(calloutOf(b, rim.id).querySelector('.te-dg-val')!.textContent).toBe('#112233')
  })
})

describe('the diagram — review fixes', () => {
  const hex = HEXAGON as unknown as TileModel
  const rect = (S: number) => ({ left: 0, top: 0, width: S, height: S, right: S, bottom: S, x: 0, y: 0, toJSON: () => ({}) })
  const linkSpot = (b: Built): Pt => partWith(hex, 'link').anchor(b.diagram.geometry, b.diagram.context)
  const ready = (): Built => {
    const b = build(hex)
    const input = inputFor(hex)
    b.diagram.update(input)
    b.figure.getBoundingClientRect = () => rect(input.size)
    return b
  }

  it('does not take a press that ends on the stage’s own tools for a tap on the part under them', () => {
    const b = ready()
    const tools = document.createElement('div')
    tools.className = 'te-empty-tools'
    const button = document.createElement('button')
    tools.append(button)
    b.gesture.append(tools)
    const at = linkSpot(b)
    expect(b.diagram.partAt(at.x, at.y)).toBe(partWith(hex, 'link').id)

    fire(b.gesture, 'pointerdown', { clientX: at.x, clientY: at.y })
    fire(button, 'pointerup', { clientX: at.x, clientY: at.y })
    expect(b.diagram.light.open).toBeNull()

    // the same press ending on the surface itself IS a tap
    fire(b.gesture, 'pointerdown', { clientX: at.x, clientY: at.y })
    fire(b.gesture, 'pointerup', { clientX: at.x, clientY: at.y })
    expect(b.diagram.light.open).toBe(partWith(hex, 'link').id)
  })

  it('does not take a press that left the slop and came back for a tap', () => {
    const b = ready()
    const at = linkSpot(b)
    fire(b.gesture, 'pointerdown', { clientX: at.x, clientY: at.y })
    fire(b.gesture, 'pointermove', { clientX: at.x + 40, clientY: at.y })
    fire(b.gesture, 'pointermove', { clientX: at.x, clientY: at.y })
    fire(b.gesture, 'pointerup', { clientX: at.x, clientY: at.y })
    expect(b.diagram.light.open).toBeNull()
  })

  it('lifts the outside fade: the selector names the class the overlay really draws', () => {
    const outside = document.createElement('path')
    outside.className = 'te-look-outside'
    const look = document.createElement('div')
    look.className = 'te-look'
    look.append(outside)
    const viewport = document.createElement('div')
    viewport.setAttribute('data-lift', 'true')
    viewport.append(look)
    document.body.append(viewport)
    build(hex)

    const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]) as CSSStyleRule[]
    const lifting = rules.filter(rule => rule.selectorText?.includes('data-lift') && parseFloat(rule.style.getPropertyValue('fill-opacity')) === 0.4)
    expect(lifting.length).toBeGreaterThan(0)
    expect(lifting.some(rule => outside.matches(rule.selectorText))).toBe(true)
    // and while the stage is being dragged, which has its own (stronger) rule
    look.setAttribute('data-dragging', 'true')
    expect(lifting.some(rule => rule.selectorText.includes('data-dragging') && outside.matches(rule.selectorText))).toBe(true)
    expect(lifting.some(rule => rule.selectorText.includes('.te-outside'))).toBe(false)
  })

  it('lets go of the listeners of a build it replaces', () => {
    const b = build(hex)
    b.diagram.update(inputFor(hex))
    const old = calloutOf(b, partWith(hex, 'link').id)
    const removed: unknown[] = []
    const spy = vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (this: EventTarget) { removed.push(this) })
    try {
      b.rig.S.group = { count: 2, labels: ['a', 'b'] }
      b.diagram.update(inputFor(hex))
    } finally { spy.mockRestore() }
    expect(removed).toContain(old)
    expect(removed).toContain(old.querySelector('.te-dg-tab'))
  })

  it('clears the hover of a callout that a rebuild removes', () => {
    const b = build(hex)
    b.diagram.update(inputFor(hex))
    fire(calloutOf(b, '~questions'), 'pointerenter')
    expect(b.diagram.light.hover).toBe('~questions')
    b.rig.S.group = { count: 2, labels: ['a', 'b'] }
    b.diagram.update(inputFor(hex))
    expect(b.viewport.querySelector('[data-part="~questions"]')).toBeNull()
    expect(b.diagram.light.hover).toBeNull()
  })

  it('names a tab by its label AND its value', () => {
    const b = build(hex)
    b.diagram.update(inputFor(hex))
    const rim = calloutOf(b, partWith(hex, 'border.color').id)
    const label = rim.querySelector<HTMLElement>('.te-dg-lab')!
    const value = document.getElementById(label.getAttribute('aria-describedby') ?? '')
    expect(value).not.toBeNull()
    expect(rim.contains(value)).toBe(true)
    expect(value!.className).toBe('te-dg-val')
    expect(value!.textContent).toBe('#7fb069')
  })

  it('points the name input at the status line while the card that holds it is shown', () => {
    const b = build(hex)
    b.diagram.update(inputFor(hex))
    expect(b.input.hasAttribute('aria-describedby')).toBe(false)
    b.diagram.setLight({ open: partWith(hex, 'title').id })
    const status = document.getElementById(b.input.getAttribute('aria-describedby') ?? '')
    expect(status).not.toBeNull()
    expect(status!.getAttribute('role')).toBe('status')
    expect(status!.className).toContain('te-dg-status')
    b.diagram.setLight({ open: null })
    expect(b.input.hasAttribute('aria-describedby')).toBe(false)
  })
})

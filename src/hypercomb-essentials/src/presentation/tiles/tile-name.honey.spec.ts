// tile-name.honey.spec.ts — the quick menu's honey options in the DOM name layer.
//
// An option on the flower is poured by the hex shader (hex-sdf honeyTile), but its
// glyph and its word are real DOM text over the canvas. Each is its own span, so
// the word stays when the glyph is dropped for a small tile; each is sized and
// placed as a fraction of the tile's circumradius, clear of the places the honey
// keeps its drips out of; and the ink follows the state.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const { TileNameDrone } = await import('./tile-name.drone.js')

/** The default geometry: `circumRadiusPx` 32 is the APOTHEM; the circumradius is that over 0.866. */
const R = 32 / 0.8660254
const LAYOUT_PX = 40

const world = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

beforeEach(async () => {
  EffectBus.clear()
  services.clear()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-hc-tile-names]').forEach(s => s.remove())
  world.a = 1
  services.set('@diamondcoreprocessor.com/ShowCellDrone', {
    nameHidden: () => false,
    displayNameFor: (label: string) => label,
    shaderDrawsName: () => false,
  })
  const drone = new TileNameDrone()
  await (drone as unknown as { heartbeat: (g: string) => Promise<void> }).heartbeat('')
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const noop = (): void => { /* stub */ }
  EffectBus.emit('render:host-ready', {
    app: { ticker: { add: noop, remove: noop }, renderer: { screen: { width: 800, height: 600 }, on: noop, off: noop } },
    container: { worldTransform: world },
    canvas,
    renderer: { on: noop, off: noop },
  })
})

const flower = (cells: unknown[]): void => { EffectBus.emit('render:flower', { cells }) }
const spans = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hc-flower-name')]
const iconSpan = (): HTMLElement | undefined => spans().find(s => s.querySelector('.hc-flower-icon'))
const wordSpan = (): HTMLElement | undefined => spans().find(s => s.querySelector('.hc-tile-name-text'))

/** translate(Xpx,Ypx) scale(S) …  →  x, y, S */
function placed(span: HTMLElement): { x: number; y: number; scale: number; rotated: boolean } {
  const m = /translate\((-?[\d.e-]+)px,(-?[\d.e-]+)px\)( rotate\(90deg\))? scale\(([\d.e-]+)\)/.exec(span.style.transform)
  if (!m) throw new Error('no transform: ' + span.style.transform)
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[4]), rotated: !!m[3] }
}

describe('a honey option wears its glyph above and its word below', () => {
  it('two spans, each a honey span, the glyph a Material Symbols ligature', () => {
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true }])
    expect(spans()).toHaveLength(2)
    for (const span of spans()) {
      expect(span.classList.contains('hc-honey')).toBe(true)
      expect(span.classList.contains('lit')).toBe(false)
    }
    const glyph = iconSpan()!.querySelector('.hc-flower-icon')!
    expect(glyph.classList.contains('mat-sym')).toBe(true)
    expect(glyph.textContent).toBe('sell')
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    expect(wordSpan()!.querySelector('.hc-tile-name-text')!.textContent).toBe('tags')
  })

  it('the glyph is 0.52 R and centred -0.20 R above the middle; the word 0.25 R at +0.32 R', () => {
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true }])
    const icon = placed(iconSpan()!)
    expect(icon.y).toBeCloseTo(-0.2 * R, 3)
    expect(icon.scale * LAYOUT_PX).toBeCloseTo(0.52 * R, 3)
    const word = placed(wordSpan()!)
    expect(word.y).toBeCloseTo(0.32 * R, 3)
    expect(word.scale * LAYOUT_PX).toBeCloseTo(0.25 * R, 3)
  })

  it('a long word is set smaller to fit, down to a floor, never wrapped', () => {
    flower([{ q: 0, r: 0, label: 'collections', icon: 'folder_open', honey: true }])
    const fitted = placed(wordSpan()!).scale * LAYOUT_PX
    expect(fitted).toBeLessThan(0.25 * R)
    expect(fitted).toBeGreaterThanOrEqual(0.196 * R - 1e-6)

    flower([{ q: 0, r: 0, label: 'a very long word indeed here', honey: true }])
    expect(placed(wordSpan()!).scale * LAYOUT_PX).toBeCloseTo(0.196 * R, 3)
  })

  it('a word with no glyph stands alone', () => {
    flower([{ q: 0, r: 0, label: 'seat', honey: true }])
    expect(spans()).toHaveLength(1)
    expect(iconSpan()).toBeUndefined()
    expect(wordSpan()!.querySelector('.hc-tile-name-text')!.textContent).toBe('seat')
  })

  it('and stands in the middle at the ring\'s text-only size, not low under an empty upper half', () => {
    flower([{ q: 0, r: 0, label: 'seat', honey: true }])
    const word = placed(wordSpan()!)
    expect(word.y).toBeCloseTo(0, 3)
    expect(word.scale * LAYOUT_PX).toBeCloseTo((13 / 46) * R, 3)

    // with a glyph the same word keeps its place under it
    flower([{ q: 0, r: 0, label: 'seat', icon: 'sell', honey: true }])
    expect(placed(wordSpan()!).y).toBeCloseTo(0.32 * R, 3)
  })

  it('a long word alone is fitted to the ring\'s 70 px, down to the same floor', () => {
    flower([{ q: 0, r: 0, label: 'a very long word indeed here', honey: true }])
    expect(placed(wordSpan()!).scale * LAYOUT_PX).toBeCloseTo(0.196 * R, 3)
  })

  it('the face is read once per paint, not once per word', () => {
    const read = vi.spyOn(window, 'getComputedStyle')
    flower([
      { q: 0, r: 0, label: 'tags', icon: 'sell', honey: true },
      { q: 1, r: 0, label: 'history', icon: 'history', honey: true },
      { q: 0, r: 1, label: 'seat', honey: true },
    ])
    expect(read).toHaveBeenCalledTimes(1)
    read.mockRestore()
  })

  it('lit and back are classes on both spans, which the ink follows', () => {
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true, lit: true }])
    for (const span of spans()) expect(span.classList.contains('lit')).toBe(true)
    flower([{ q: 0, r: 0, label: 'back', icon: 'arrow_back', honey: true, back: true }])
    for (const span of spans()) expect(span.classList.contains('back')).toBe(true)

    const css = document.head.querySelector('style[data-hc-tile-names]')!.textContent!
    expect(css).toContain('span.hc-flower-name.hc-honey{color:#fff1cf')
    expect(css).toContain('span.hc-flower-name.hc-honey.lit{color:#1a1003}')
    expect(css).toContain('span.hc-flower-name.hc-honey.back{color:#e6d4a8}')
  })

  it('is not turned with the pivot: the honey is not', () => {
    EffectBus.emit('render:set-pivot', { pivot: true })
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true }])
    for (const span of spans()) expect(placed(span).rotated).toBe(false)
  })

  it('follows the tile to its cell', () => {
    flower([{ q: 2, r: 1, label: 'tags', icon: 'sell', honey: true }])
    const spacing = 38
    expect(placed(wordSpan()!).x).toBeCloseTo(Math.sqrt(3) * spacing * (2 + 1 / 2), 3)
  })
})

describe('the glyph is dropped when the tile is too small to hold one; the word never is', () => {
  it('hidden under 11 screen px, shown above', () => {
    world.a = 0.5   // 0.52 R × 0.5 ≈ 9.6 px
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true }])
    expect(iconSpan()!.hidden).toBe(true)
    expect(wordSpan()!.hidden).toBe(false)

    world.a = 1     // ≈ 19 px
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true }])
    expect(iconSpan()!.hidden).toBe(false)
  })
})

describe('what is not honey is left as it was', () => {
  it('a glyph cell without the flag is the one span that wears the glyph in place of the name', () => {
    flower([{ q: 0, r: 0, label: 'idea', icon: 'lightbulb' }])
    expect(spans()).toHaveLength(1)
    expect(spans()[0].classList.contains('hc-honey')).toBe(false)
    const glyph = spans()[0].querySelector('.hc-flower-icon')!
    expect(glyph.textContent).toBe('lightbulb')
  })

  it('the subject is never honey, whatever it is told', () => {
    flower([{ q: 0, r: 0, label: 'sunrise', subject: true, honey: true }])
    expect(spans()).toHaveLength(1)
    expect(spans()[0].classList.contains('hc-honey')).toBe(false)
    expect(spans()[0].querySelector('.hc-tile-name-text')!.textContent).toBe('sunrise')
  })

  it('taking the flower away takes the honey spans with it', () => {
    flower([{ q: 0, r: 0, label: 'tags', icon: 'sell', honey: true }])
    expect(spans().length).toBeGreaterThan(0)
    EffectBus.emit('render:flower', { cells: null })
    expect(spans()).toHaveLength(0)
  })
})

describe('the names bloom with their tiles when a ring opens (flower-motion.ts)', () => {
  const ring = [
    { q: 0, r: 0, label: 'sunrise', subject: true },
    { q: 1, r: 0, label: 'tags', icon: 'sell', honey: true },
    { q: 0, r: 1, label: 'seat', honey: true },
    { q: -1, r: 1, label: 'back', honey: true, back: true },
  ]
  const named = (label: string): HTMLElement[] =>
    spans().filter(s => s.textContent === label || s.querySelector('.hc-tile-name-text')?.textContent === label)
  const at = (ms: number) => vi.spyOn(performance, 'now').mockReturnValue(ms)

  it('30 ms a slot clockwise from east, about the tile\'s own centre; the subject stays as it is', () => {
    at(1000)
    flower(ring)
    for (const span of spans()) expect(span.classList.contains('hc-bloom')).toBe(!named('sunrise').includes(span))
    // the tile the menu opened on is already showing: its name never blinks out
    expect(named('sunrise')[0].style.animationDelay).toBe('')
    for (const span of named('tags').concat(iconSpan()!)) expect(span.style.animationDelay).toBe('30ms')   // east: slot 1
    expect(named('seat')[0].style.animationDelay).toBe('60ms')    // southeast: slot 2
    expect(named('back')[0].style.animationDelay).toBe('90ms')    // southwest: slot 3
    const spacing = 38
    expect(named('tags')[0].style.getPropertyValue('--hc-bloom-x')).toBe(`${Math.sqrt(3) * spacing}px`)
    expect(named('tags')[0].style.getPropertyValue('--hc-bloom-y')).toBe('0px')
    vi.restoreAllMocks()
  })

  it('a highlight during the bloom carries it on from where it is; after it, blooms nothing', () => {
    at(1000)
    flower(ring)
    at(1050)
    flower([ring[0], { ...ring[1], lit: true }, ring[2], ring[3]])
    expect(named('tags')[0].style.animationDelay).toBe('-20ms')
    at(2000)
    flower([ring[0], ring[1], { ...ring[2], lit: true }, ring[3]])
    for (const span of spans()) expect(span.classList.contains('hc-bloom')).toBe(false)
    vi.restoreAllMocks()
  })

  it('a new ring blooms again', () => {
    at(1000)
    flower(ring)
    at(5000)
    flower([ring[0], { ...ring[1], label: 'history', icon: 'history' }, ring[2], ring[3]])
    expect(named('history')[0].classList.contains('hc-bloom')).toBe(true)
    expect(named('history')[0].style.animationDelay).toBe('30ms')
    vi.restoreAllMocks()
  })

  it('never under reduced motion, and never a flower with no honey in it', () => {
    const was = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q })) as unknown as typeof window.matchMedia
    flower(ring)
    for (const span of spans()) expect(span.classList.contains('hc-bloom')).toBe(false)
    window.matchMedia = was
    flower([{ q: 0, r: 0, label: 'idea', icon: 'lightbulb' }, { q: 1, r: 0, label: 'other' }])
    for (const span of spans()) expect(span.classList.contains('hc-bloom')).toBe(false)
  })

  it('the keyframes scale about the tile centre, and stand down for reduced motion', () => {
    const css = document.head.querySelector('style[data-hc-tile-names]')!.textContent!
    expect(css).toContain('@keyframes hc-flower-bloom{from{opacity:0;scale:0.92;translate:calc(var(--hc-bloom-x) * 0.08) calc(var(--hc-bloom-y) * 0.08)}to{opacity:1;scale:1;translate:0 0}}')
    expect(css).toContain('span.hc-flower-name.hc-bloom{animation:hc-flower-bloom 260ms cubic-bezier(0.2,0.8,0.2,1) both}')
    expect(css).toContain('@media (prefers-reduced-motion:reduce)')
  })
})

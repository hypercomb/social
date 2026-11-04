// quick-menu.honey-art.spec.ts — the ten crafted backgrounds, as plumbing:
//
//   · which option wears which: never the same twice in one ring, stable, and
//     different menus start (and step) differently
//   · the contract every background keeps, checked against two placeholders
//     written here (the real ten are checked in quick-menu.backgrounds.spec.ts)
//   · the atlas geometry, and drawing that fails soft where there is no canvas

import { describe, expect, it } from 'vitest'
import { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { HONEY_BACKGROUND_COUNT, backgroundFor, wallY } from './quick-menu.honey.js'
import {
  HONEY_ART_TILE,
  HONEY_ART_VIEWBOX,
  atlasFrame,
  honeyBackgroundProblems,
  sizedSvg,
  warmHoneyArt,
  type HoneyBackground,
} from './quick-menu.honey-art.js'
import { QUICK_MENU_RING, type QuickMenuDirection } from './quick-menu.types.js'

const SEVEN: readonly QuickMenuDirection[] = ['centre', ...QUICK_MENU_RING]

/** Two placeholder backgrounds that keep the contract: a gradient body and a
 *  turbulence-grained lip, every id prefixed, nothing external. */
const PLACEHOLDER_A: HoneyBackground = {
  id: 'honey-01',
  name: 'Placeholder Amber',
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HONEY_ART_VIEWBOX}" width="80" height="92">` +
    '<defs><radialGradient id="honey-01-body" cx="0" cy="0" r="46" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#8c5810"/><stop offset="1" stop-color="#1d1204"/></radialGradient>' +
    '<filter id="honey-01-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/>' +
    '<feColorMatrix type="saturate" values="0"/><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>' +
    '<rect x="-41" y="-47" width="82" height="94" fill="url(#honey-01-body)"/>' +
    '<path d="M-41 -47H41V-30Q0 -24 -41 -30Z" fill="#a8700f" filter="url(#honey-01-grain)"/></svg>',
}
const PLACEHOLDER_B: HoneyBackground = {
  id: 'honey-02',
  name: 'Placeholder Comb',
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HONEY_ART_VIEWBOX}" width="80" height="92">` +
    '<defs><polygon id="honey-02-cell" points="0,-6 5.2,-3 5.2,3 0,6 -5.2,3 -5.2,-3"/></defs>' +
    '<rect x="-41" y="-47" width="82" height="94" fill="#2b1a05"/>' +
    '<use href="#honey-02-cell" x="-20" y="-34" fill="#c28418"/><use href="#honey-02-cell" x="20" y="34" fill="#c28418"/></svg>',
}

describe('backgroundFor — which option wears which', () => {
  const registry = new QuickMenuRegistry()

  it('never repeats a background within one ring, for every menu there is', () => {
    const menus = registry.all()
    expect(menus.length).toBeGreaterThan(3)
    for (const menu of menus) {
      const worn = SEVEN.map(d => backgroundFor(menu.name, d))
      expect(new Set(worn).size, menu.name).toBe(7)
      for (const n of worn) {
        expect(Number.isInteger(n)).toBe(true)
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThan(HONEY_BACKGROUND_COUNT)
      }
    }
  })

  it('holds for any name at all, not only the registered ones', () => {
    for (let i = 0; i < 500; i++) {
      const name = `menu-${i}-${(i * 7919).toString(36)}`
      expect(new Set(SEVEN.map(d => backgroundFor(name, d))).size, name).toBe(7)
    }
  })

  it('is a function of menu and slot alone: the same slot looks the same every time', () => {
    for (const d of SEVEN) expect(backgroundFor('root', d)).toBe(backgroundFor('root', d))
  })

  it('starts different menus at different places', () => {
    const starts = new Set(registry.all().map(m => backgroundFor(m.name, 'centre')))
    expect(starts.size).toBeGreaterThan(2)
    const rings = new Set(registry.all().map(m => SEVEN.map(d => backgroundFor(m.name, d)).join(',')))
    expect(rings.size).toBeGreaterThan(2)
  })
})

describe('wallY — where a drip hangs with no lip', () => {
  it('is the top vertex at the middle and the shoulder at the corner', () => {
    expect(wallY(0)).toBeCloseTo(-46, 6)
    expect(wallY(39.84)).toBeCloseTo(-23, 1)
    expect(wallY(-23)).toBeCloseTo(wallY(23), 9)
  })
})

describe('the contract every background keeps', () => {
  it('passes both placeholders', () => {
    expect(honeyBackgroundProblems(PLACEHOLDER_A, 1)).toEqual([])
    expect(honeyBackgroundProblems(PLACEHOLDER_B, 2)).toEqual([])
  })

  it('names its own place', () => {
    expect(honeyBackgroundProblems(PLACEHOLDER_A, 3).join()).toMatch(/expected "honey-03"/)
  })

  it('refuses each forbidden thing', () => {
    const broken = (svg: string): string[] => honeyBackgroundProblems({ ...PLACEHOLDER_B, svg: PLACEHOLDER_B.svg.replace('</svg>', svg + '</svg>') }, 2)
    expect(broken('<text x="0" y="0">A</text>').join()).toMatch(/<text>/)
    expect(broken('<script>1</script>').join()).toMatch(/<script>/)
    expect(broken('<image href="#honey-02-cell"/>').join()).toMatch(/<image>/)
    expect(broken('<use href="https://example.invalid/a.svg#x"/>').join()).toMatch(/href to something outside/)
    expect(broken('<rect fill="url(other.svg#x)"/>').join()).toMatch(/url\(\) to something outside/)
    expect(broken('<rect onclick="x()"/>').join()).toMatch(/event handler/)
    expect(broken('<style>@font-face{font-family:x}</style>').join()).toMatch(/@font-face/)
  })

  it('refuses an id that is not its own, and a reference to nothing', () => {
    const svg = PLACEHOLDER_B.svg.replace('id="honey-02-cell"', 'id="cell"')
    const problems = honeyBackgroundProblems({ ...PLACEHOLDER_B, svg }, 2).join()
    expect(problems).toMatch(/not prefixed "honey-02-"/)
    expect(problems).toMatch(/refers to #honey-02-cell/)
  })

  it('refuses the wrong frame', () => {
    const svg = PLACEHOLDER_B.svg.replace(HONEY_ART_VIEWBOX, '0 0 80 92').replace('height="92"', 'height="90"')
    const problems = honeyBackgroundProblems({ ...PLACEHOLDER_B, svg }, 2).join()
    expect(problems).toMatch(/viewBox/)
    expect(problems).toMatch(/width="80" height="92"/)
  })

  it('refuses one too heavy', () => {
    const svg = PLACEHOLDER_B.svg.replace('</svg>', `<desc>${'x'.repeat(90 * 1024)}</desc></svg>`)
    expect(honeyBackgroundProblems({ ...PLACEHOLDER_B, svg }, 2).join()).toMatch(/bytes/)
  })
})

describe('drawing it once', () => {
  it('asks only the root for a new size, and leaves the art alone', () => {
    const big = sizedSvg(PLACEHOLDER_A.svg, HONEY_ART_TILE.width, HONEY_ART_TILE.height)
    expect(big).toMatch(/^<svg width="280" height="322" xmlns=/)
    expect(big).toContain(`viewBox="${HONEY_ART_VIEWBOX}"`)
    // the rect's own width is untouched
    expect(big).toContain('width="82" height="94"')
    expect(big.length - PLACEHOLDER_A.svg.length).toBe(2)
  })

  it('draws at the viewBox aspect exactly', () => {
    expect(HONEY_ART_TILE.width / HONEY_ART_TILE.height).toBeCloseTo(80 / 92, 9)
  })

  it('lays every variation in its own padded cell, rest above lit, none overlapping', () => {
    const frames = Array.from({ length: HONEY_BACKGROUND_COUNT }, (_, i) => [atlasFrame(i, false), atlasFrame(i, true)]).flat()
    for (const a of frames) {
      expect(a.width).toBe(HONEY_ART_TILE.width)
      expect(a.height).toBe(HONEY_ART_TILE.height)
      expect(a.x).toBeGreaterThanOrEqual(HONEY_ART_TILE.pad)
      expect(a.y).toBeGreaterThanOrEqual(HONEY_ART_TILE.pad)
      for (const b of frames) {
        if (a === b) continue
        const apart = a.x + a.width + HONEY_ART_TILE.pad <= b.x || b.x + b.width + HONEY_ART_TILE.pad <= a.x
          || a.y + a.height + HONEY_ART_TILE.pad <= b.y || b.y + b.height + HONEY_ART_TILE.pad <= a.y
        expect(apart).toBe(true)
      }
    }
    expect(atlasFrame(3, true).x).toBe(atlasFrame(3, false).x)
    expect(atlasFrame(3, true).y).toBeGreaterThan(atlasFrame(3, false).y)
  })

  it('fails soft where nothing can be drawn, and only ever tries once', async () => {
    const first = warmHoneyArt([PLACEHOLDER_A, PLACEHOLDER_B])
    expect(warmHoneyArt([PLACEHOLDER_A])).toBe(first)
    await expect(first).resolves.toBeNull()
  })
})

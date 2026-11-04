// quick-menu.honey.spec.ts — the honey tile as numbers.
//
//   · the palette is the palette: ramps sample to the specified colours, the SVG
//     stops are the shader's ramp turned inside out, and every ink clears its
//     contrast floor on the body it sits on (WCAG, computed here, not asserted
//     from memory)
//   · seeded variation is a pure function of (menu, slot): the same slot looks
//     the same on every open, and no drip, bead, sliver or glint ever reaches
//     the icon or label zone
//   · the drip is periodic and finished at u = 0, never faster than 8 px/s, and
//     gone before it reaches the label
//   · label fit never goes under the floor except by textLength, and never
//     measures anything the caller did not hand it
//   · every slot in every shipped menu carries an icon the ring can draw, and
//     the icon follows the word (the iconMap), never the other way round

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { ICON_PATHS, iconPath } from './quick-menu.icons.js'
import { HEX_RADIUS, QUICK_MENU_RING } from './quick-menu.types.js'
import {
  BODY_BACK,
  BODY_BACK_LIT,
  BODY_CANCEL,
  BODY_LIT,
  BODY_REST,
  DRIP_AT,
  DRIP_PERIOD_S,
  HONEY,
  LAYOUT,
  backIcon,
  manyIcon,
  blobFall,
  blobStart,
  cancelIcon,
  contrastRatio,
  dripPose,
  emptyIcon,
  estimateWidth,
  fitLabel,
  hexPoints,
  honeyStyleSheet,
  lipPath,
  lipY,
  menuHash,
  mixHex,
  neckPath,
  neckScales,
  radialStops,
  relativeLuminance,
  ringSeed,
  sampleRamp,
  slotGlyph,
  slotHoney,
  slotIndexOf,
} from './quick-menu.honey.js'

const R = HEX_RADIUS

describe('honey palette', () => {
  it('samples the body ramps at the specified depths', () => {
    expect(sampleRamp(BODY_REST, 0)).toBe('#1d1204')
    expect(sampleRamp(BODY_REST, 0.134)).toBe('#1d1204')
    expect(sampleRamp(BODY_REST, 0.29)).toBe('#4a2d08')
    expect(sampleRamp(BODY_REST, 1)).toBe('#8c5810')
    expect(sampleRamp(BODY_LIT, 0.524)).toBe('#cf9322')
    expect(sampleRamp(BODY_LIT, 1)).toBe('#e3a42e')
    expect(sampleRamp(BODY_BACK, 1)).toBe('#3b2809')
    expect(sampleRamp(BODY_BACK_LIT, 1)).toBe('#4d3510')
    expect(sampleRamp(BODY_CANCEL, 0.6)).toBe('#7a2412')
    expect(sampleRamp(BODY_CANCEL, 1)).toBe('#7a2412')
  })

  it('interpolates piecewise linear in sRGB', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    // halfway between the 0.186 and 0.290 stops
    expect(sampleRamp(BODY_REST, 0.238)).toBe(mixHex('#2b1a05', '#4a2d08', 0.5))
  })

  it('turns the ramp inside out for the SVG: offset = 1 - dd', () => {
    expect(radialStops(BODY_REST)).toEqual([
      { offset: 0, color: '#8c5810' },
      { offset: 0.217, color: '#86520e' },
      { offset: 0.476, color: '#7d4d0c' },
      { offset: 0.71, color: '#4a2d08' },
      { offset: 0.814, color: '#2b1a05' },
      { offset: 0.866, color: '#1d1204' },
      { offset: 1, color: '#1d1204' },
    ])
    expect(radialStops(BODY_LIT).map(s => s.offset)).toEqual([0, 0.217, 0.476, 0.71, 0.814, 0.866, 1])
    // offsets only ever rise: a gradient with a falling offset is invalid
    for (const ramp of [BODY_REST, BODY_LIT, BODY_BACK, BODY_BACK_LIT, BODY_CANCEL]) {
      const offsets = radialStops(ramp).map(s => s.offset)
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets)
    }
  })

  it('lifts a lit tile by well over 2.4x in luminance, so lit survives greyscale', () => {
    // WCAG relative luminance at the plateau: 3.4x. The design quotes about 2.7x
    // averaged over the whole body; either way the step is large and one-way.
    const plateau = relativeLuminance(sampleRamp(BODY_LIT, 1)) / relativeLuminance(sampleRamp(BODY_REST, 1))
    const middle = relativeLuminance(sampleRamp(BODY_LIT, 0.524)) / relativeLuminance(sampleRamp(BODY_REST, 0.524))
    expect(plateau).toBeGreaterThan(2.4)
    expect(middle).toBeGreaterThan(2.4)
  })

  it('clears the contrast floor for every ink on the body under it', () => {
    const plateau = sampleRamp(BODY_REST, 1)
    expect(contrastRatio(HONEY.ink.rest, plateau)).toBeGreaterThanOrEqual(5.2)
    // the shader caps the rest body under the glyphs at #8f5c12
    expect(contrastRatio(HONEY.ink.rest, '#8f5c12')).toBeGreaterThanOrEqual(5.0)
    // lit ink, on the brightest and the mid lit body
    expect(contrastRatio(HONEY.ink.lit, sampleRamp(BODY_LIT, 1))).toBeGreaterThanOrEqual(8.5)
    expect(contrastRatio(HONEY.ink.lit, sampleRamp(BODY_LIT, 0.524))).toBeGreaterThanOrEqual(7)
    // back, resting and lit
    expect(contrastRatio(HONEY.ink.back, sampleRamp(BODY_BACK, 1))).toBeGreaterThanOrEqual(9)
    expect(contrastRatio(HONEY.ink.back, sampleRamp(BODY_BACK_LIT, 1))).toBeGreaterThanOrEqual(7.5)
    // cancel
    expect(contrastRatio(HONEY.ink.cancel, sampleRamp(BODY_CANCEL, 0.6))).toBeGreaterThanOrEqual(8)
  })

  it('keeps the highlights out of the body: pale gold is a rim, never a fill', () => {
    // brand rule: honey never reuses the presence wax (0.98, 0.83, 0.46)
    const wax = [250, 212, 117]
    for (const ramp of [BODY_REST, BODY_LIT, BODY_BACK, BODY_BACK_LIT, BODY_CANCEL]) {
      for (const [, color] of ramp) {
        const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
        const near = rgb.every((c, i) => Math.abs(c - wax[i]) < 12)
        expect(near).toBe(false)
      }
    }
  })

  it('has colour constants and no theme-token reads', () => {
    expect(HONEY.lit.rim).toBe('#ffd98a')
    expect(HONEY.ink.rest).toBe('#fff1cf')
    expect(HONEY.bodyAlpha).toBe(0.92)
  })
})

describe('honey geometry', () => {
  it('draws a point-top hexagon', () => {
    const points = hexPoints(R).split(' ').map(p => p.split(',').map(Number))
    expect(points).toHaveLength(6)
    expect(points[1][0]).toBeCloseTo(0, 5)
    expect(points[1][1]).toBeCloseTo(R, 5) // bottom vertex: y grows downward
    expect(points[4][0]).toBeCloseTo(0, 5)
    expect(points[4][1]).toBeCloseTo(-R, 5) // top vertex: the top is negative
    expect(points[0][0]).toBeCloseTo(R * Math.sqrt(3) / 2, 1)
  })

  it('insets the light lines by 1.5 and 2.5 px from the edge', () => {
    const inradius = R * Math.sqrt(3) / 2
    expect(HONEY.meniscus.circumradius * Math.sqrt(3) / 2).toBeCloseTo(inradius - 1.5, 1)
    expect(HONEY.transmitted.circumradius * Math.sqrt(3) / 2).toBeCloseTo(inradius - 2.6, 1)
    // the light vector ends on the middle of the top-left edge
    expect(Math.hypot(HONEY.meniscus.x2, HONEY.meniscus.y2)).toBeCloseTo(inradius, 1)
  })

  it('puts the sliver and the glint on the lip, above the icon zone', () => {
    const lipBottom = -0.5 * R + 0.03 * R
    for (const y of [HONEY.sliver.y1, HONEY.sliver.y2, HONEY.glint.y]) expect(y).toBeLessThan(lipBottom)
    // and left of centre where the light is, clear of the neck at +-0.5R
    for (const x of [HONEY.sliver.x1, HONEY.sliver.x2, HONEY.glint.x]) expect(x).toBeLessThan(0)
  })
})

describe('seeded variation', () => {
  it('hashes and seeds deterministically', () => {
    expect(menuHash('root')).toBe(menuHash('root'))
    expect(menuHash('root')).not.toBe(menuHash('root:view'))
    for (const name of ['root', 'selection', 'selection:edit', 'slides']) {
      for (let i = 0; i < 7; i++) {
        const seed = ringSeed(i, name)
        expect(seed).toBe(ringSeed(i, name))
        expect(seed).toBeGreaterThanOrEqual(0)
        expect(seed).toBeLessThan(1)
      }
    }
  })

  it('gives neighbouring slots different tiles', () => {
    const seeds = new Set([0, 1, 2, 3, 4, 5, 6].map(i => ringSeed(i, 'root').toFixed(4)))
    expect(seeds.size).toBe(7)
  })

  it('numbers the slots: centre 0, ring 1..6 in screen-angle order', () => {
    expect(slotIndexOf('centre')).toBe(0)
    expect(QUICK_MENU_RING.map(slotIndexOf)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('wavers the lip by 0.03 R about -0.50 R', () => {
    for (let seed = 0; seed < 1; seed += 0.05) {
      for (let x = -R; x <= R; x += 4) {
        const y = lipY(x, seed)
        expect(y).toBeGreaterThanOrEqual(-0.53 * R - 1e-9)
        expect(y).toBeLessThanOrEqual(-0.47 * R + 1e-9)
      }
    }
  })

  it('keeps every drip clear of the icon and the label, for every seed', () => {
    const iconHalf = 0.33 * R
    const labelTop = 0.17 * R
    for (let k = 0; k < 400; k++) {
      const honey = slotHoney(k / 400)
      for (const drip of [honey.a, honey.b]) {
        // lives at |x| in [0.45R, 0.55R]
        expect(Math.abs(drip.x)).toBeGreaterThanOrEqual(0.45 * R - 1e-9)
        expect(Math.abs(drip.x)).toBeLessThanOrEqual(0.55 * R + 1e-9)
        expect(drip.radius).toBeLessThanOrEqual(0.09 * R)
        // inner edge of the bead, swollen by the 1.35 the lit drip grows to
        expect(Math.abs(drip.x) - drip.radius * 1.35).toBeGreaterThanOrEqual(iconHalf)
        // length 0.12R to 0.22R
        expect(drip.length).toBeGreaterThanOrEqual(0.12 * R - 1e-9)
        expect(drip.length).toBeLessThanOrEqual(0.22 * R + 1e-9)
        // the static tip hangs well above the label zone (0.14R of margin)
        expect(drip.y0 + drip.length).toBeLessThanOrEqual(labelTop - 0.14 * R)
        expect(drip.h).toBeCloseTo(drip.length - drip.radius, 9)
      }
      // two drips, on opposite sides
      expect(Math.sign(honey.a.x)).toBe(-Math.sign(honey.b.x))
      expect(honey.sliverScale).toBeGreaterThanOrEqual(0.85)
      expect(honey.sliverScale).toBeLessThanOrEqual(1)
    }
  })

  it('mirrors the pair when the seed passes one half', () => {
    expect(slotHoney(0.2).a.x).toBeLessThan(0)
    expect(slotHoney(0.2).b.x).toBeGreaterThan(0)
    expect(slotHoney(0.8).a.x).toBeGreaterThan(0)
    expect(slotHoney(0.8).b.x).toBeLessThan(0)
  })

  it('writes the lip and the neck as finite, closed paths', () => {
    for (let k = 0; k < 50; k++) {
      const honey = slotHoney(k / 50)
      const lip = lipPath(honey)
      expect(lip).toBe(lipPath(honey))
      expect(lip).toMatch(/^M/)
      expect(lip).toMatch(/Z$/)
      expect(lip).toMatch(/A/) // the bead of drip A
      expect(lip).not.toMatch(/NaN|undefined|Infinity/)
      const neck = neckPath(honey.b)
      expect(neck).toMatch(/^M.*Z$/)
      expect(neck).not.toMatch(/NaN|undefined|Infinity/)
    }
  })
})

describe('the animated drip', () => {
  const h = 5

  it('is finished at u = 0 and loops seamlessly at u = 1', () => {
    const rest = dripPose(0, h)
    expect(rest).toEqual({
      neckSx: 1, neckSy: 1, beadDy: 0, beadScale: 1, groupScale: 1, groupOpacity: 1,
      blobOpacity: 0, blobDy: 0, blobSx: 1, blobSy: 1,
    })
    const end = dripPose(0.999999, h)
    expect(end.groupScale).toBeCloseTo(1, 4)
    expect(end.groupOpacity).toBeCloseTo(1, 4)
    expect(end.beadDy).toBe(0)
    expect(end.neckSy).toBe(1)
    expect(end.blobOpacity).toBe(0)
    expect(dripPose(1, h)).toEqual(rest)
    expect(dripPose(7.0, h)).toEqual(rest)
  })

  it('holds the static pose for the first tenth', () => {
    expect(dripPose(0.05, h)).toEqual(dripPose(0, h))
    expect(dripPose(DRIP_AT.swellFrom - 1e-6, h)).toEqual(dripPose(0, h))
  })

  it('swells to +0.10 R and 1.35x, draws to +0.14 R, then pinches to a thread', () => {
    const swollen = dripPose(DRIP_AT.swellTo - 1e-6, h)
    expect(swollen.beadDy).toBeCloseTo(0.1 * R, 1)
    expect(swollen.beadScale).toBeCloseTo(1.35, 2)
    const drawn = dripPose(DRIP_AT.neckTo - 1e-6, h)
    expect(drawn.beadDy).toBeCloseTo(0.14 * R, 1)
    expect(drawn.neckSx).toBeCloseTo(0.4, 2)
    const pinched = dripPose(DRIP_AT.pinchTo - 1e-6, h)
    expect(pinched.neckSx).toBeCloseTo(0.15, 2)
    // the bead bottom never goes past 0.14R below its rest position
    for (let u = 0; u < DRIP_AT.pinchTo; u += 0.002) expect(dripPose(u, h).beadDy).toBeLessThanOrEqual(0.14 * R + 1e-6)
  })

  it('hands over to the falling drop at 0.58 and regrows from the lip', () => {
    const before = dripPose(DRIP_AT.pinchTo - 1e-6, h)
    const after = dripPose(DRIP_AT.pinchTo + 1e-6, h)
    expect(before.groupOpacity).toBe(1)
    expect(before.blobOpacity).toBe(0)
    expect(after.groupOpacity).toBeCloseTo(0, 3)
    expect(after.groupScale).toBeCloseTo(0.35, 2)
    expect(after.blobOpacity).toBeCloseTo(1, 3)
    // the children are back at rest while the root regrows
    expect(after.beadDy).toBe(0)
    expect(after.neckSx).toBe(1)
    expect(after.neckSy).toBe(1)
    // regrowth rises monotonically to the full drip
    let last = 0
    for (let u = DRIP_AT.pinchTo + 1e-6; u < 1; u += 0.01) {
      const g = dripPose(u, h).groupOpacity
      expect(g).toBeGreaterThanOrEqual(last - 1e-9)
      last = g
    }
  })

  it('never moves faster than 8 px/s, and a frame at 30 fps moves under 0.3 px', () => {
    const dt = 1 / 60
    let worst = 0
    let prev = dripPose(0, h)
    for (let t = dt; t < DRIP_PERIOD_S; t += dt) {
      const pose = dripPose(t / DRIP_PERIOD_S, h)
      const jumped = (prev.groupOpacity === 1 && pose.groupOpacity < 0.5) // the single snap at 0.58
      if (!jumped) {
        worst = Math.max(
          worst,
          Math.abs(pose.beadDy - prev.beadDy) / dt,
          Math.abs(pose.blobDy - prev.blobDy) / dt,
        )
      }
      prev = pose
    }
    expect(worst).toBeLessThan(8)
    expect(worst / 30).toBeLessThan(0.3)
  })

  it('fades the falling drop out before it can reach the label', () => {
    expect(blobFall(0).opacity).toBe(1)
    expect(blobFall(0.45).opacity).toBe(1)
    expect(blobFall(0.85).opacity).toBe(0)
    expect(blobFall(1).dy).toBeCloseTo(0.3 * R, 5)
    const labelTop = 0.17 * R
    for (let k = 0; k < 200; k++) {
      const honey = slotHoney(k / 200)
      const start = blobStart(honey.b)
      for (let tau = 0; tau <= 1; tau += 0.01) {
        const f = blobFall(tau)
        if (f.opacity < 0.05) continue
        const bottom = start.cy + f.dy + start.r * f.sy
        expect(bottom).toBeLessThan(labelTop)
      }
    }
  })

  it('scales the neck with the bead, from the slot\'s own length', () => {
    const scales = neckScales(h)
    expect(scales.swell).toBeCloseTo((h + 0.1 * R) / h, 9)
    expect(scales.neck).toBeCloseTo((h + 0.14 * R) / h, 9)
    expect(dripPose(DRIP_AT.swellTo - 1e-6, h).neckSy).toBeCloseTo(scales.swell, 3)
  })
})

describe('the stylesheet', () => {
  const css = honeyStyleSheet()

  it('animates transform and opacity only', () => {
    const keyframes = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})+[^}]*\}/g) ?? []
    // the drip's four, then the bloom, the drift and the light
    expect(keyframes).toHaveLength(7)
    for (const block of keyframes) {
      const props = [...block.matchAll(/(?:^|[{;\s])([a-z-]+):/g)].map(m => m[1])
      for (const prop of props) {
        // `scale` is the individual transform property (the bloom keeps the slot's translate)
        expect(['transform', 'scale', 'opacity', 'animation-timing-function']).toContain(prop)
      }
    }
  })

  it('runs one slow cycle and nothing else', () => {
    expect(css).toContain(`${DRIP_PERIOD_S}s linear infinite`)
    expect(css).toContain('.hc-qd-run .hc-qd-drip')
    expect(css).toContain('.hc-qd-run .hc-qd-blob')
  })

  it('stops under reduced motion and hides honey under forced colours', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^@]*animation:none !important/)
    expect(css).toMatch(/@media \(forced-colors: active\)\{[^@]*\.hc-hq[^@]*display:none !important/)
    expect(css).toContain('CanvasText')
    expect(css).toContain('Canvas')
  })

  it('has no filters, blurs, masks or patterns', () => {
    expect(css).not.toMatch(/filter|blur|mask|pattern/i)
  })
})

describe('label fit', () => {
  const half: (text: string, size: number) => number = (text, size) => text.length * size * 0.5

  it('leaves a label that fits alone', () => {
    expect(fitLabel('tags', 11.5, 65, half)).toEqual({ size: 11.5 })
    expect(fitLabel('', 11.5, 65, half)).toEqual({ size: 11.5 })
  })

  it('shrinks a long label by font size, to the floor', () => {
    const fit = fitLabel('collections-x', 11.5, 65, half) // 13 chars * 0.5 * 11.5 = 74.75
    expect(fit.textLength).toBeUndefined()
    expect(fit.size).toBeLessThan(11.5)
    expect(fit.size).toBeGreaterThanOrEqual(LAYOUT.floorSize)
    expect(half('collections-x', fit.size)).toBeLessThanOrEqual(65.5)
  })

  it('squeezes with textLength only as the last resort', () => {
    const fit = fitLabel('x'.repeat(40), 11.5, 65, half)
    expect(fit).toEqual({ size: LAYOUT.floorSize, textLength: 65 })
  })

  it('starts text-only labels at 13 px', () => {
    expect(LAYOUT.textOnly.labelSize).toBe(13)
    expect(LAYOUT.textOnly.labelY).toBe(4.5)
    expect(LAYOUT.ring.labelSize).toBe(11.5)
    expect(LAYOUT.ring.labelY).toBe(19)
  })

  it('estimates by glyph class when nothing can be measured', () => {
    expect(estimateWidth('', 12)).toBe(0)
    expect(estimateWidth('mm', 10)).toBeGreaterThan(estimateWidth('ii', 10))
    expect(estimateWidth('日本', 10)).toBeGreaterThan(estimateWidth('ab', 10))
  })
})

// ── icons ───────────────────────────────────────────────────────────────

/** The iconMap: the glyph each WORD wears. Data, in the order the design states it. */
const ICON_MAP: Readonly<Record<string, string>> = {
  command: 'terminal', collections: 'folder_open', history: 'history', tree: 'account_tree',
  help: 'tips_and_updates', view: 'layers', fit: 'center_focus_strong', present: 'slideshow', theme: 'palette',
  layout: 'dashboard', arrange: 'view_module', website: 'web', tutor: 'school', run: 'play_arrow',
  step: 'skip_next', stop: 'stop', list: 'view_list', new: 'add', save: 'save', build: 'build',
  exit: 'hexagon', next: 'chevron_right', previous: 'chevron_left', first: 'skip_previous',
  last: 'skip_next', done: 'check', select: 'check_circle', all: 'select_all', edit: 'edit',
  organize: 'category', groups: 'hub', find: 'search', go: 'explore', share: 'share',
  publish: 'cloud_upload', republish: 'sync', keys: 'key', invite: 'person_add',
  follow: 'notifications', hide: 'visibility_off', remove: 'delete', shelf: 'bookmark',
  'to shelf': 'bookmark', back: 'arrow_back', cancel: 'close',
  images: 'photo_library', generate: 'auto_awesome',
  explore: 'explore', hosts: 'web', behavior: 'build', agent: 'auto_awesome', discover: 'explore', shelves: 'bookmark',
}

describe('slot icons', () => {
  const menus = new QuickMenuRegistry().all()

  it('gives every slot of every shipped menu an icon the ring can draw', () => {
    expect(menus.length).toBeGreaterThanOrEqual(11)
    for (const menu of menus) {
      for (const slot of menu.slots) {
        expect(slot.icon, `${menu.name}/${slot.direction}/${slot.label}`).toBeTruthy()
        expect(iconPath(slot.icon), `${menu.name}/${slot.label}: ${slot.icon}`).toBeTruthy()
        expect(slotGlyph(slot.icon)).toBe(iconPath(slot.icon))
      }
    }
  })

  it('follows the word: the same word wears the same glyph in every ring', () => {
    for (const menu of menus) {
      for (const slot of menu.slots) {
        expect(ICON_MAP[slot.label], `no iconMap entry for "${slot.label}"`).toBeDefined()
        expect(slot.icon, `${menu.name}/${slot.label}`).toBe(ICON_MAP[slot.label])
      }
    }
  })

  it('never shares a glyph inside one ring, nor with back or cancel', () => {
    for (const menu of menus) {
      const names = menu.slots.map(s => s.icon)
      expect(new Set(names).size, menu.name).toBe(names.length)
      expect(names).not.toContain(backIcon)
      // the many-tiles stack's glyph is the middle's alone
      expect(names).not.toContain(manyIcon)
      expect(names).not.toContain(cancelIcon)
    }
  })

  it('keeps the differentiation rules', () => {
    expect(ICON_MAP.view).toBe('layers') // not visibility: that is hide's
    expect(ICON_MAP.hide).toBe('visibility_off')
    expect(ICON_MAP.remove).not.toBe(ICON_MAP.hide)
    expect(ICON_MAP.exit).toBe('hexagon') // never reads as back or cancel
    expect(ICON_MAP.done).not.toBe(ICON_MAP.select)
    expect(ICON_MAP.stop).not.toBe(cancelIcon) // a square, never a dismiss
    expect(ICON_MAP.next).not.toBe(ICON_MAP.last)
  })

  it('draws every glyph the injected cells and the registry use', () => {
    for (const name of [backIcon, cancelIcon, emptyIcon, ...Object.values(ICON_MAP)]) {
      const d = iconPath(name)
      expect(d, name).toBeTruthy()
      expect(d).toMatch(/^M/)
      expect(d).toMatch(/Z$/)
      expect(d).not.toMatch(/NaN|undefined/)
    }
  })

  it('has no drawing for what it does not know: the word is the identity', () => {
    expect(iconPath(undefined)).toBeUndefined()
    expect(iconPath('')).toBeUndefined()
    expect(iconPath('not_a_glyph')).toBeUndefined()
    expect(iconPath('toString')).toBeUndefined()
    expect(slotGlyph('zebra')).toBeUndefined()
  })

  it('keeps every path inside its 24 grid', () => {
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]))
      // arc radii and flags are small; coordinates stay on the grid
      for (const v of nums) {
        expect(v, name).toBeGreaterThanOrEqual(-2)
        expect(v, name).toBeLessThanOrEqual(26)
      }
    }
  })
})

describe('the icon module', () => {
  it('is the glyphs the shipped font draws: regenerate with scripts/extract-quick-menu-icons.cjs when this goes red', () => {
    const script = resolve(__dirname, '../../../scripts/extract-quick-menu-icons.cjs')
    const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' })
    expect(run.stderr + run.stdout).toContain('ok')
    expect(run.status).toBe(0)
  })
})

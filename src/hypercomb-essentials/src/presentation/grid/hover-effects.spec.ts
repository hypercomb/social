// The hover animation is an extension point (hover-effects.ts). This spec holds
// the three promises that make it one: the tile's OWN versions are the code
// that was always there, a name we do not ship falls back to them, and the
// shader the word reaches is built from the same table the word is read from.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  HOVER_ANIMATION_TRAIT,
  HOVER_EFFECTS,
  HOVER_FX_GLSL,
  OWN_LEAF_EFFECT,
  OWN_PATHWAY_EFFECT,
  hoverEffectId,
} from './hover-effects.js'

const here = dirname(fileURLToPath(import.meta.url))
const shader = readFileSync(join(here, 'hex-sdf.shader.ts'), 'utf8')

describe('the table', () => {
  it('has ascending positive ids and one word per look', () => {
    const ids = HOVER_EFFECTS.map(e => e.id)
    expect(ids.every(id => id >= 1)).toBe(true)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(HOVER_EFFECTS.map(e => e.word)).size).toBe(HOVER_EFFECTS.length)
  })

  it('ships the looks the trait was made for', () => {
    const words = HOVER_EFFECTS.map(e => e.word)
    for (const word of ['glow', 'mist', 'smoke', 'celebrate']) expect(words).toContain(word)
  })

  it('names the two own versions among the looks, so a tile can choose the other one', () => {
    expect(hoverEffectId(OWN_PATHWAY_EFFECT)).toBeGreaterThan(0)
    expect(hoverEffectId(OWN_LEAF_EFFECT)).toBeGreaterThan(0)
    expect(OWN_PATHWAY_EFFECT).not.toBe(OWN_LEAF_EFFECT)
  })
})

describe('a filler tile is picked by its name', () => {
  it('folds the way every trait word does', () => {
    expect(hoverEffectId('mist')).toBe(hoverEffectId('Mist'))
    expect(hoverEffectId('mist')).toBe(hoverEffectId('  MIST '))
    expect(hoverEffectId('mist')).toBeGreaterThan(0)
  })

  it('answers 0 — the own version — for a name we do not ship, so a peer mark cannot bring a look', () => {
    expect(hoverEffectId('lava')).toBe(0)
    expect(hoverEffectId('')).toBe(0)
    expect(hoverEffectId(undefined)).toBe(0)
    expect(hoverEffectId(null)).toBe(0)
  })

  it('is a word the trait command can open', () => {
    expect(HOVER_ANIMATION_TRAIT).toBe('hover-animation')
  })
})

describe('the shader', () => {
  it('is built from the table: every look is dispatched by its own id', () => {
    for (const effect of HOVER_EFFECTS) {
      expect(HOVER_FX_GLSL).toContain(`id < ${effect.id}.5`)
      expect(HOVER_FX_GLSL).toContain(effect.call)
    }
  })

  it('picks the own version by kind when no filler is chosen', () => {
    expect(HOVER_FX_GLSL).toContain('fx > 0.5 ? fx : (pathway ?')
    expect(HOVER_FX_GLSL).toContain(`? ${hoverEffectId(OWN_PATHWAY_EFFECT)}.0 : ${hoverEffectId(OWN_LEAF_EFFECT)}.0`)
  })

  it('keeps the own versions as they always were', () => {
    // PATHWAY: a breathing accent ring, two glints orbiting the rim, a soft bloom.
    expect(HOVER_FX_GLSL).toContain('float breathe = 0.79 + 0.21 * sin(u_time * 2.1);')
    expect(HOVER_FX_GLSL).toContain('smoothstep(0.90, 1.0, cos(2.0 * (ang - u_time * 1.3))) * ring')
    expect(HOVER_FX_GLSL).toContain('color.rgb += u_accentColor * bloom * (0.10 + 0.07 * breathe);')
    // LEAF: a tight cool-neutral outline, no motion.
    expect(HOVER_FX_GLSL).toContain('vec3 leafHover = vec3(0.74, 0.82, 0.94);')
    expect(HOVER_FX_GLSL).toContain('color.rgb = mix(color.rgb, leafHover, leafRing * 0.6);')
  })

  it('splices the looks in and calls them from the hover branch, with the uniform declared', () => {
    expect(shader).toContain("import { HOVER_FX_GLSL } from './hover-effects.js'")
    expect(shader).toContain('${HOVER_FX_GLSL}')
    expect(shader).toContain('uniform float u_hoverFx;')
    expect(shader).toContain('hfxApply(u_hoverFx, vHasBranch > 0.5, color, d, aa, local);')
  })

  it('declares the looks before the hover branch uses them', () => {
    const splice = shader.indexOf('${HOVER_FX_GLSL}')
    const call = shader.indexOf('hfxApply(u_hoverFx')
    expect(splice).toBeGreaterThan(shader.indexOf('uniform float u_time;'))
    expect(splice).toBeGreaterThan(shader.indexOf('uniform float u_radiusPx;'))
    expect(splice).toBeGreaterThan(shader.indexOf('uniform vec3 u_accentColor;'))
    expect(call).toBeGreaterThan(splice)
  })

  it('stays inside the hexagon: no look reaches past the edge the final alpha trims', () => {
    // Every depth is measured inward (d <= 0); an outward halo would be cut.
    expect(HOVER_FX_GLSL).not.toMatch(/max\(d,\s*0\.0\)/)
  })

  it('holds no look in the vertex stage or per tile: one uniform, one hovered tile', () => {
    expect(shader).not.toMatch(/in float aHoverFx/)
  })
})

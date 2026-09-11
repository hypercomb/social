// The tile look is stated twice — in the shader's GLSL and in tile-look.ts for
// the surfaces that preview a tile outside WebGL. This reads the shader source
// and fails the moment the two disagree.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TILE_LOOK, tileLookAa } from './tile-look.js'

const here = dirname(fileURLToPath(import.meta.url))
const shader = readFileSync(join(here, 'hex-sdf.shader.ts'), 'utf8')

/** GLSL float literal the way the shader writes them (`1.0`, `0.45`). */
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n))

describe('tile look — preview constants match the hex shader', () => {
  it('anti-alias band', () => {
    expect(shader).toContain(`max(u_radiusPx * ${f(TILE_LOOK.aa.factor)}, ${f(TILE_LOOK.aa.floor)})`)
    expect(tileLookAa(200)).toBe(8)
    expect(tileLookAa(10)).toBe(1.5)
  })

  it('rim and inner glow over a picture', () => {
    expect(shader).toContain(`smoothstep(0.0, aa * ${f(TILE_LOOK.rim.widthAa)}, abs(d))`)
    expect(shader).toContain(`outerRing * ${f(TILE_LOOK.rim.mix)}`)
    expect(shader).toContain(`smoothstep(0.0, aa * ${f(TILE_LOOK.glow.widthAa)}, abs(d + aa * ${f(TILE_LOOK.glow.insetAa)}))`)
    expect(shader).toContain(`innerGlow * ${f(TILE_LOOK.glow.mixImage)}`)
    expect(shader).toContain(`innerGlowE * ${f(TILE_LOOK.glow.mixEmpty)}`)
  })

  it('vignette and bevel', () => {
    expect(shader).toContain(`smoothstep(${f(TILE_LOOK.vignette.from)}, ${f(TILE_LOOK.vignette.to)}, dist)`)
    expect(shader).toContain(`vignette * ${f(TILE_LOOK.vignette.strength)}`)
    expect(shader).toContain(`edgeProximity * ${f(TILE_LOOK.bevel.highlight)}`)
    expect(shader).toContain(`edgeProximity * ${f(TILE_LOOK.bevel.shadow)}`)
    expect(shader).toContain(`-aa * ${f(TILE_LOOK.bevel.reachAa)}`)
    expect(shader).toContain(`normalize(vec2(${f(TILE_LOOK.bevel.light.x)}, ${f(TILE_LOOK.bevel.light.y)}))`)
  })

  it('empty ground and name band', () => {
    expect(shader).toContain(`vec3(${TILE_LOOK.empty.centre.map(f).join(', ')})`)
    expect(shader).toContain(`vec3(${TILE_LOOK.empty.edge.map(f).join(', ')})`)
    expect(shader).toContain(`u_radiusPx * ${f(TILE_LOOK.band.halfRowR)}`)
    expect(shader).toContain(`imgBlend * ${f(TILE_LOOK.band.mixImage)}`)
  })
})

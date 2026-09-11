// presentation/grid/tile-look.ts
//
// THE TILE'S LOOK, AS NUMBERS — what the hex shader draws OVER a tile's
// picture at display time: the rim, the inner glow, the vignette, the bevel
// and the name band.
//
// The shader is GLSL in a string and cannot import these, so they are stated
// twice on purpose — once in `hex-sdf.shader.ts`, once here for the surfaces
// that preview a tile outside the WebGL canvas (the tile editor). The drift
// spec beside this file reads the shader source and fails the moment the two
// disagree, so the preview can never quietly stop being the tile.
//
// None of this is ever written into a picture. It is the renderer's job; see
// `editor/hex-capture.ts`.
//
// Distances are in units of R, the hex's inner radius (half the flat-to-flat
// width), which is the `u_radiusPx` the shader measures from.

export const TILE_LOOK = {
  /** The anti-alias band: `max(R × factor, floor px)`. */
  aa: { factor: 0.04, floor: 1.5 },
  /** The crisp outer border line, `1.2 aa` wide, border colour at 60%. */
  rim: { widthAa: 1.2, mix: 0.6 },
  /** The softer inner border, centred `1.5 aa` inside the edge. */
  glow: { insetAa: 1.5, widthAa: 3.5, mixImage: 0.12, mixEmpty: 0.15 },
  /** Picture edges darken from half the radius out. */
  vignette: { from: 0.5, to: 1.0, strength: 0.45 },
  /** Top-left light, bottom-right shade, within `4 aa` of the edge. */
  bevel: { reachAa: 4, highlight: 0.06, shadow: 0.08, light: { x: -0.5, y: -0.866 } },
  /** An empty tile's ground, centre to edge. */
  empty: { centre: [0.06, 0.14, 0.22], edge: [0.03, 0.08, 0.13] },
  /** The name band's half-height, and how dark it lays over a picture. */
  band: { halfRowR: 0.15, mixImage: 0.85 },
} as const

/** The anti-alias band in pixels for an inner radius in pixels. */
export const tileLookAa = (radius: number): number =>
  Math.max(radius * TILE_LOOK.aa.factor, TILE_LOOK.aa.floor)

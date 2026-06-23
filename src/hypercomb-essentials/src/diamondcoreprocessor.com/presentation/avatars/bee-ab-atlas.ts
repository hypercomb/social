// diamondcoreprocessor.com/presentation/avatars/bee-ab-atlas.ts
//
// Bakes the approved "AB" bee — the cute front-facing cartoon honeybee with
// the simple loved wing flap, rear slightly lifted into a flying lean — into a
// single GPU texture ATLAS of N wing-flap frames.
//
// Why a baked atlas (vs the procedural SDF shader it replaces): AB is
// hand-authored vector with detail the SDF can't carry (big glossy eyes +
// catchlights, blush, smile, the exact wing shape). We author once in SVG
// (quality), rasterize to one wide texture (performance), and let the swarm
// shader pick a cell by flap phase — the loved flap survives, and 2048 bees
// still cost one draw call. Per the bee-swarm graphics strategy: vector-author,
// bake to texture, render textured quads, keep it cheap at scale.
//
// One row of `frames` cells, each `cellPx` square, drawn in AB's 200-unit
// viewBox. The wings rotate per frame across the loved -16°↔+12° (left) /
// +16°↔-12° (right) flap; everything else is static (bob/flight/turn come from
// the drone's per-bee buffers + shader, not the atlas).

import { Texture } from 'pixi.js'

export interface BeeAtlas {
  texture: Texture
  /** Number of flap frames laid out left-to-right. */
  frames: number
  /** Square cell size in px (one frame). */
  cellPx: number
}

const DEFAULT_FRAMES = 8
const DEFAULT_CELL = 96 // 3× the ~32px bee quad — crisp without LOD; bump for closer zoom

/** sin²(πp): 0 at p=0, 1 at p=0.5, 0 at p=1 — the eased flap sweep. */
const flapSweep = (p: number): number => {
  const s = Math.sin(Math.PI * p)
  return s * s
}

/** The AB bee as an SVG string with wings rotated for flap phase `p` ∈ [0,1).
 *  Left wing sweeps -16°→+12°→-16°; right wing mirrors (+16°→-12°→+16°). */
const beeSvg = (p: number, px: number): string => {
  const sweep = flapSweep(p)
  const lAng = (-16 + 28 * sweep).toFixed(2)
  const rAng = (16 - 28 * sweep).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 200 200">
    <g transform="rotate(${lAng} 78 92)">
      <path d="M78,92 C50,76 22,78 18,95 C16,110 44,108 70,100 C76,98 79,95 78,92 Z" fill="rgba(216,232,255,0.56)" stroke="#a7c2e2" stroke-width="1.2"/>
      <path d="M74,94 C52,84 34,84 24,90" fill="none" stroke="#a7c2e2" stroke-width="0.8" opacity="0.6"/>
    </g>
    <g transform="rotate(${rAng} 122 92)">
      <path d="M122,92 C150,76 178,78 182,95 C184,110 156,108 130,100 C124,98 121,95 122,92 Z" fill="rgba(216,232,255,0.56)" stroke="#a7c2e2" stroke-width="1.2"/>
      <path d="M126,94 C148,84 166,84 176,90" fill="none" stroke="#a7c2e2" stroke-width="0.8" opacity="0.6"/>
    </g>
    <clipPath id="ab"><path d="M100,98 C129,98 142,115 142,134 C142,153 126,166 108,164 C90,162 58,153 58,132 C58,114 71,98 100,98 Z"/></clipPath>
    <g clip-path="url(#ab)">
      <rect x="50" y="95" width="100" height="80" fill="#f7b733"/>
      <path d="M57,118 Q100,128 143,118 L143,131 Q100,141 57,131 Z" fill="#2c1e10"/>
      <path d="M60,144 Q100,153 135,143 L134,155 Q100,164 64,155 Z" fill="#2c1e10"/>
      <ellipse cx="100" cy="114" rx="40" ry="11" fill="#ffd96f" opacity="0.4"/>
      <ellipse cx="100" cy="156" rx="28" ry="8" fill="#b9760f" opacity="0.28"/>
    </g>
    <path d="M108,163 C113,168 117,172 117,172 C113,170 109,168 106,165 Z" fill="#3a2814"/>
    <g stroke="#3a2814" stroke-width="2.6" stroke-linecap="round" fill="none">
      <path d="M90,158 C86,166 86,172 90,177"/><path d="M108,160 C112,168 112,174 108,179"/><path d="M100,162 C99,170 100,176 100,180"/>
    </g>
    <circle cx="100" cy="98" r="20" fill="#c58a38"/><circle cx="94" cy="93" r="11" fill="#e6ae57" opacity="0.5"/>
    <circle cx="100" cy="66" r="36" fill="#c58a38"/>
    <path d="M86,38 C81,25 80,16 82,8" fill="none" stroke="#3a2814" stroke-width="2.6" stroke-linecap="round"/><circle cx="82" cy="6" r="3.8" fill="#3a2814"/>
    <path d="M114,37 C120,24 126,16 131,11" fill="none" stroke="#3a2814" stroke-width="2.6" stroke-linecap="round"/><circle cx="132" cy="9" r="3.8" fill="#3a2814"/>
    <circle cx="73" cy="80" r="6" fill="#ff9d5b" opacity="0.34"/><circle cx="125" cy="78" r="6" fill="#ff9d5b" opacity="0.34"/>
    <ellipse cx="85" cy="69" rx="8.5" ry="11.5" fill="#211710"/><circle cx="88" cy="63.5" r="3.1" fill="#fff"/><circle cx="82" cy="74" r="1.4" fill="#fff" opacity="0.72"/>
    <ellipse cx="116" cy="67" rx="11" ry="14" fill="#211710"/><circle cx="120" cy="60.5" r="4" fill="#fff"/><circle cx="112" cy="73" r="1.8" fill="#fff" opacity="0.72"/>
    <path d="M94,86 q9,7 18,1" fill="none" stroke="#3a2814" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`
}

/** Rasterize one SVG string to a decoded <img> at the given pixel size. */
const svgToImage = async (svg: string, px: number): Promise<HTMLImageElement> => {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image(px, px)
  img.src = url
  await img.decode()
  return img
}

/** Bake AB into a `frames`-cell horizontal flap atlas and wrap it as a Pixi
 *  Texture. Runs on the main thread (DOM canvas) — call once at warmup and hand
 *  the texture to the swarm mesh. Returns null if 2D canvas is unavailable. */
export const bakeBeeAtlas = async (
  frames: number = DEFAULT_FRAMES,
  cellPx: number = DEFAULT_CELL,
): Promise<BeeAtlas | null> => {
  const canvas = document.createElement('canvas')
  canvas.width = cellPx * frames
  canvas.height = cellPx
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  for (let i = 0; i < frames; i++) {
    const img = await svgToImage(beeSvg(i / frames, cellPx), cellPx)
    ctx.drawImage(img, i * cellPx, 0, cellPx, cellPx)
  }

  return { texture: Texture.from(canvas), frames, cellPx }
}

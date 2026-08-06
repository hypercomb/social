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

/** The four colours that make a bee LOOK like a particular kind of bee.
 *  Everything else in the drawing (highlights, shading) is derived from these
 *  by mixing toward white/black, so a caller only ever picks colours it can
 *  reason about. AB — the approved default — is `AB_PALETTE`. */
export interface BeePalette {
  /** Striped abdomen base. */
  body: string
  /** The dark stripes, and every outline (legs, antennae, smile). */
  stripe: string
  /** Head + thorax fur. */
  head: string
  /** Wing fill (translucent) — the wing edge is derived from it. */
  wing: string
}

export const AB_PALETTE: BeePalette = {
  body: '#f7b733',
  stripe: '#2c1e10',
  head: '#c58a38',
  wing: '#cfe1ff',
}

/** A small mark worn on the bee's back, saying what KIND of worker it is —
 *  readable at a glance across a hive without reading any text.
 *    burst  an AI model is thinking      gear  a script is running
 *    ring   background housekeeping      eye   the orchestrator, watching
 *  `none` is a plain bee. */
export type BeeEmblem = 'none' | 'burst' | 'gear' | 'ring' | 'eye'

/** Centre of the emblem on the abdomen, between the two stripes. */
const EMBLEM_AT = { x: 100, y: 137, r: 9.5 }
/** Where the emblem goes when the belly is carrying a NAME — up onto the first
 *  stripe, smaller, so the two marks stack instead of overprinting. */
const EMBLEM_AT_NAMED = { x: 100, y: 125, r: 7 }

const emblemSvg = (emblem: BeeEmblem, ink: string, named = false): string => {
  const { x, y, r } = named ? EMBLEM_AT_NAMED : EMBLEM_AT
  switch (emblem) {
    case 'burst': {
      // Six spokes — the "thinking" star. Drawn, not rotated, so the bake
      // stays one flat string per frame.
      const spokes = [0, 30, 60, 90, 120, 150].map(deg => {
        const a = (deg * Math.PI) / 180
        const dx = Math.cos(a) * r
        const dy = Math.sin(a) * r
        return `<line x1="${(x - dx).toFixed(1)}" y1="${(y - dy).toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(y + dy).toFixed(1)}"/>`
      }).join('')
      return `<g stroke="${ink}" stroke-width="2.1" stroke-linecap="round" opacity="0.92">${spokes}</g>`
    }
    case 'gear':
      return `<g stroke="${ink}" stroke-width="2" fill="none" opacity="0.9">`
        + `<circle cx="${x}" cy="${y}" r="${(r * 0.6).toFixed(1)}"/>`
        + [0, 45, 90, 135].map(deg => {
          const a = (deg * Math.PI) / 180
          const dx = Math.cos(a); const dy = Math.sin(a)
          return `<line x1="${(x + dx * r * 0.75).toFixed(1)}" y1="${(y + dy * r * 0.75).toFixed(1)}" x2="${(x + dx * r).toFixed(1)}" y2="${(y + dy * r).toFixed(1)}"/>`
            + `<line x1="${(x - dx * r * 0.75).toFixed(1)}" y1="${(y - dy * r * 0.75).toFixed(1)}" x2="${(x - dx * r).toFixed(1)}" y2="${(y - dy * r).toFixed(1)}"/>`
        }).join('')
        + `</g>`
    case 'ring':
      return `<circle cx="${x}" cy="${y}" r="${(r * 0.8).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="2.1" opacity="0.9"/>`
    case 'eye':
      return `<g opacity="0.92"><path d="M${x - r},${y} Q${x},${y - r * 0.85} ${x + r},${y} Q${x},${y + r * 0.85} ${x - r},${y} Z" fill="none" stroke="${ink}" stroke-width="1.9"/>`
        + `<circle cx="${x}" cy="${y}" r="${(r * 0.3).toFixed(1)}" fill="${ink}"/></g>`
    default:
      return ''
  }
}

const DEFAULT_FRAMES = 8
const DEFAULT_CELL = 96 // 3× the ~32px bee quad — crisp without LOD; bump for closer zoom

// ── colour helpers ───────────────────────────────────────────────────
// Derive the highlight/shade tones from the palette so a blue bee doesn't
// carry AB's honey-coloured gloss. Pure arithmetic on #rrggbb.

const hex = (value: string): [number, number, number] => {
  const h = value.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = Number.parseInt(full.slice(0, 6) || '000000', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgb = (c: [number, number, number]): string =>
  '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/** Mix `value` toward `target` by `amount` ∈ [0,1]. */
const mix = (value: string, target: string, amount: number): string => {
  const a = hex(value)
  const b = hex(target)
  return rgb([0, 1, 2].map(i => a[i] + (b[i] - a[i]) * amount) as [number, number, number])
}

/** `#rrggbb` → `rgba(r,g,b,alpha)` — wings are translucent. */
const alpha = (value: string, a: number): string => {
  const [r, g, b] = hex(value)
  return `rgba(${r},${g},${b},${a})`
}

// ── livery ───────────────────────────────────────────────────────────
//
// THE NAME IS PAINTED ON THE BEE. Not floated beside it, not captioned under
// it: a caption is a second thing on screen that has to be tracked, aligned and
// read separately from the creature it belongs to, and once two bees are close
// together it stops being obvious which name belongs to which. Livery cannot
// come apart from its bee — it is the same pixels, it turns when the bee turns,
// it fades when the bee fades, and there is nothing to keep in sync.
//
// It rides the abdomen, over the lower stripe, in a light ink haloed dark so it
// holds against both the body colour and the stripe under it. The width is
// FORCED (`textLength`) rather than hoped for: a name is whatever a vendor
// shipped, the belly is 70 units wide, and a long name has to shrink into it
// rather than run off the side of the bee.

/** Where the name sits on the abdomen, and how much room it has. The belly
 *  TAPERS, so the room is measured at the baseline (~62..135 in the 200-unit
 *  drawing) and then kept inside it: livery that reaches the outline gets its
 *  first and last glyph shaved off by the abdomen clip. */
const LIVERY = { x: 99, baseline: 152, width: 64, maxSize: 20, minSize: 9 } as const

/** Rough advance width of a glyph as a fraction of font size. Only used to
 *  CHOOSE a size; the drawn width is then forced, so a wrong guess costs a
 *  slightly loose or tight fit, never an overflow. */
const GLYPH_RATIO = 0.62

const liverySvg = (name: string, ink: string, halo: string): string => {
  // The bake is a data-URL SVG: only characters that cannot need escaping are
  // allowed through, and the token is already reduced to them upstream.
  const text = String(name ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()
  if (!text) return ''
  const { x, baseline, width, maxSize, minSize } = LIVERY
  const size = Math.max(minSize, Math.min(maxSize, width / (GLYPH_RATIO * text.length)))
  const drawn = Math.min(width, text.length * GLYPH_RATIO * size)
  return `<text x="${x}" y="${baseline}" text-anchor="middle" font-family="Verdana,DejaVu Sans,Arial,sans-serif"`
    + ` font-size="${size.toFixed(1)}" font-weight="700" textLength="${drawn.toFixed(1)}" lengthAdjust="spacingAndGlyphs"`
    + ` fill="${ink}" stroke="${halo}" stroke-width="3.4" stroke-linejoin="round" paint-order="stroke" opacity="0.96">${text}</text>`
}

/** sin²(πp): 0 at p=0, 1 at p=0.5, 0 at p=1 — the eased flap sweep. */
const flapSweep = (p: number): number => {
  const s = Math.sin(Math.PI * p)
  return s * s
}

/** The AB bee as an SVG string with wings rotated for flap phase `p` ∈ [0,1).
 *  Left wing sweeps -16°→+12°→-16°; right wing mirrors (+16°→-12°→+16°).
 *  `palette` recolours the same drawing — one bee shape, many kinds of bee. */
const beeSvg = (
  p: number,
  px: number,
  palette: BeePalette = AB_PALETTE,
  emblem: BeeEmblem = 'none',
  name = '',
): string => {
  const sweep = flapSweep(p)
  const lAng = (-16 + 28 * sweep).toFixed(2)
  const rAng = (16 - 28 * sweep).toFixed(2)
  const { body, stripe, head, wing } = palette
  const wingFill = alpha(mix(wing, '#ffffff', 0.25), 0.56)
  const wingEdge = mix(wing, '#7f93ad', 0.45)
  const bodyLight = mix(body, '#ffffff', 0.42)
  const bodyShade = mix(body, '#000000', 0.35)
  const headLight = mix(head, '#ffffff', 0.3)
  const eye = mix(stripe, '#000000', 0.25)
  const blush = mix(body, '#ff6a4b', 0.5)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 200 200">
    <g transform="rotate(${lAng} 78 92)">
      <path d="M78,92 C50,76 22,78 18,95 C16,110 44,108 70,100 C76,98 79,95 78,92 Z" fill="${wingFill}" stroke="${wingEdge}" stroke-width="1.2"/>
      <path d="M74,94 C52,84 34,84 24,90" fill="none" stroke="${wingEdge}" stroke-width="0.8" opacity="0.6"/>
    </g>
    <g transform="rotate(${rAng} 122 92)">
      <path d="M122,92 C150,76 178,78 182,95 C184,110 156,108 130,100 C124,98 121,95 122,92 Z" fill="${wingFill}" stroke="${wingEdge}" stroke-width="1.2"/>
      <path d="M126,94 C148,84 166,84 176,90" fill="none" stroke="${wingEdge}" stroke-width="0.8" opacity="0.6"/>
    </g>
    <clipPath id="ab"><path d="M100,98 C129,98 142,115 142,134 C142,153 126,166 108,164 C90,162 58,153 58,132 C58,114 71,98 100,98 Z"/></clipPath>
    <g clip-path="url(#ab)">
      <rect x="50" y="95" width="100" height="80" fill="${body}"/>
      <path d="M57,118 Q100,128 143,118 L143,131 Q100,141 57,131 Z" fill="${stripe}"/>
      <path d="M60,144 Q100,153 135,143 L134,155 Q100,164 64,155 Z" fill="${stripe}"/>
      <ellipse cx="100" cy="114" rx="40" ry="11" fill="${bodyLight}" opacity="0.4"/>
      <ellipse cx="100" cy="156" rx="28" ry="8" fill="${bodyShade}" opacity="0.28"/>
      ${emblemSvg(emblem, mix(stripe, '#ffffff', 0.82), Boolean(name))}
      ${liverySvg(name, mix(body, '#ffffff', 0.94), mix(stripe, '#000000', 0.25))}
    </g>
    <path d="M108,163 C113,168 117,172 117,172 C113,170 109,168 106,165 Z" fill="${stripe}"/>
    <g stroke="${stripe}" stroke-width="2.6" stroke-linecap="round" fill="none">
      <path d="M90,158 C86,166 86,172 90,177"/><path d="M108,160 C112,168 112,174 108,179"/><path d="M100,162 C99,170 100,176 100,180"/>
    </g>
    <circle cx="100" cy="98" r="20" fill="${head}"/><circle cx="94" cy="93" r="11" fill="${headLight}" opacity="0.5"/>
    <circle cx="100" cy="66" r="36" fill="${head}"/>
    <path d="M86,38 C81,25 80,16 82,8" fill="none" stroke="${stripe}" stroke-width="2.6" stroke-linecap="round"/><circle cx="82" cy="6" r="3.8" fill="${stripe}"/>
    <path d="M114,37 C120,24 126,16 131,11" fill="none" stroke="${stripe}" stroke-width="2.6" stroke-linecap="round"/><circle cx="132" cy="9" r="3.8" fill="${stripe}"/>
    <circle cx="73" cy="80" r="6" fill="${blush}" opacity="0.34"/><circle cx="125" cy="78" r="6" fill="${blush}" opacity="0.34"/>
    <ellipse cx="85" cy="69" rx="8.5" ry="11.5" fill="${eye}"/><circle cx="88" cy="63.5" r="3.1" fill="#fff"/><circle cx="82" cy="74" r="1.4" fill="#fff" opacity="0.72"/>
    <ellipse cx="116" cy="67" rx="11" ry="14" fill="${eye}"/><circle cx="120" cy="60.5" r="4" fill="#fff"/><circle cx="112" cy="73" r="1.8" fill="#fff" opacity="0.72"/>
    <path d="M94,86 q9,7 18,1" fill="none" stroke="${stripe}" stroke-width="1.8" stroke-linecap="round"/>
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
  palette: BeePalette = AB_PALETTE,
  emblem: BeeEmblem = 'none',
  name = '',
): Promise<BeeAtlas | null> => {
  const canvas = document.createElement('canvas')
  canvas.width = cellPx * frames
  canvas.height = cellPx
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  for (let i = 0; i < frames; i++) {
    const img = await svgToImage(beeSvg(i / frames, cellPx, palette, emblem, name), cellPx)
    ctx.drawImage(img, i * cellPx, 0, cellPx, cellPx)
  }

  return { texture: Texture.from(canvas), frames, cellPx }
}

/** One still frame of a bee as an SVG data URL — for DOM chrome (the agent
 *  panel's header chip, a behaviour's avatar swatch) where a Pixi texture is
 *  the wrong currency. Same drawing, same palette, no canvas. */
export const beeImageUrl = (
  palette: BeePalette = AB_PALETTE,
  px = 64,
  emblem: BeeEmblem = 'none',
  name = '',
): string =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(beeSvg(0.5, px, palette, emblem, name))

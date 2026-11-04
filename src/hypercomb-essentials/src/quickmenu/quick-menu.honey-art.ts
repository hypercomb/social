// quickmenu/quick-menu.honey-art.ts
//
// The quick menu's ten crafted backgrounds (quickmenu/backgrounds), turned into
// pictures ONCE, at warm, and never again.
//
// Each background is a standalone SVG of one point-top tile (viewBox
// -40 -46 80 92, circumradius 46). Filters are allowed in them, so drawing one
// is not cheap — which is why it happens here, once per variation, and every
// renderer afterwards only shows a bitmap:
//
//   · the DOM ring  — an <image> per slot, from an object URL of the tile
//   · the Pixi ring — a Sprite, a frame of the atlas texture
//   · the hive flower — the hex shader samples the atlas texture by variation
//
// The atlas is one canvas: a column per variation, the REST picture in the top
// row and a pre-lit copy (about 2.4x brighter) in the bottom row, so lighting a
// tile is a swap of picture, never a filter on the gesture. Each cell carries a
// transparent pad round the tile so a sampler never reads a neighbour.
//
// Nothing here may be relied on: in a page with no canvas, no object URLs or a
// background that will not decode, the variation is simply not ready and its
// slot keeps the procedural honey (quick-menu.honey.ts).

import { EffectBus } from '@hypercomb/core'
import { CanvasSource, Texture } from 'pixi.js'
import { HONEY_BACKGROUND_COUNT } from './quick-menu.honey.js'

/** One crafted background, as each backgrounds/honey-NN-<slug>.ts exports it. */
export interface HoneyBackground {
  readonly id: string
  readonly name: string
  readonly svg: string
}

/** The pictures, once drawn. Also the payload of HONEY_ART_EFFECT. */
export interface HoneyArt {
  /** Columns in the atlas: one per variation. */
  readonly count: number
  /** The tile's own size in the atlas, and the pad round it, in px. */
  readonly width: number
  readonly height: number
  readonly pad: number
  /** Per variation: false when it failed to draw (that slot stays procedural). */
  readonly ready: readonly boolean[]
  /** `count` columns × 2 rows (rest, lit), each cell (width + 2 pad) × (height + 2 pad). */
  readonly atlas: HTMLCanvasElement
  /** Object URLs of each tile at rest and lit, for the DOM ring; null where not ready. */
  readonly rest: readonly (string | null)[]
  readonly lit: readonly (string | null)[]
  /** The atlas as one Pixi texture (mipmapped), shared by the Pixi ring and the shader. */
  readonly texture: Texture | null
}

/** Emitted once the pictures are ready (last-value replay: late listeners get it too). */
export const HONEY_ART_EFFECT = 'quickmenu:honey-art'

/** Every background's frame: a point-top tile of circumradius 46. */
export const HONEY_ART_VIEWBOX = '-40 -46 80 92'
export const HONEY_ART_BOX = { x: -40, y: -46, width: 80, height: 92 } as const

/**
 * The size each tile is drawn at: 3.5x the ring's 80 x 92, which stays crisp
 * for the DOM ring at 3x device pixels and a hive flower tile up to ~160 px
 * across. Same aspect as the viewBox exactly, so nothing is stretched.
 */
export const HONEY_ART_TILE = { width: 280, height: 322, pad: 2 } as const

/** How much brighter the pre-lit copy is: the lit body lifts about 2.5x. */
export const HONEY_ART_LIT_GAIN = 2.4

/** A background may weigh no more than this, in bytes. */
export const HONEY_BACKGROUND_MAX_BYTES = 80 * 1024

// ── the contract, checked ─────────────────────────────────────────────

const FORBIDDEN: readonly [RegExp, string][] = [
  [/<text\b/i, 'a <text> element'],
  [/<script\b/i, 'a <script> element'],
  [/<image\b/i, 'an <image> element'],
  [/<foreignObject\b/i, 'a <foreignObject> element'],
  [/<font\b/i, 'a <font> element'],
  [/@font-face/i, 'an @font-face rule'],
  [/@import/i, 'an @import rule'],
  [/\son[a-z]+\s*=/i, 'an event handler attribute'],
  [/\b(?:xlink:)?href\s*=\s*["'](?!#)/i, 'an href to something outside itself'],
  [/url\(\s*["']?(?!#)/i, 'a url() to something outside itself'],
]

/** What is wrong with a background, in words; empty when it keeps the contract.
 *  `number` is its place, 1..10, which its id must carry. */
export function honeyBackgroundProblems(background: HoneyBackground, number: number): string[] {
  const problems: string[] = []
  const nn = String(number).padStart(2, '0')
  const { id, name, svg } = background
  if (id !== `honey-${nn}`) problems.push(`id is "${id}", expected "honey-${nn}"`)
  if (!name || !name.trim()) problems.push('it has no name')
  const text = svg.trim()
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) problems.push('it is not one standalone <svg> element')
  const root = /^<svg\b[^>]*>/.exec(text)?.[0] ?? ''
  if (!root.includes('xmlns="http://www.w3.org/2000/svg"')) problems.push('the root has no SVG xmlns')
  if (!root.includes(`viewBox="${HONEY_ART_VIEWBOX}"`)) problems.push(`the root viewBox is not "${HONEY_ART_VIEWBOX}"`)
  if (!/\swidth="80"/.test(root) || !/\sheight="92"/.test(root)) problems.push('the root is not width="80" height="92"')
  for (const [pattern, what] of FORBIDDEN) if (pattern.test(svg)) problems.push(`it holds ${what}`)
  const ids = [...svg.matchAll(/\sid\s*=\s*"([^"]*)"/g)].map(m => m[1])
  for (const own of ids) if (!own.startsWith(`${id}-`)) problems.push(`id "${own}" is not prefixed "${id}-"`)
  if (new Set(ids).size !== ids.length) problems.push('an id is used twice')
  const known = new Set(ids)
  const refs = [
    ...[...svg.matchAll(/url\(\s*["']?#([^)"']+)["']?\s*\)/g)].map(m => m[1]),
    ...[...svg.matchAll(/\b(?:xlink:)?href\s*=\s*"#([^"]+)"/g)].map(m => m[1]),
  ]
  for (const ref of refs) if (!known.has(ref)) problems.push(`it refers to #${ref}, which it does not define`)
  const bytes = new TextEncoder().encode(svg).length
  if (bytes > HONEY_BACKGROUND_MAX_BYTES) problems.push(`it weighs ${bytes} bytes, over ${HONEY_BACKGROUND_MAX_BYTES}`)
  return problems
}

/** The same SVG asking to be drawn at `width` x `height` px: the root's own
 *  width and height are replaced, the viewBox (and so the art) is untouched. */
export function sizedSvg(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/, tag =>
    tag
      .replace(/\swidth\s*=\s*"[^"]*"/, '')
      .replace(/\sheight\s*=\s*"[^"]*"/, '')
      .replace(/^<svg\b/, `<svg width="${width}" height="${height}"`),
  )
}

/** Where variation `index` sits in an atlas of `HONEY_ART_TILE` cells, at rest or lit. */
export function atlasFrame(index: number, lit: boolean): { x: number; y: number; width: number; height: number } {
  const { width, height, pad } = HONEY_ART_TILE
  return { x: index * (width + 2 * pad) + pad, y: (lit ? height + 2 * pad : 0) + pad, width, height }
}

// ── drawing, once ─────────────────────────────────────────────────────

type Slot = { promise: Promise<HoneyArt | null> | null; value: HoneyArt | null }

/** One drawing per page, however many bundles carry this module. */
const shared = (): Slot =>
  ((globalThis as { __hypercombHoneyArt?: Slot }).__hypercombHoneyArt ??= { promise: null, value: null })

/** The pictures if they are ready, else null. Never starts anything. */
export function honeyArtNow(): HoneyArt | null {
  return shared().value
}

/**
 * Draw every background once, idempotently, and say so on HONEY_ART_EFFECT.
 * Resolves null when nothing could be drawn (no canvas, no object URLs): every
 * slot then keeps the procedural honey. Never call it on a gesture.
 */
export function warmHoneyArt(backgrounds: readonly HoneyBackground[]): Promise<HoneyArt | null> {
  const slot = shared()
  slot.promise ??= draw(backgrounds).then(
    art => {
      slot.value = art
      if (art) EffectBus.emit(HONEY_ART_EFFECT, art)
      return art
    },
    () => null,
  )
  return slot.promise
}

const breathe = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

async function draw(backgrounds: readonly HoneyBackground[]): Promise<HoneyArt | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') return null
  const count = Math.max(HONEY_BACKGROUND_COUNT, backgrounds.length)
  const { width, height, pad } = HONEY_ART_TILE
  const atlas = document.createElement('canvas')
  atlas.width = count * (width + 2 * pad)
  atlas.height = 2 * (height + 2 * pad)
  const context = atlas.getContext('2d')
  if (!context || typeof context.drawImage !== 'function') return null

  const ready: boolean[] = new Array(count).fill(false)
  const rest: (string | null)[] = new Array(count).fill(null)
  const lit: (string | null)[] = new Array(count).fill(null)

  for (let i = 0; i < backgrounds.length; i++) {
    // one variation per task: ten filtered SVGs never land in one long frame
    await breathe()
    const source = URL.createObjectURL(new Blob([sizedSvg(backgrounds[i].svg, width, height)], { type: 'image/svg+xml' }))
    try {
      const image = await decode(source)
      const tile = document.createElement('canvas')
      tile.width = width
      tile.height = height
      const t = tile.getContext('2d')
      if (!t) continue
      t.drawImage(image, 0, 0, width, height)
      const restUrl = await objectUrl(tile)
      // lit: the same picture added onto itself, 1 + 1 + 0.4 = 2.4x, clamped —
      // no pixel read, so nothing here can trip over a tainted canvas
      t.globalCompositeOperation = 'lighter'
      t.drawImage(image, 0, 0, width, height)
      t.globalAlpha = HONEY_ART_LIT_GAIN - 2
      t.drawImage(image, 0, 0, width, height)
      const litUrl = await objectUrl(tile)
      const r = atlasFrame(i, false), l = atlasFrame(i, true)
      context.drawImage(image, r.x, r.y, width, height)
      context.drawImage(tile, l.x, l.y, width, height)
      rest[i] = restUrl
      lit[i] = litUrl
      ready[i] = true
    } catch {
      ready[i] = false
    } finally {
      URL.revokeObjectURL(source)
    }
  }
  if (!ready.some(Boolean)) return null

  let texture: Texture | null = null
  try {
    texture = new Texture({ source: new CanvasSource({ resource: atlas, autoGenerateMipmaps: true, scaleMode: 'linear' }) })
  } catch {
    texture = null
  }
  return { count, width, height, pad, ready, atlas, rest, lit, texture }
}

/** An SVG at `url` as a loaded image, its size taken from its root. The caller
 *  revokes the URL once it has drawn it. */
function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('honey background did not decode'))
    image.src = url
  })
}

function objectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('no blob'))), 'image/png')
  })
}

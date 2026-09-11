// THE ONE WAY INTO A PLACE. Jaime, 2026-09-11: "Everything can be zoomed
// into … Going in never cuts to a different screen. The view zooms toward
// that thing, and as it fills the frame it resolves into the bigger world it
// contains … Coming out is the same motion reversed: the world you are in
// shrinks back into the object it was, and you are standing beside it in the
// place you left, the view pulling back to where it was. Nothing changes
// except scale." And earlier: "some sort of visualization as things pixelate
// into view for the next screen … a second or so."
//
// So every warp — island to cavern, island to shrine, room to room, cavern
// back to the island — is the same one-second veil with two legs. The LEAVE
// leg pixelates the place you are in and scales it around the entrance you
// took: it grows going in, shrinks back into the entrance coming out. At the
// swap the shell shows the next place, and the ARRIVE leg resolves it from
// coarse blocks while it settles from around the entrance you arrived by. A
// place is described to the veil by a PICTURE: one colour per cell, from a
// grid or from its own canvases. Under reduced motion, or without a canvas,
// the swap simply happens.

import { canvasContext } from './island-paint.js'

export const VEIL_MS = 1000
/** The moment (0..1 of the veil) the old place gives way to the new one. */
export const VEIL_SWAP = 0.4
const VEIL_BLOCKS = [6, 4, 3, 2, 1] as const
/** The veil's dim between the places, so the swap reads as going THROUGH something. */
const VEIL_DIM = 0.28

export type VeilRgb = readonly [number, number, number]
export type VeilDirection = 'in' | 'out' | 'across'
/** How far each leg scales: leaving grows into the entrance going in and
 *  shrinks back into it coming out; arriving settles from these to 1. */
export const VEIL_ZOOM: Readonly<Record<VeilDirection, { readonly leave: number; readonly arrive: number }>> = {
  in: { leave: 2.6, arrive: 1.18 },
  out: { leave: 0.42, arrive: 2.2 },
  across: { leave: 1.8, arrive: 1.12 },
}

/** The block size (in cells) at a point of the veil: the old place breaks up
 *  from its cells into ever coarser blocks, then the new one resolves from
 *  coarse blocks down to its cells. */
export const veilBlock = (t: number): number => {
  const last = VEIL_BLOCKS.length - 1
  if (t < VEIL_SWAP) return VEIL_BLOCKS[last - Math.min(last, Math.floor(t / VEIL_SWAP * VEIL_BLOCKS.length))]!
  const u = Math.min(1, (t - VEIL_SWAP) / (0.82 - VEIL_SWAP))
  return VEIL_BLOCKS[Math.min(last, Math.floor(u * VEIL_BLOCKS.length))]!
}
/** The veil's opacity: solid while the places trade, lifting at the end. */
export const veilAlpha = (t: number): number => (t < 0.82 ? 1 : Math.max(0, 1 - (t - 0.82) / 0.18))
/** The scale of whichever place is on screen at a point of the veil. Leaving
 *  accelerates toward (or into) the entrance; arriving eases out to rest. */
export const veilScale = (t: number, leave: number, arrive: number): number => {
  if (t < VEIL_SWAP) {
    const u = t / VEIL_SWAP
    return 1 + (leave - 1) * u * u
  }
  const u = Math.min(1, (t - VEIL_SWAP) / (1 - VEIL_SWAP)), eased = 1 - (1 - u) ** 3
  return arrive + (1 - arrive) * eased
}

/** A place as the veil sees it: so many cells across and down, painted at
 *  `block` cells per pixel into a canvas of ceil(cols / block) by
 *  ceil(rows / block) pixels. */
export interface VeilPicture {
  readonly cols: number
  readonly rows: number
  paint(ctx: CanvasRenderingContext2D, block: number): void
}

const hashWord = (word: string): number => {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h
}

/** A picture from one colour per cell. A block takes the colour MOST of its
 *  cells wear, never their average, which would turn stone, air and brick
 *  into one grey mud; ties go to the brighter colour, so walls and doors win
 *  over air. A little grain, fixed by position, keeps it pixels, not a blur. */
export function veilGridPicture(cols: number, rows: number, colorAt: (col: number, row: number) => VeilRgb): VeilPicture {
  return {
    cols, rows,
    paint(ctx, block) {
      for (let by = 0, py = 0; by < rows; by += block, py++) {
        for (let bx = 0, px = 0; bx < cols; bx += block, px++) {
          const votes = new Map<string, { color: VeilRgb; n: number }>()
          for (let row = by; row < Math.min(rows, by + block); row++) for (let col = bx; col < Math.min(cols, bx + block); col++) {
            const color = colorAt(col, row), key = color.join(',')
            const vote = votes.get(key)
            if (vote) vote.n++
            else votes.set(key, { color, n: 1 })
          }
          let best: { color: VeilRgb; n: number } | null = null
          for (const vote of votes.values()) {
            if (!best || vote.n > best.n || (vote.n === best.n && vote.color[0] + vote.color[1] + vote.color[2] > best.color[0] + best.color[1] + best.color[2])) best = vote
          }
          if (!best) continue
          const k = 0.92 + ((hashWord(`${bx},${by},${block}`) % 17) / 17) * 0.16
          ctx.fillStyle = `rgb(${Math.round(best.color[0] * k)}, ${Math.round(best.color[1] * k)}, ${Math.round(best.color[2] * k)})`
          ctx.fillRect(px, py, 1, 1)
        }
      }
    },
  }
}

/** A picture from a place's own canvases, drawn in order, shrunk to blocks. */
export function veilCanvasPicture(canvases: readonly HTMLCanvasElement[], cols: number, rows: number): VeilPicture {
  return {
    cols, rows,
    paint(ctx, block) {
      const width = Math.ceil(cols / block), height = Math.ceil(rows / block)
      ctx.imageSmoothingEnabled = true
      for (const canvas of canvases) if (canvas.width && canvas.height) ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height)
    },
  }
}

/** One leg of a warp: the element that scales, its picture, the point it
 *  scales around (fractions of its box) and how far it scales. */
export interface VeilLeg {
  readonly element: HTMLElement
  readonly picture: VeilPicture | null
  readonly origin: readonly [number, number]
  readonly scale: number
}
export interface VeilPlay {
  readonly leave: VeilLeg
  readonly arrive: VeilLeg
  /** Show the next place. Called exactly once, at the swap — or at once when there is no veil. */
  readonly onSwap: () => void
  readonly onDone?: () => void
}

export class PlaceVeil {
  readonly #host: HTMLElement
  readonly #canvas = document.createElement('canvas')
  readonly #ctx: CanvasRenderingContext2D | null
  readonly #sample = document.createElement('canvas')
  readonly #sampleContext: CanvasRenderingContext2D | null
  #play: VeilPlay | null = null
  #raf = 0
  #start = 0
  #swapped = false

  constructor(host: HTMLElement) {
    this.#host = host
    this.#canvas.className = 'sol-veil'
    this.#canvas.setAttribute('aria-hidden', 'true')
    this.#canvas.hidden = true
    host.append(this.#canvas)
    this.#ctx = canvasContext(this.#canvas)
    this.#sampleContext = canvasContext(this.#sample)
  }

  get playing(): boolean { return this.#play !== null }

  play(play: VeilPlay): void {
    this.cancel()
    const still = !this.#ctx || !this.#sampleContext || typeof requestAnimationFrame !== 'function'
      || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (still) { play.onSwap(); play.onDone?.(); return }
    this.#play = play
    this.#swapped = false
    this.#start = 0
    this.#canvas.hidden = false
    // The first frame is drawn now, before the page can show anything else:
    // the place you are leaving, whole and at rest.
    this.#frame(0)
    this.#raf = requestAnimationFrame(this.#step)
  }

  /** Ends a warp at once: the swap happens if it has not yet, and nothing stays scaled. */
  cancel(): void {
    if (!this.#play) return
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    if (!this.#swapped) { this.#swapped = true; this.#play.onSwap() }
    this.#finish()
  }

  dispose(): void {
    this.cancel()
    this.#canvas.remove()
  }

  #step = (now: number): void => {
    if (!this.#play) return
    if (!this.#start) this.#start = now
    const t = Math.min(1, (now - this.#start) / VEIL_MS)
    this.#frame(t)
    if (t < 1) { this.#raf = requestAnimationFrame(this.#step); return }
    this.#raf = 0
    this.#finish()
  }

  #finish(): void {
    const play = this.#play
    this.#play = null
    this.#canvas.hidden = true
    if (play) {
      for (const leg of [play.leave, play.arrive]) { leg.element.style.transform = ''; leg.element.style.transformOrigin = '' }
      play.onDone?.()
    }
  }

  #frame(t: number): void {
    const play = this.#play
    if (!play) return
    if (t >= VEIL_SWAP && !this.#swapped) {
      this.#swapped = true
      play.leave.element.style.transform = ''
      play.onSwap()
    }
    const leg = t < VEIL_SWAP ? play.leave : play.arrive
    const scale = veilScale(t, play.leave.scale, play.arrive.scale)
    leg.element.style.transformOrigin = `${(leg.origin[0] * 100).toFixed(2)}% ${(leg.origin[1] * 100).toFixed(2)}%`
    leg.element.style.transform = Math.abs(scale - 1) < 0.001 ? '' : `scale(${scale.toFixed(4)})`
    this.#draw(t, leg)
  }

  #draw(t: number, leg: VeilLeg): void {
    const ctx = this.#ctx, sample = this.#sampleContext
    if (!ctx || !sample) return
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const hostBox = this.#host.getBoundingClientRect()
    const width = Math.max(1, Math.round(hostBox.width)), height = Math.max(1, Math.round(hostBox.height))
    if (this.#canvas.width !== Math.round(width * dpr) || this.#canvas.height !== Math.round(height * dpr)) {
      this.#canvas.width = Math.round(width * dpr)
      this.#canvas.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const picture = leg.picture
    if (!picture || !picture.cols || !picture.rows) return
    const box = leg.element.getBoundingClientRect()
    const rect = { x: box.left - hostBox.left, y: box.top - hostBox.top, width: box.width, height: box.height }
    if (!rect.width || !rect.height) return
    const block = veilBlock(t)
    const columns = Math.ceil(picture.cols / block), lines = Math.ceil(picture.rows / block)
    this.#sample.width = columns
    this.#sample.height = lines
    sample.clearRect(0, 0, columns, lines)
    picture.paint(sample, block)
    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.width, rect.height)
    ctx.clip()
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = veilAlpha(t)
    ctx.drawImage(this.#sample, 0, 0, columns, lines, rect.x, rect.y, columns * block * rect.width / picture.cols, lines * block * rect.height / picture.rows)
    // Between the two places the blocks dim a little toward the dark of the
    // passage, but they keep their own colours: never grey.
    const dim = t < VEIL_SWAP ? t / VEIL_SWAP * VEIL_DIM : VEIL_DIM * (1 - Math.min(1, (t - VEIL_SWAP) / (0.82 - VEIL_SWAP)))
    if (dim > 0) {
      ctx.globalAlpha = veilAlpha(t) * dim
      ctx.fillStyle = '#060a14'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
    ctx.restore()
  }
}

export const PLACE_VEIL_CSS = `
.sol-veil{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:40;image-rendering:pixelated}
`

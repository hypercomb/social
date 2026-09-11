import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureBothOrientations, captureGeometry, captureHexSmall, parseHexColour } from './hex-capture.js'

describe('hex-capture — colour', () => {
  it('parses black as black, short hex as long hex, and refuses anything else', () => {
    expect(parseHexColour('#000000')).toBe('#000000')
    expect(parseHexColour('000000')).toBe('#000000')
    expect(parseHexColour('#ABC')).toBe('#aabbcc')
    expect(parseHexColour(' #C8975A ')).toBe('#c8975a')
    expect(parseHexColour('#12')).toBeNull()
    expect(parseHexColour('red')).toBeNull()
    expect(parseHexColour(undefined)).toBeNull()
  })
})

describe('hex-capture — geometry', () => {
  it('writes into a whole-pixel box per orientation', () => {
    expect(captureGeometry({ width: 800, height: 600 }, { orientation: 'point-top' }).box).toEqual({ width: 346, height: 400 })
    expect(captureGeometry({ width: 800, height: 600 }, { orientation: 'flat-top' }).box).toEqual({ width: 400, height: 346 })
  })

  it('defaults to a centred picture that covers the box on every side', () => {
    const { box, rect } = captureGeometry({ width: 800, height: 600 }, { orientation: 'flat-top' })
    expect(rect.x).toBeLessThanOrEqual(0)
    expect(rect.y).toBeLessThanOrEqual(0)
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(box.width)
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(box.height)
    expect(rect.x + rect.width / 2).toBeCloseTo(box.width / 2)
  })
})

// A canvas that records every call its 2d context receives, so the test can
// say exactly what a capture DRAWS — and, the point of the file, what it
// never draws.
type Call = { name: string; args: unknown[] }
let calls: Call[] = []
const originalOffscreen = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
const originalBitmap = (globalThis as { ImageBitmap?: unknown }).ImageBitmap

class RecordingCanvas {
  width: number
  height: number
  constructor(width: number, height: number) { this.width = width; this.height = height }
  getContext(): unknown {
    return new Proxy({}, {
      get: (_target, name: string) => (...args: unknown[]) => { calls.push({ name, args }) },
      set: (_target, name: string, value: unknown) => { calls.push({ name: `set:${name}`, args: [value] }); return true },
    })
  }
  async convertToBlob(options: { type: string; quality: number }): Promise<Blob> {
    calls.push({ name: 'convertToBlob', args: [options, this.width, this.height] })
    return new Blob([`${this.width}x${this.height}`], { type: options.type })
  }
}

class FakeBitmap {
  width: number
  height: number
  closed = false
  constructor(width: number, height: number) { this.width = width; this.height = height }
  close(): void { this.closed = true }
}

const DRAWS_A_MARK = ['stroke', 'strokeRect', 'strokeText', 'fillText', 'arc', 'lineTo', 'moveTo', 'rect', 'fill', 'ellipse', 'roundRect', 'createRadialGradient', 'createLinearGradient']

describe('hex-capture — what a capture draws', () => {
  beforeEach(() => {
    calls = []
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = RecordingCanvas
    ;(globalThis as { ImageBitmap?: unknown }).ImageBitmap = FakeBitmap
  })
  afterEach(() => {
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreen
    ;(globalThis as { ImageBitmap?: unknown }).ImageBitmap = originalBitmap
  })

  it('draws the picture and nothing else — no rim, no fill, no name', async () => {
    const bitmap = new FakeBitmap(640, 480) as unknown as ImageBitmap
    const blob = await captureHexSmall(bitmap, { orientation: 'point-top' })
    expect(blob.type).toBe('image/webp')
    const names = calls.map(c => c.name)
    expect(names.filter(n => n === 'drawImage')).toHaveLength(1)
    expect(names).not.toContain('fillRect')
    for (const mark of DRAWS_A_MARK) expect(names).not.toContain(mark)
    expect(names).not.toContain('set:strokeStyle')
    expect(names).not.toContain('set:lineWidth')
  })

  it('paints a fill only when the participant chose a valid colour for it', async () => {
    const bitmap = new FakeBitmap(640, 480) as unknown as ImageBitmap
    await captureHexSmall(bitmap, { orientation: 'flat-top', fill: '#000000' })
    expect(calls.filter(c => c.name === 'fillRect')).toHaveLength(1)
    expect(calls.find(c => c.name === 'set:fillStyle')?.args[0]).toBe('#000000')

    calls = []
    await captureHexSmall(bitmap, { orientation: 'flat-top', fill: 'not-a-colour' })
    expect(calls.map(c => c.name)).not.toContain('fillRect')
  })

  it('steps a large picture down by halves before the final draw', async () => {
    const bitmap = new FakeBitmap(4000, 3000) as unknown as ImageBitmap
    await captureHexSmall(bitmap, { orientation: 'point-top' })
    // 4000 → 2000 → 1000 → 500 (the drawn width at cover is ~533), then the final draw.
    expect(calls.filter(c => c.name === 'drawImage').length).toBeGreaterThan(1)
  })

  it('does not close a bitmap it was handed, and captures both orientations from one decode', async () => {
    const bitmap = new FakeBitmap(640, 480)
    const both = await captureBothOrientations(bitmap as unknown as ImageBitmap)
    expect(bitmap.closed).toBe(false)
    expect(both.point.type).toBe('image/webp')
    // jsdom's Blob has no .text(); the recorded canvases carry the boxes.
    const boxes = calls.filter(c => c.name === 'convertToBlob').map(c => [c.args[1], c.args[2]])
    expect(boxes).toEqual([[346, 400], [400, 346]])
  })
})

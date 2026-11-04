// move-orientation.spec.ts — a move works in BOTH hex orientations.
//
// A press is read back to a hex with the inverse of the layout the grid was
// drawn with. The move inputs used to call the detector without the flat flag,
// so on a flat-top grid every press resolved through the point-top inverse: a
// tile could only be picked up or dropped where the two layouts happened to
// agree. Each case lays hexes out with the preview's own axial→pixel formula
// and checks the pointer lands back on the hex it was put on.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HexDetector } from '../navigation/hex-detector.js'

const SPACING = 38
const OFFSET = { x: 400, y: 400 }

const services: Record<string, unknown> = {}
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => {},
  get: (key: string) => services[key],
  has: (key: string) => key in services,
  whenReady: () => {},
}
services['@diamondcoreprocessor.com/HexDetector'] = new HexDetector(SPACING)
services['@diamondcoreprocessor.com/InputGate'] = {
  owner: 'touch-move',
  claim: () => true,
  release: () => {},
}

// the same layout move-preview.drone draws with
function axialToPixel(q: number, r: number, flat: boolean): { x: number; y: number } {
  return flat
    ? { x: 1.5 * SPACING * q, y: Math.sqrt(3) * SPACING * (r + q / 2) }
    : { x: Math.sqrt(3) * SPACING * (q + r / 2), y: SPACING * 1.5 * r }
}

function clientOf(q: number, r: number, flat: boolean): { x: number; y: number } {
  const p = axialToPixel(q, r, flat)
  return { x: OFFSET.x + p.x, y: OFFSET.y + p.y }
}

const canvas = document.createElement('canvas')
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800 }) as DOMRect
document.body.append(canvas)

let flat = false
const drone = {
  beginMove: vi.fn(() => true),
  updateMove: vi.fn(),
  commitMoveAt: vi.fn(),
  cancelMove: vi.fn(),
  setDropIntoActive: vi.fn(),
  labelAtAxial: vi.fn((a: { q: number; r: number }) => `${a.q},${a.r}`),
}
const refs = {
  canvas,
  container: { toLocal: (p: { x: number; y: number }) => p },
  renderer: { screen: { width: 800, height: 800 } },
  getMeshOffset: () => OFFSET,
  getFlat: () => flat,
}

const { DesktopMoveInput } = await import('./desktop-move.input.js')
const { TouchMoveInput } = await import('./touch-move.input.js')
new DesktopMoveInput().attach(drone as never, refs)
new TouchMoveInput().attach(drone as never, refs)

// pick a hex up where `from` is drawn, carry it to `to`, let go
const FROM = { q: 1, r: -2 }
const TO = { q: -2, r: 1 }

function desktopDrag(from: { q: number; r: number }, to: { q: number; r: number }): void {
  const a = clientOf(from.q, from.r, flat)
  const b = clientOf(to.q, to.r, flat)
  // `buttons: 1` — a real drag reports the primary button held on every move;
  // the move input reads a move without it as a release it never heard.
  const base = { button: 0, buttons: 1, pointerType: 'mouse', bubbles: true }
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: a.x, clientY: a.y }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: b.x, clientY: b.y }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: b.x, clientY: b.y }))
}

let nextId = 100
function touchDrag(from: { q: number; r: number }, to: { q: number; r: number }): void {
  const a = clientOf(from.q, from.r, flat)
  const b = clientOf(to.q, to.r, flat)
  const base = { pointerId: nextId++, pointerType: 'touch', isPrimary: true, bubbles: true }
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: a.x, clientY: a.y }))
  vi.advanceTimersByTime(350)
  canvas.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: b.x, clientY: b.y }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: b.x, clientY: b.y }))
}

describe.each([
  ['point-top', false],
  ['flat-top', true],
] as const)('move on a %s grid', (_name, isFlat) => {
  beforeEach(() => {
    vi.useFakeTimers()
    flat = isFlat
    for (const fn of Object.values(drone)) (fn as ReturnType<typeof vi.fn>).mockClear()
  })

  it('the cells are ones the point-top inverse would misread on a flat-top grid', () => {
    if (!isFlat) return
    const naive = new HexDetector(SPACING)
    for (const c of [FROM, TO]) {
      const p = axialToPixel(c.q, c.r, true)
      expect(naive.pixelToAxial(p.x, p.y, false)).not.toEqual(c)
    }
  })

  it('a mouse drag picks up, carries and drops on the hexes it was drawn on', () => {
    desktopDrag(FROM, TO)
    expect(drone.beginMove).toHaveBeenCalledWith(FROM, 'desktop-move')
    expect(drone.updateMove).toHaveBeenLastCalledWith(TO, 'desktop-move')
    expect(drone.commitMoveAt).toHaveBeenCalledWith(TO, 'desktop-move')
  })

  it('a touch hold-and-drag picks up, carries and drops on the hexes it was drawn on', () => {
    touchDrag(FROM, TO)
    expect(drone.beginMove).toHaveBeenCalledWith(FROM, 'touch-move')
    expect(drone.updateMove).toHaveBeenLastCalledWith(TO, 'touch-move')
    expect(drone.commitMoveAt).toHaveBeenCalledWith(TO, 'touch-move')
  })
})

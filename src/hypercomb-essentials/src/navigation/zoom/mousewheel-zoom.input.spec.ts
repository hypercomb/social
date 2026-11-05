// navigation/zoom/mousewheel-zoom.input.spec.ts — THE WHEEL, IN THE LANES.
//
// With the lane lock up the wheel is not a zoom: it moves the WINDOW along the
// strip. This pins the hop from a real wheel event to RailProjectionDrone —
// the one the rail specs cannot see, because they call `wheelBy` directly. A
// wheel that never reaches the rail reads as "the wheel does nothing in the
// lanes", whatever the stepping maths says.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLaneViewport } from '../../sequence/lane-viewport-mode.js'
import { MousewheelZoomInput } from './mousewheel-zoom.input.js'

const RAIL_KEY = '@diamondcoreprocessor.com/RailProjectionDrone'
const PAN_KEY = '@diamondcoreprocessor.com/PanningDrone'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { services.set(key, value) },
  whenReady: () => void 0,
}

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

let input: MousewheelZoomInput
let zoom: { zoomByFactor: ReturnType<typeof vi.fn>; zoomToScale: ReturnType<typeof vi.fn>; currentScale: ReturnType<typeof vi.fn> }
let rail: { active: boolean; wheelBy: ReturnType<typeof vi.fn> }
let pan: { panBy: ReturnType<typeof vi.fn> }

/** A wheel event over the middle of the canvas, as the browser would deliver it. */
const wheel = (init: WheelEventInit = {}): WheelEvent => {
  const event = new WheelEvent('wheel', {
    deltaY: 100, clientX: 500, clientY: 300, bubbles: true, cancelable: true, composed: true, ...init,
  })
  document.body.dispatchEvent(event)
  return event
}

beforeEach(() => {
  services.clear()
  setViewport(1000, 700)
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0, toJSON: () => ({}),
  })
  zoom = { zoomByFactor: vi.fn(), zoomToScale: vi.fn(), currentScale: vi.fn(() => 1) }
  rail = { active: true, wheelBy: vi.fn() }
  pan = { panBy: vi.fn() }
  services.set(RAIL_KEY, rail)
  services.set(PAN_KEY, pan)
  input = new MousewheelZoomInput()
  input.attach(zoom, canvas)
})

afterEach(() => {
  input.detach()
  setLaneViewport(false)
})

describe('the wheel in the lanes', () => {
  it('hands the wheel to the rail window — its travel and its unit — and keeps it from zooming or scrolling the page', () => {
    setLaneViewport(true)
    const event = wheel({ deltaY: 100, deltaMode: 0 })
    expect(rail.wheelBy).toHaveBeenCalledTimes(1)
    expect(rail.wheelBy).toHaveBeenCalledWith(100, 0)
    expect(event.defaultPrevented).toBe(true)
    expect(zoom.zoomToScale).not.toHaveBeenCalled()
    expect(zoom.zoomByFactor).not.toHaveBeenCalled()
    expect(pan.panBy).not.toHaveBeenCalled()
  })

  it('reaches the rail from a strip held either way, and from either axis of the wheel', () => {
    setLaneViewport(true)
    for (const [width, height] of [[1000, 700], [700, 1000]] as const) {
      setViewport(width, height)
      rail.wheelBy.mockClear()
      wheel({ deltaY: -100 })
      wheel({ deltaX: 120, deltaY: 0 })
      wheel({ deltaY: 3, deltaMode: 1 })
      expect(rail.wheelBy.mock.calls, `${width}x${height}`).toEqual([[-100, 0], [120, 0], [3, 1]])
    }
  })

  it('a window not up falls to the pan along the strip, never to a free zoom', () => {
    setLaneViewport(true)
    rail.active = false
    setViewport(1000, 700)
    const event = wheel({ deltaY: 100 })
    expect(rail.wheelBy).not.toHaveBeenCalled()
    expect(pan.panBy).toHaveBeenCalledWith({ x: -100, y: 0 })
    expect(zoom.zoomToScale).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('every notch of a spin reaches the rail, not just the first of a gesture', () => {
    setLaneViewport(true)
    for (let i = 0; i < 6; i++) wheel({ deltaY: 100 })
    expect(rail.wheelBy).toHaveBeenCalledTimes(6)
  })

  it('outside the lanes the same wheel zooms, and the rail is never asked', () => {
    setLaneViewport(false)
    wheel({ deltaY: -100 })
    expect(rail.wheelBy).not.toHaveBeenCalled()
    expect(zoom.zoomToScale).toHaveBeenCalledTimes(1)
  })

  it('a wheel over a UI panel that scrolls is the panel’s, even with the lanes up', () => {
    setLaneViewport(true)
    const panel = document.createElement('div')
    panel.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(panel)
    try {
      panel.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 100, clientX: 500, clientY: 300, bubbles: true, cancelable: true, composed: true,
      }))
      expect(rail.wheelBy).not.toHaveBeenCalled()
    } finally {
      panel.remove()
    }
  })
})

// THE LINE ON DEMAND CENTRES ON THE WHOLE WINDOW.
//
// With `/command-line-on-demand` on, the header bar keeps its box but paints
// no strip, so a hive centred under the bar sat visibly low. The fit reserves
// the header's height half above and half below instead: the scale the normal
// mode fits, the centre raised by half the header. Flipping the mode either
// way refits a page resting on its fit (Jaime, 2026-09-10).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, any>()
const HEADER_BOTTOM = 40

beforeAll(() => {
  Object.defineProperty(window, 'ioc', {
    configurable: true,
    value: {
      get: (key: string) => registry.get(key),
      register: (key: string, value: unknown) => registry.set(key, value),
      whenReady: () => {},
    },
  })
})

/** Enough of a Pixi surface for zoomToFit to reach its own return. */
const stubViewport = (zoom: any): void => {
  const point = () => {
    const p: any = { x: 0, y: 0, set: (x: number, y: number) => { p.x = x; p.y = y } }
    return p
  }
  const scale = () => {
    const s: any = { x: 1, y: 1, set: (v: number) => { s.x = v; s.y = v } }
    return s
  }
  zoom.app = { stage: { position: point(), scale: scale() } }
  zoom.renderer = { screen: { width: 1000, height: 800 } }
  zoom.canvas = null
  zoom.renderContainer = {
    children: [],
    scale: scale(),
    position: point(),
    getLocalBounds: () => ({ x: -50, y: -50, width: 100, height: 100 }),
  }
}

/** A page's saved viewport, as far as the refit rule reads it. */
const stubPersistence = (pan: { dx: number; dy: number }) => ({
  lastZoom: { fit: true },
  lastPan: pan,
  setPan: () => {},
  setZoom: () => {},
})

describe('zoom-to-fit with the command line on demand', () => {
  let zoom: any
  let header: HTMLElement
  const realFrame = globalThis.requestAnimationFrame

  beforeEach(async () => {
    await import('./zoom.drone.js')
    zoom = registry.get('@diamondcoreprocessor.com/ZoomDrone')
    await zoom.heartbeat()
    stubViewport(zoom)
    header = document.createElement('div')
    header.className = 'header-bar'
    header.getBoundingClientRect = () => ({ bottom: HEADER_BOTTOM }) as DOMRect
    document.body.appendChild(header)
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  })

  afterEach(() => {
    header.remove()
    zoom.vp = null
    globalThis.requestAnimationFrame = realFrame
  })

  it('raises the centre by half the header and keeps the scale', () => {
    zoom.zoomToFit(true)
    const normal = { scale: zoom.renderContainer.scale.x, y: zoom.renderContainer.position.y }

    header.classList.add('line-on-demand')
    zoom.zoomToFit(true)

    expect(zoom.renderContainer.scale.x).toBe(normal.scale)
    expect(normal.y - zoom.renderContainer.position.y).toBeCloseTo(HEADER_BOTTOM / 2)
  })

  it('refits a page resting on its fit when the mode flips, either way', () => {
    zoom.vp = stubPersistence({ dx: 0, dy: 0 })
    zoom.zoomToFit(true)
    const normalY = zoom.renderContainer.position.y

    header.classList.add('line-on-demand')
    EffectBus.emit('command-line:on-demand', { on: true })
    expect(normalY - zoom.renderContainer.position.y).toBeCloseTo(HEADER_BOTTOM / 2)

    header.classList.remove('line-on-demand')
    EffectBus.emit('command-line:on-demand', { on: false })
    expect(zoom.renderContainer.position.y).toBeCloseTo(normalY)
  })

  it('leaves a page the participant panned away from where it is', () => {
    zoom.vp = stubPersistence({ dx: 12, dy: 0 })
    zoom.zoomToFit(true)
    const before = zoom.renderContainer.position.y

    header.classList.add('line-on-demand')
    EffectBus.emit('command-line:on-demand', { on: true })

    expect(zoom.renderContainer.position.y).toBe(before)
  })
})

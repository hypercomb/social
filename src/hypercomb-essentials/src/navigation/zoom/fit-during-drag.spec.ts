// A TILE IN HAND OWNS THE VIEWPORT.
//
// Resetting the zoom mid-drag used to slide and rescale the world under a
// stationary cursor for 200ms. No pointermove fires during that animation, so
// the held tile detached from the pointer and the drop landed at a slot the
// participant never pointed at. The fit also measured the content layer as the
// move PREVIEW had arranged it, framing an order that stops existing the moment
// the drag commits.
//
// The rule is now: you cannot reset the zoom until you let go.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, any>()

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

describe('zoom-to-fit while a tile is in hand', () => {
  let zoom: any

  beforeEach(async () => {
    await import('./zoom.drone.js')
    zoom = registry.get('@diamondcoreprocessor.com/ZoomDrone')
    await zoom.heartbeat()
    stubViewport(zoom)
    EffectBus.emit('move:drag', { active: false })
  })

  it('fits normally when no drag is in flight', () => {
    expect(zoom.zoomToFit(true, 'user')).toBe(true)
  })

  it('refuses the fit while a drag is in flight, and leaves the viewport untouched', () => {
    const before = {
      scale: zoom.renderContainer.scale.x,
      x: zoom.renderContainer.position.x,
      y: zoom.renderContainer.position.y,
    }

    EffectBus.emit('move:drag', { active: true })

    expect(zoom.zoomToFit(true, 'user')).toBe(false)
    expect(zoom.renderContainer.scale.x).toBe(before.scale)
    expect(zoom.renderContainer.position.x).toBe(before.x)
    expect(zoom.renderContainer.position.y).toBe(before.y)
  })

  it('fits again once the tile is let go', () => {
    EffectBus.emit('move:drag', { active: true })
    expect(zoom.zoomToFit(true, 'user')).toBe(false)

    EffectBus.emit('move:drag', { active: false })
    expect(zoom.zoomToFit(true, 'user')).toBe(true)
  })
})

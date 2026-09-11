import { describe, expect, it } from 'vitest'
import { cutRegions } from './markup-cut'

const cut = (x1: number, y1: number, x2: number, y2: number) => ({ from: { x: x1, y: y1 }, to: { x: x2, y: y2 } })

describe('cutRegions', () => {
  it('maps a cut from CSS pixels onto a tab capture at the device pixel ratio', () => {
    expect(cutRegions([cut(100, 50, 300, 150)], { width: 1000, height: 800 }, { width: 2000, height: 1600 }))
      .toEqual([{ x: 200, y: 100, width: 400, height: 200 }])
  })

  it('takes a cut dragged in any direction', () => {
    expect(cutRegions([cut(300, 150, 100, 50)], { width: 1000, height: 800 }, { width: 2000, height: 1600 }))
      .toEqual([{ x: 200, y: 100, width: 400, height: 200 }])
  })

  it('follows a capture the browser scaled down', () => {
    expect(cutRegions([cut(400, 100, 800, 500)], { width: 1600, height: 900 }, { width: 1280, height: 720 }))
      .toEqual([{ x: 320, y: 80, width: 320, height: 320 }])
  })

  it('clamps a cut that runs off the screen', () => {
    expect(cutRegions([cut(900, 700, 1200, 900)], { width: 1000, height: 800 }, { width: 1000, height: 800 }))
      .toEqual([{ x: 900, y: 700, width: 100, height: 100 }])
  })

  it('drops a cut lying wholly off the screen', () => {
    expect(cutRegions([cut(1100, 10, 1200, 90)], { width: 1000, height: 800 }, { width: 1000, height: 800 }))
      .toEqual([])
  })

  it('keeps the order the cuts were drawn in', () => {
    expect(cutRegions([cut(500, 500, 600, 600), cut(0, 0, 50, 50)], { width: 1000, height: 800 }, { width: 1000, height: 800 }))
      .toEqual([{ x: 500, y: 500, width: 100, height: 100 }, { x: 0, y: 0, width: 50, height: 50 }])
  })

  it('refuses a frame that is not this tab — a whole monitor has another shape', () => {
    expect(cutRegions([cut(100, 100, 200, 200)], { width: 1000, height: 800 }, { width: 2560, height: 1440 })).toBeNull()
  })

  it('refuses sizes with no area', () => {
    expect(cutRegions([cut(0, 0, 10, 10)], { width: 0, height: 0 }, { width: 1000, height: 800 })).toBeNull()
  })
})

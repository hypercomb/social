import { beforeEach, describe, expect, it } from 'vitest'
import {
  getLaneScrollAxis,
  laneStripHorizontal,
  setLaneViewport,
} from './lane-viewport-mode.js'
import { MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

/** The lane viewport is mobile-only, so every read goes through the mode
 *  service. Stub the one key the module asks for. */
const setMobile = (active: boolean): void => {
  ;(globalThis as { ioc?: { get: (key: string) => unknown } }).ioc = {
    get: (key: string) => (key === MOBILE_MODE_IOC_KEY ? { active } : undefined),
  }
}

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

const portrait = (): void => setViewport(390, 844)
const landscape = (): void => setViewport(844, 390)

describe('lane viewport axis', () => {
  beforeEach(() => {
    setMobile(true)
    portrait()
    setLaneViewport(false)
  })

  it('locks nothing until lanes are engaged', () => {
    expect(getLaneScrollAxis()).toBeNull()
  })

  it('scrolls up/down in portrait — the long way', () => {
    setLaneViewport(true)
    expect(getLaneScrollAxis()).toBe('y')
  })

  it('scrolls left/right in landscape — still the long way', () => {
    landscape()
    setLaneViewport(true)
    expect(getLaneScrollAxis()).toBe('x')
  })

  // The regression this file exists for: the axis used to be captured when the
  // arrangement was packed, so a rotation whose re-pack was late, swallowed or
  // (on iOS) reported with the pre-rotation metrics left the phone locked
  // ACROSS the screen — travelling up and down inside a landscape strip.
  it('follows the device the instant it turns, with no re-arrangement', () => {
    setLaneViewport(true)
    expect(getLaneScrollAxis()).toBe('y')
    landscape()
    expect(getLaneScrollAxis()).toBe('x')
    portrait()
    expect(getLaneScrollAxis()).toBe('y')
  })

  it('releases the lock when lanes are turned off', () => {
    setLaneViewport(true)
    setLaneViewport(false)
    landscape()
    expect(getLaneScrollAxis()).toBeNull()
  })

  it('never locks the desktop viewport, however lanes was reached', () => {
    setMobile(false)
    setLaneViewport(true)
    expect(getLaneScrollAxis()).toBeNull()
    landscape()
    expect(getLaneScrollAxis()).toBeNull()
  })

  it('drops the lock the moment mobile mode goes away', () => {
    setLaneViewport(true)
    expect(getLaneScrollAxis()).toBe('y')
    setMobile(false)
    expect(getLaneScrollAxis()).toBeNull()
  })

  it('reads the strip direction from the viewport, squares counting as portrait', () => {
    portrait()
    expect(laneStripHorizontal()).toBe(false)
    landscape()
    expect(laneStripHorizontal()).toBe(true)
    setViewport(500, 500)
    expect(laneStripHorizontal()).toBe(false)
  })
})

// The regression that made lanes a desktop-only illusion: every bee is bundled
// standalone, so this module is INLINED SEPARATELY into the sequence drone that
// engages lanes and into the pan/zoom inputs that must obey it. Module scope is
// therefore NOT shared at runtime — the deployed phone had one copy set to true
// and another, the one pan reads,permanently false. A second copy is exactly what a
// second bee is; it must come into step through the bus.
describe('lane viewport across separately bundled copies', () => {
  beforeEach(() => {
    setMobile(true)
    portrait()
    setLaneViewport(false)
  })

  it('engaging in one copy locks the axis in another', async () => {
    setLaneViewport(true)
    // A fresh module instance = the pan bee's private copy of this file.
    const other = await import('./lane-viewport-mode.js?copy=pan')
    expect(other.getLaneScrollAxis()).toBe('y')
    landscape()
    expect(other.getLaneScrollAxis()).toBe('x')
  })

  it('releasing in one copy releases it in the other', async () => {
    setLaneViewport(true)
    const other = await import('./lane-viewport-mode.js?copy=zoom')
    expect(other.getLaneScrollAxis()).not.toBeNull()
    setLaneViewport(false)
    expect(other.getLaneScrollAxis()).toBeNull()
  })
})

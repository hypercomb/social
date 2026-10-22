// The phone reads the hive as a strip and never writes it. Drives the
// RailProjectionDrone through a stubbed world — mobile mode, the axial grid,
// the lineage, the zoom — and pins the posture: rails by default, the matrix
// re-projected on rotation and on a rung change, released on /lanes off and
// when mobile mode goes, and a fit on the render that follows each
// projection and each arrival at a new page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { railCoord } from '../presentation/grid/rail-grid.js'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'
import { LANE_VIEWPORT_EFFECT, setLaneCount } from './lane-viewport-mode.js'

type Matrix = ReadonlyMap<number, { q: number; r: number }>
const CAPACITY = 12
const VIEWPORT_KEY = '@diamondcoreprocessor.com/ViewportPersistence'

type Zoom = { scale: number; cx: number; cy: number; fit?: boolean }
type Pan = { dx: number; dy: number }
/** The viewport mirror the zoom and pan drones report into, as the rail sees it. */
const viewportStub = (zoom: Zoom, pan: Pan) => {
  const vp = Object.assign(new EventTarget(), {
    lastZoom: zoom as Zoom | undefined,
    lastPan: pan as Pan | undefined,
    setZoom: vi.fn(),
    setPan: vi.fn(),
    restored: [] as unknown[],
  })
  vp.addEventListener('restore', (e) => vp.restored.push((e as CustomEvent).detail))
  services.set(VIEWPORT_KEY, vp)
  return vp
}

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const { RailProjectionDrone } = await import('./rail-projection.drone.js')
type Rail = InstanceType<typeof RailProjectionDrone>

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}
const portrait = (): void => setViewport(390, 844)
const landscape = (): void => setViewport(844, 390)

/** The bus replays the last value on subscribe; that is the read. */
const last = <T>(effect: string): T | undefined => {
  let value: T | undefined
  EffectBus.on<T>(effect, p => { value = p })()
  return value
}

let mobile: { active: boolean }
let project: ReturnType<typeof vi.fn>
let zoomToFit: ReturnType<typeof vi.fn>
let segments: string[]
let drone: Rail
let listeners: Array<[string, EventListenerOrEventListenerObject]>

const matrixAt = (call: number): Matrix => project.mock.calls[call][0] as Matrix
const beat = (): Promise<void> =>
  (drone as unknown as { heartbeat: (grammar: string) => Promise<void> }).heartbeat('')
const rotate = async (): Promise<void> => {
  window.dispatchEvent(new Event('orientationchange'))
  await vi.advanceTimersByTimeAsync(200)
}

beforeEach(() => {
  vi.useFakeTimers()
  EffectBus.clear()
  localStorage.clear()
  localStorage.setItem('hc:lanes', 'on')
  setLaneCount(3)
  portrait()
  mobile = { active: true }
  let projected: Matrix | null = null
  project = vi.fn((matrix: Matrix | null) => { projected = matrix; return true })
  zoomToFit = vi.fn()
  segments = ['honey-garden']
  services.set(MOBILE_MODE_IOC_KEY, mobile)
  services.set('@diamondcoreprocessor.com/AxialService', {
    project,
    get capacity() { return CAPACITY },
    get projected() { return projected !== null },
  })
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => segments })
  services.set('@diamondcoreprocessor.com/ZoomDrone', { zoomToFit })
  // The drone binds window listeners it never removes (the shell holds it
  // forever); catch them so one test's drone cannot re-project in another's.
  listeners = []
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, options) => {
    listeners.push([type, fn])
    add(type, fn, options)
  })
  drone = new RailProjectionDrone()
})

afterEach(() => {
  services.delete(VIEWPORT_KEY)
  drone.markDisposed()
  vi.restoreAllMocks()
  for (const [type, fn] of listeners) window.removeEventListener(type, fn)
  vi.useRealTimers()
})

describe('rail projection — the phone posture', () => {
  it('projects three rails by default: slot 0 at the strip start, the row of three beside it', async () => {
    await beat()
    expect(project).toHaveBeenCalledTimes(1)
    const matrix = matrixAt(0)
    expect(matrix.size).toBe(CAPACITY)
    expect(matrix.get(0)).toEqual({ q: -1, r: 0 })
    for (let slot = 0; slot < CAPACITY; slot++) expect(matrix.get(slot)).toEqual(railCoord(slot, 3, false))
    // Row 0 is three consecutive q's; row 1 starts the next rank down.
    expect([0, 1, 2].map(s => matrix.get(s)!.r)).toEqual([0, 0, 0])
    expect(matrix.get(2)!.q - matrix.get(0)!.q).toBe(2)
    expect(matrix.get(3)!.r).toBe(1)

    expect(drone.active).toBe(true)
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 3 })
    expect(last(LANE_VIEWPORT_EFFECT)).toEqual({ active: true })
    expect(last('render:grid-changed')).toEqual({ active: true, lanes: 3, horizontal: false })
    // Portrait is point-top, the standing default: no orientation override owed.
    expect(last('render:set-orientation')).toBeUndefined()
  })

  it('projects on a desktop when lanes are enabled', async () => {
    mobile.active = false
    await beat()
    expect(project).toHaveBeenCalledTimes(1)
    expect(drone.active).toBe(true)
  })

  it('re-projects flat-top when the phone turns, once the rotation settles — and back', async () => {
    await beat()
    landscape()
    window.dispatchEvent(new Event('orientationchange'))
    expect(project).toHaveBeenCalledTimes(1)     // the burst has not settled
    await vi.advanceTimersByTimeAsync(200)
    expect(project).toHaveBeenCalledTimes(2)
    const flat = matrixAt(1)
    expect(flat.size).toBe(CAPACITY)
    for (let slot = 0; slot < CAPACITY; slot++) expect(flat.get(slot)).toEqual(railCoord(slot, 3, true))
    expect(last('render:set-orientation')).toEqual({ flat: true })
    expect(last('render:grid-changed')).toEqual({ active: true, lanes: 3, horizontal: true })

    portrait()
    await rotate()
    expect(project).toHaveBeenCalledTimes(3)
    expect(matrixAt(2).get(0)).toEqual(railCoord(0, 3, false))
    expect(last('render:set-orientation')).toEqual({ flat: false })
  })

  it('a rotation that does not flip the long axis re-projects nothing', async () => {
    await beat()
    setViewport(412, 915)
    await rotate()
    expect(project).toHaveBeenCalledTimes(1)
  })

  it('lanes:off releases the projection for this participant; lanes:on brings it back', async () => {
    await beat()
    EffectBus.emit('lanes:off', {})
    expect(project).toHaveBeenLastCalledWith(null)
    expect(drone.active).toBe(false)
    expect(last('lanes:changed')).toEqual({ active: false, lanes: 3 })
    expect(last(LANE_VIEWPORT_EFFECT)).toEqual({ active: false })
    expect(last('render:grid-changed')).toEqual({ active: false, lanes: 3, horizontal: null })
    expect(localStorage.getItem('hc:lanes')).toBe('off')

    EffectBus.emit('lanes:on', {})
    expect(project).toHaveBeenCalledTimes(3)
    expect(matrixAt(2).get(0)).toEqual(railCoord(0, 3, false))
    expect(drone.active).toBe(true)
    expect(localStorage.getItem('hc:lanes')).toBe('on')
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 3 })
  })

  it('always keeps three lanes when a legacy rung event arrives', async () => {
    await beat()
    EffectBus.emit('lanes:set', { lanes: 2 })
    expect(project).toHaveBeenCalledTimes(1)
    for (let slot = 0; slot < CAPACITY; slot++) expect(matrixAt(0).get(slot)).toEqual(railCoord(slot, 3, false))
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 3 })
    expect(last('render:grid-changed')).toEqual({ active: true, lanes: 3, horizontal: false })

    // Legacy stepping is equally unable to change the fixed layout.
    EffectBus.emit('lanes:step', { dir: -1 })
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 3 })
    expect(project).toHaveBeenCalledTimes(1)
  })

  it('fits the strip on the settled render after a projection, and again on arrival at a new page', async () => {
    await beat()
    expect(zoomToFit).not.toHaveBeenCalled()
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(zoomToFit).toHaveBeenCalledWith(false, 'auto-persist')

    // The same page rendering again owes nothing.
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)

    // A new page: a partial pass waits, the settled one fits.
    segments = ['honey-garden', 'rose']
    EffectBus.emit('render:cell-count', { settled: false })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(2)
  })

  it('keeps lanes active when mobile mode changes', async () => {
    await beat()
    mobile.active = false
    EffectBus.emit(MOBILE_MODE_EFFECT, { active: false })
    expect(project).toHaveBeenCalledTimes(1)
    expect(drone.active).toBe(true)
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 3 })
  })

  it('toggling hands each posture back the zoom and position it last had on the page', async () => {
    const vp = viewportStub({ scale: 2, cx: 10, cy: 20 }, { dx: 5, dy: 6 })
    await beat()
    // First time in the strip here: nothing parked for it, so it fits.
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(vp.restored).toEqual([])

    // The participant reads down the strip, then asks for the map back.
    vp.lastZoom = { scale: 1, cx: 0, cy: 0, fit: true }
    vp.lastPan = { dx: 0, dy: 300 }
    EffectBus.emit('lanes:toggle', {})
    expect(drone.active).toBe(false)
    EffectBus.emit('render:cell-count', { settled: false })
    await vi.advanceTimersByTimeAsync(100)
    // The map comes back exactly as it was left — no fit.
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(vp.setZoom).toHaveBeenLastCalledWith(2, 10, 20, false, 'auto-persist')
    expect(vp.setPan).toHaveBeenLastCalledWith(5, 6, 'auto-persist')
    expect(vp.restored).toEqual([{ zoom: { scale: 2, cx: 10, cy: 20 }, pan: { dx: 5, dy: 6 } }])

    // Roam the map, then back to the strip: it resumes where the reading stopped.
    vp.lastZoom = { scale: 3, cx: 1, cy: 1 }
    vp.lastPan = { dx: -4, dy: 0 }
    EffectBus.emit('lanes:toggle', {})
    expect(drone.active).toBe(true)
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(vp.setZoom).toHaveBeenLastCalledWith(1, 0, 0, true, 'auto-persist')
    expect(vp.setPan).toHaveBeenLastCalledWith(0, 300, 'auto-persist')
    expect(vp.restored).toHaveLength(2)

    // And the map again, as the roaming left it.
    EffectBus.emit('lanes:toggle', {})
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(vp.setZoom).toHaveBeenLastCalledWith(3, 1, 1, false, 'auto-persist')
    expect(vp.setPan).toHaveBeenLastCalledWith(-4, 0, 'auto-persist')
  })

  it('a parked strip is for one long axis: a rotation fits the strip afresh', async () => {
    const vp = viewportStub({ scale: 2, cx: 10, cy: 20 }, { dx: 5, dy: 6 })
    await beat()
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)

    vp.lastZoom = { scale: 1, cx: 0, cy: 0 }
    EffectBus.emit('lanes:toggle', {})
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)

    // Back into the strip, but held the other way: that axis has no parked
    // reading, so it fits.
    landscape()
    EffectBus.emit('lanes:toggle', {})
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(2)

    // Turning the phone re-fits, even where a reading was parked.
    portrait()
    await rotate()
    EffectBus.emit('render:cell-count', { settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(3)
    expect(vp.restored).toHaveLength(1)
  })

  it('never more lanes than tiles: two tiles read in two lanes, and the third brings the third lane', async () => {
    EffectBus.emit('render:cell-count', { count: 2, settled: true })
    await beat()
    expect(project).toHaveBeenCalledTimes(1)
    for (let slot = 0; slot < CAPACITY; slot++) expect(matrixAt(0).get(slot)).toEqual(railCoord(slot, 2, false))
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 2 })
    expect(last('render:grid-changed')).toEqual({ active: true, lanes: 2, horizontal: false })

    // The render after the projection fits, as ever.
    EffectBus.emit('render:cell-count', { count: 2, settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(project).toHaveBeenCalledTimes(1)

    // A third tile streaming in is not yet a count; settled, it widens the strip.
    EffectBus.emit('render:cell-count', { count: 3, settled: false })
    expect(project).toHaveBeenCalledTimes(1)
    EffectBus.emit('render:cell-count', { count: 3, settled: true })
    expect(project).toHaveBeenCalledTimes(2)
    expect(matrixAt(1).get(0)).toEqual(railCoord(0, 3, false))
    expect(last('lanes:changed')).toEqual({ active: true, lanes: 3 })
    // ...and the render that follows the wider strip fits it.
    EffectBus.emit('render:cell-count', { count: 3, settled: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(zoomToFit).toHaveBeenCalledTimes(2)

    // One tile: one lane. Many: three, never more.
    EffectBus.emit('render:cell-count', { count: 1, settled: true })
    expect(matrixAt(2).get(0)).toEqual(railCoord(0, 1, false))
    EffectBus.emit('render:cell-count', { count: 40, settled: true })
    expect(matrixAt(3).get(1)).toEqual(railCoord(1, 3, false))
    expect(project).toHaveBeenCalledTimes(4)
  })

  it('owns the orientation only while active — the standing preference comes back on release', async () => {
    landscape()
    await beat()
    expect(last('render:set-orientation')).toEqual({ flat: true })
    EffectBus.emit('lanes:off', {})
    expect(last('render:set-orientation')).toEqual({ flat: false })
    expect(localStorage.getItem('hc:hex-orientation')).toBeNull()
  })
})

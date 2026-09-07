// The active Select pill belongs to the hexagon canvas, never to idle chrome
// or a ViewMode takeover. `view:active` is deliberately not emitted in the
// mode-transition test: ViewMode must close the timing hole by itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

const services = new Map<string, unknown>()
const registered = new Map<string, unknown>()

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string) => registered.get(key) ?? services.get(key),
  whenReady: (key: string, callback: (value: unknown) => void) => {
    const value = registered.get(key) ?? services.get(key)
    if (value !== undefined) callback(value)
  },
}

const { SelectModeDrone } = await import('./select-mode.drone.js')

class TestViewMode extends EventTarget {
  mode = 'hexagons'

  setMode(next: string): void {
    this.mode = next
    this.dispatchEvent(new CustomEvent('change', { detail: { mode: next } }))
  }
}

let drone: InstanceType<typeof SelectModeDrone>
let viewMode: TestViewMode
let clearSelection: ReturnType<typeof vi.fn>

const pill = (): HTMLElement | null => document.getElementById('hc-select-pill')

beforeEach(async () => {
  EffectBus.clear()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-hypercomb-mode')
  services.clear()
  clearSelection = vi.fn()
  viewMode = new TestViewMode()
  services.set(MOBILE_MODE_IOC_KEY, { active: true })
  services.set('@hypercomb.social/ViewMode', viewMode)
  services.set('@diamondcoreprocessor.com/SelectionService', {
    clear: clearSelection,
    add: vi.fn(),
  })
  drone = new SelectModeDrone()
  await drone.pulse('')
})

afterEach(() => {
  drone.markDisposed()
  EffectBus.clear()
  document.body.replaceChildren()
})

describe('SelectModeDrone active pill surface', () => {
  it('leaves an idle mobile hexagon surface clear', () => {
    expect(pill()).toBeNull()
  })

  it('appears when selection is armed and leaves when it is disarmed', () => {
    expect(pill()).toBeNull()

    drone.arm()
    expect(pill()).not.toBeNull()

    drone.disarm()
    expect(pill()).toBeNull()
  })

  it('leaves for website and any other takeover, then returns while still armed', () => {
    drone.arm()
    expect(pill()).not.toBeNull()

    viewMode.setMode('website')
    expect(pill()).toBeNull()

    viewMode.setMode('hexagons')
    expect(pill()).not.toBeNull()

    viewMode.setMode('tutor')
    expect(pill()).toBeNull()

    viewMode.setMode('hexagons')
    expect(pill()).not.toBeNull()

    drone.disarm()
    expect(pill()).toBeNull()
  })

  it('still treats owner-counted view:active as an independent safeguard', () => {
    drone.arm()
    expect(pill()).not.toBeNull()

    EffectBus.emit('view:active', { active: true, owner: 'tile-view' })
    expect(pill()).toBeNull()

    EffectBus.emit('view:active', { active: false, owner: 'tile-view' })
    expect(pill()).not.toBeNull()
  })

  it('releases tile takeover and clears the picked set when replaced while armed', () => {
    const modes: boolean[] = []
    EffectBus.on<{ active?: boolean }>('select:mode', payload => modes.push(payload.active === true))
    drone.arm()

    drone.markDisposed()

    expect(clearSelection).toHaveBeenCalledTimes(1)
    expect(modes.at(-1)).toBe(false)
    expect(pill()).toBeNull()
  })
})

// pools/pools-badge.drone.spec.ts : the lit badge against a real Pixi
// container and fake marks. Nothing is rendered: the spec reads the badge
// layer's children.

import { beforeEach, describe, expect, it } from 'vitest'
import { Container } from 'pixi.js'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { services.set(key, value) },
  whenReady: () => void 0,
  onRegister: () => () => void 0,
}
services.set('@hypercomb.social/Lineage', { explorerLabel: () => '/kitchen' })

const { LIGHTS_CHANGED, LIGHTS_MODE } = await import('./lights-contract.js')
const { setBranchPublic, setCellPublic } = await import('../presentation/tiles/tile-public.js')
await import('./pools-badge.drone.js')

const drone = services.get('@diamondcoreprocessor.com/PoolsBadgeDrone') as { pulse(grammar: string): Promise<void> }
const root = new Container()
await drone.pulse('')
EffectBus.emit('render:host-ready', { container: root })

/** The badge layer is the one child the drone added to the render root. */
const layer = (): Container => root.children[0] as Container
const mode = (active: boolean): void => { EffectBus.emit(LIGHTS_MODE, { active }) }
const page = (labels: string[], externalLabels: string[] = []): void => {
  EffectBus.emit('render:cell-count', { count: labels.length, labels, coords: labels.map((_, q) => ({ q, r: 0 })), externalLabels })
}
const turned = (): void => { EffectBus.emit(LIGHTS_CHANGED, {}) }
const hover = (label: string | null): void => { EffectBus.emit('tile:hover', { label }) }

beforeEach(() => {
  localStorage.clear()
  mode(false)
  hover(null)
  page([])
})

describe('the lit badge', () => {
  it('wears nothing outside pools mode, whatever is on or hovered', () => {
    setCellPublic('/kitchen', 'soup', true)
    page(['soup', 'bread'])
    hover('soup')
    expect(layer().children).toHaveLength(0)
  })

  it('wears nothing at rest in pools mode: the dimming alone says what is on', () => {
    setCellPublic('/kitchen', 'soup', true)
    setBranchPublic('/kitchen', 'bread', true)
    mode(true)
    page(['soup', 'bread'])
    expect(layer().children).toHaveLength(0)
    setBranchPublic('/kitchen', 'bread', false)
  })

  it("puts one badge on the tile under the pointer, on or off, and none on a peer's", () => {
    setCellPublic('/kitchen', 'soup', true)
    setCellPublic('/kitchen', 'visitor', true)
    mode(true)
    page(['soup', 'bread', 'visitor'], ['visitor'])
    hover('soup')
    expect(layer().children).toHaveLength(1)
    expect(layer().eventMode).toBe('none')
    expect(layer().children[0].eventMode).toBe('none')
    hover('bread')
    expect(layer().children).toHaveLength(1)
    hover('visitor')
    expect(layer().children).toHaveLength(0)
    hover('bread')
    hover(null)
    expect(layer().children).toHaveLength(0)
  })

  it("follows the hovered tile's light as it turns, on the same badge", () => {
    mode(true)
    page(['soup', 'bread'])
    hover('soup')
    const badge = layer().children[0]
    setCellPublic('/kitchen', 'soup', true)
    turned()
    expect(layer().children).toHaveLength(1)
    expect(layer().children[0]).toBe(badge)
    setCellPublic('/kitchen', 'soup', false)
    turned()
    expect(layer().children[0]).toBe(badge)
  })

  it('draws a branch lit whole wider than a single lit tile: the second ring', () => {
    setCellPublic('/kitchen', 'soup', true)
    mode(true)
    page(['soup'])
    hover('soup')
    const badge = layer().children[0]
    const single = badge.width
    setBranchPublic('/kitchen', 'soup', true)
    turned()
    expect(layer().children[0]).toBe(badge)
    expect(badge.width).toBeGreaterThan(single)
    setBranchPublic('/kitchen', 'soup', false)
    turned()
    expect(badge.width).toBeCloseTo(single, 5)
  })

  it('clears the badge when the mode ends, and hides with the hive', () => {
    setCellPublic('/kitchen', 'soup', true)
    mode(true)
    page(['soup'])
    hover('soup')
    EffectBus.emit('render:set-hive-visible', { visible: false })
    expect(layer().visible).toBe(false)
    EffectBus.emit('render:set-hive-visible', { visible: true })
    expect(layer().visible).toBe(true)
    mode(false)
    expect(layer().children).toHaveLength(0)
  })
})

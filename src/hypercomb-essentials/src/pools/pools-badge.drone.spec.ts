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

beforeEach(() => {
  localStorage.clear()
  mode(false)
  page([])
})

describe('the lit badge', () => {
  it('wears nothing outside pools mode, whatever is on', () => {
    setCellPublic('/kitchen', 'soup', true)
    page(['soup', 'bread'])
    expect(layer().children).toHaveLength(0)
  })

  it('puts one badge on each of your own tiles that is on, and none on a peer\'s', () => {
    setCellPublic('/kitchen', 'soup', true)
    setCellPublic('/kitchen', 'visitor', true)
    mode(true)
    page(['soup', 'bread', 'visitor'], ['visitor'])
    expect(layer().children).toHaveLength(1)
    expect(layer().eventMode).toBe('none')
    expect(layer().children[0].eventMode).toBe('none')
  })

  it('follows a light as it turns, keeping the badges that did not change', () => {
    setCellPublic('/kitchen', 'soup', true)
    mode(true)
    page(['soup', 'bread'])
    const first = layer().children[0]
    setCellPublic('/kitchen', 'bread', true)
    turned()
    expect(layer().children).toHaveLength(2)
    expect(layer().children[0]).toBe(first)
    setCellPublic('/kitchen', 'soup', false)
    turned()
    expect(layer().children).toHaveLength(1)
    expect(layer().children[0]).not.toBe(first)
  })

  it('draws a branch lit whole wider than a single lit tile: the second ring', () => {
    setCellPublic('/kitchen', 'soup', true)
    setBranchPublic('/kitchen', 'bread', true)
    mode(true)
    page(['soup', 'bread'])
    const [single, branch] = layer().children
    expect(branch.width).toBeGreaterThan(single.width)
    setBranchPublic('/kitchen', 'bread', false)
    setCellPublic('/kitchen', 'bread', true)
    turned()
    expect(layer().children[1]).toBe(branch)
    expect(branch.width).toBeCloseTo(single.width, 5)
  })

  it('badges a tile under a lit branch as on', () => {
    setBranchPublic('/', 'kitchen', true)
    mode(true)
    page(['soup'])
    expect(layer().children).toHaveLength(1)
    setBranchPublic('/', 'kitchen', false)
  })

  it('clears every badge when the mode ends, and hides with the hive', () => {
    setCellPublic('/kitchen', 'soup', true)
    mode(true)
    page(['soup'])
    EffectBus.emit('render:set-hive-visible', { visible: false })
    expect(layer().visible).toBe(false)
    EffectBus.emit('render:set-hive-visible', { visible: true })
    expect(layer().visible).toBe(true)
    mode(false)
    expect(layer().children).toHaveLength(0)
  })
})

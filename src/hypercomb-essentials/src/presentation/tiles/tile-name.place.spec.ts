// tile-name.place.spec.ts — a name that has not moved is not written again
// (SCALE-1).
//
// Every render pass hands TileNameDrone the whole page, and it places every
// name. At a meeting of a thousand tiles that was two style writes per name
// per pass — each one parsed again by the browser — whether the name had moved
// or not, and the participant's own create waited behind each pass. A pass now
// writes only the names whose place changed.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const { TileNameDrone } = await import('./tile-name.drone.js')

type Coord = { q: number; r: number }

/** Every transform written, in order — read back to names by named(). */
const written: string[] = []

/** The names whose span now wears each written transform. */
const named = (): string[] => {
  const spans = [...document.querySelectorAll<HTMLElement>('.hc-tile-names-world > span')]
  return written.flatMap(value => spans
    .filter(span => span.style.transform === value)
    .map(span => span.querySelector('.hc-tile-name-text')?.textContent ?? '?'))
}

beforeAll(() => {
  const proto = Object.getPrototypeOf(document.createElement('span').style)
  const desc = Object.getOwnPropertyDescriptor(proto, 'transform')
  if (!desc?.set) throw new Error('jsdom style has no transform setter to observe')
  vi.spyOn(proto, 'transform', 'set').mockImplementation(function (this: CSSStyleDeclaration, value: string) {
    written.push(value)
    desc.set!.call(this, value)
  })
})
afterAll(() => { vi.restoreAllMocks() })

const page = (n: number, moved: Record<string, Coord> = {}) => {
  const labels = Array.from({ length: n }, (_, i) => `t${i}`)
  const coords = labels.map((label, i) => moved[label] ?? { q: i % 20, r: Math.floor(i / 20) })
  return { count: n, labels, coords }
}

beforeEach(async () => {
  EffectBus.clear()
  services.clear()
  document.body.innerHTML = ''
  services.set('@diamondcoreprocessor.com/ShowCellDrone', {
    nameHidden: () => false,
    displayNameFor: (label: string) => label,
    shaderDrawsName: () => false,
  })
  const drone = new TileNameDrone()
  await (drone as unknown as { heartbeat: (g: string) => Promise<void> }).heartbeat('')
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const noop = (): void => { /* stub */ }
  EffectBus.emit('render:host-ready', {
    app: { ticker: { add: noop, remove: noop }, renderer: { screen: { width: 800, height: 600 }, on: noop, off: noop } },
    container: { worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } },
    canvas,
    renderer: { on: noop, off: noop },
  })
  written.length = 0
})

describe('TileNameDrone places only the names that moved', () => {
  it('a repeated pass of an unchanged page writes no name', () => {
    EffectBus.emit('render:cell-count', page(200))
    expect(written.length).toBe(200)
    written.length = 0
    EffectBus.emit('render:cell-count', page(200))
    EffectBus.emit('render:cell-count', page(200))
    expect(written).toEqual([])
  })

  it('a pass with one new tile writes that one name', () => {
    EffectBus.emit('render:cell-count', page(200))
    written.length = 0
    EffectBus.emit('render:cell-count', page(201))
    expect(named()).toEqual(['t200'])
  })

  it('a moved tile is written; the rest are not', () => {
    EffectBus.emit('render:cell-count', page(50))
    written.length = 0
    EffectBus.emit('render:cell-count', page(50, { t7: { q: 30, r: 30 } }))
    expect(named()).toEqual(['t7'])
  })

  it('a change that moves every name (the mesh offset) writes every name', () => {
    EffectBus.emit('render:cell-count', page(40))
    written.length = 0
    EffectBus.emit('render:mesh-offset', { x: 12, y: -4 })
    expect(written.length).toBe(40)
  })

  it('a name that was hidden and shows again keeps its place without a write', () => {
    let hidden = false
    services.set('@diamondcoreprocessor.com/ShowCellDrone', {
      nameHidden: (label: string) => hidden && label === 't3',
      displayNameFor: (label: string) => label,
      shaderDrawsName: () => false,
    })
    EffectBus.emit('render:cell-count', page(10))
    hidden = true
    EffectBus.emit('render:name-visibility', {})
    const span = [...document.querySelectorAll('.hc-tile-names-world > span')]
      .find(s => s.querySelector('.hc-tile-name-text')?.textContent === 't3') as HTMLElement
    expect(span.hidden).toBe(true)
    written.length = 0
    hidden = false
    EffectBus.emit('render:name-visibility', {})
    expect(span.hidden).toBe(false)
    expect(written).toEqual([])
    expect(span.style.transform).toContain('translate(')
  })
})

// tile-name.dive.spec.ts — A DIVE'S NAMES ARE DRAWN, THE PAGE'S STAND ASIDE.
// The dive paints another layer through the page's own shader, whose glyphs
// are off while the DOM name layer is mounted, so the layer draws the dive's
// names from what the dive announced: in their slots, a picture-only name
// back under the pointer, and the page's names shown again when it ends.
import { beforeAll, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}
services.set('@diamondcoreprocessor.com/ShowCellDrone', {
  nameHidden: () => false,
  displayNameFor: (label: string) => label,
  shaderDrawsName: () => false,
})

const { TileNameDrone } = await import('./tile-name.drone.js')

const root = () => document.querySelector('.hc-tile-names') as HTMLElement
const names = (dive: boolean) => [...document.querySelectorAll<HTMLElement>('.hc-tile-names-world > span')]
  .filter(s => s.hasAttribute('data-dive') === dive)
  .map(s => ({ text: s.firstElementChild!.textContent, hidden: s.hidden, at: s.style.transform.split(' ')[0] }))

beforeAll(async () => {
  const drone = new TileNameDrone()
  await (drone as unknown as { heartbeat: (g: string) => Promise<void> }).heartbeat('')
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const app = { ticker: { add: () => {}, remove: () => {} }, renderer: { screen: { width: 800, height: 600 }, on: () => {}, off: () => {} } }
  EffectBus.emit('render:host-ready', { app, container: { worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } }, canvas, renderer: app.renderer })
  EffectBus.emit('render:cell-count', { count: 2, labels: ['garden', 'kitchen'], coords: [{ q: 0, r: 0 }, { q: 1, r: 0 }] })
})

describe('the names under a dive', () => {
  it('draws the page\'s names while nothing is dived', () => {
    expect(root().classList.contains('hc-diving')).toBe(false)
    expect(names(false).map(n => n.text)).toEqual(['garden', 'kitchen'])
    expect(names(true)).toEqual([])
  })

  it('stands the page aside and draws the dive\'s names in their slots', () => {
    EffectBus.emit('render:dive-painted', {
      count: 2,
      names: [{ label: 'oven', q: 1, r: 0, hidden: false }, { label: 'kitchen', q: 0, r: 1, hidden: true }],
    })
    expect(root().classList.contains('hc-diving')).toBe(true)
    const dive = names(true)
    expect(dive.map(n => [n.text, n.hidden])).toEqual([['oven', false], ['kitchen', true]])
    // The dive's own spans: the page's `kitchen` keeps its place, untouched.
    expect(dive[0].at).toBe(names(false)[1].at)
  })

  it('gives a picture-only name back under the pointer, and takes it away after', () => {
    EffectBus.emit('render:dive-hover', { label: 'kitchen' })
    expect(names(true)[1].hidden).toBe(false)
    EffectBus.emit('render:dive-hover', { label: null })
    expect(names(true)[1].hidden).toBe(true)
  })

  it('ending the dive shows the page\'s names again', () => {
    EffectBus.emit('render:dive-painted', { count: 0 })
    expect(root().classList.contains('hc-diving')).toBe(false)
    expect(names(true)).toEqual([])
    expect(names(false).map(n => [n.text, n.hidden])).toEqual([['garden', false], ['kitchen', false]])
  })
})

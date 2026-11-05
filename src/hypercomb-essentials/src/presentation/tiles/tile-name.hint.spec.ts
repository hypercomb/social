// tile-name.hint.spec.ts — an icon's explanation is said in the tile's own label.
//
// Resting the pointer on one of a tile's icons says what it does. By default
// that is said ON THE TILE: the raised label that carries the tile's name
// carries the icon's words instead (hint:say), wrapped and rising from the
// plate's bottom edge, and the name is back the moment the pointer leaves the
// icon. A tile that is not showing its icons never carries words.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const { TileNameDrone } = await import('./tile-name.drone.js')
const { TILE_STACK_DEPTHS } = await import('./tile-stack.js')

const page = { count: 3, labels: ['alpha', 'beta', 'gamma'], coords: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }] }

const spanOf = (label: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('.hc-tile-names-world > span')]
    .find(s => s.dataset.label === label || s.querySelector('.hc-tile-name-text')?.textContent === label)
  if (!found) throw new Error(`no span for ${label}`)
  return found
}
const textOf = (span: HTMLElement): string => span.querySelector('.hc-tile-name-text')?.textContent ?? ''
/** The span that carries the given words, wherever the name was before. */
const spans = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hc-tile-names-world > span')]

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
  EffectBus.emit('render:cell-count', page)
})

describe('an icon hint is said in the tile\'s own label', () => {
  it('the raised label carries the icon\'s words, and the name is back when they are taken down', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    expect(spans().map(textOf)).toContain('beta')

    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: 'Hide this tile from the hive' })
    const carrying = spans().find(s => textOf(s).startsWith('Hide'))
    expect(carrying).toBeTruthy()
    expect(textOf(carrying!)).toBe('Hide — Hide this tile from the hive')
    expect(carrying!.classList.contains('hc-raised')).toBe(true)
    expect(carrying!.classList.contains('hc-hint')).toBe(true)
    expect(spans().map(textOf)).not.toContain('beta')

    EffectBus.emitTransient('hint:say', { label: null })
    expect(spans().map(textOf)).toContain('beta')
    expect(spans().some(s => s.classList.contains('hc-hint'))).toBe(false)
  })

  it('rises from the plate\'s bottom edge and wraps inside a wider bound than a name', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    const plain = spans().find(s => textOf(s) === 'beta')!
    const plainWidth = parseFloat(plain.style.maxWidth)
    const plainTransform = plain.style.transform

    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Share', text: 'Copy a link to this tile' })
    const said = spans().find(s => s.classList.contains('hc-hint'))!
    expect(said.style.transform).toContain('translate(-50%,-100%)')
    expect(said.style.transform).not.toBe(plainTransform)
    expect(parseFloat(said.style.maxWidth)).toBeGreaterThan(plainWidth)
  })

  it('the holder count steps aside while the label speaks an icon', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emit(TILE_STACK_DEPTHS, { depths: { beta: 3 } })
    const holders = (span: HTMLElement): HTMLElement => span.querySelector('.hc-tile-name-holders') as HTMLElement
    // the count is there for the name…
    const named = spans().find(s => textOf(s) === 'beta')!
    expect(holders(named).hidden).toBe(false)
    expect(holders(named).textContent).toBe('3')
    // …and steps aside while the label speaks an icon
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '' })
    const said = spans().find(s => s.classList.contains('hc-hint'))!
    expect(holders(said).hidden).toBe(true)
    // …then returns with the name
    EffectBus.emitTransient('hint:say', { label: null })
    expect(holders(spans().find(s => textOf(s) === 'beta')!).textContent).toBe('3')
  })

  it('a tile that is not showing its icons never carries words', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'gamma', title: 'Hide', text: 'Hide this tile' })
    expect(spans().some(s => s.classList.contains('hc-hint'))).toBe(false)
    expect(textOf(spanOf('gamma'))).toBe('gamma')
  })

  it('arriving somewhere else drops words that were up', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: 'Hide this tile' })
    EffectBus.emit('location:changed', {})
    EffectBus.emit('render:cell-count', page)
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    expect(spans().some(s => s.classList.contains('hc-hint'))).toBe(false)
  })
})

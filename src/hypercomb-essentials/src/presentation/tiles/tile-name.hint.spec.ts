// tile-name.hint.spec.ts — an icon's explanation is said in the tile's own label.
//
// Resting the pointer on one of a tile's icons says what it does. By default
// that is said ON THE TILE: the raised label that carries the tile's name
// carries the icon's words instead (hint:say) — its title, then what it does —
// wrapped and rising from the plate's bottom edge, and the name is back the
// moment the pointer leaves the icon. A tile that is not showing its icons
// never carries words.

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
/** One tier of a hint — its title, or what it does — or null when it is not there. */
const tierOf = (span: HTMLElement, tier: 'title' | 'text'): string | null =>
  span.querySelector(`.hc-tile-name-text > .hc-hint-${tier}`)?.textContent ?? null
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
    // two tiers: the icon's title, then what it does
    expect(tierOf(carrying!, 'title')).toBe('Hide')
    expect(tierOf(carrying!, 'text')).toBe('Hide this tile from the hive')
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

  it('says only the tier there is — and a sentence with no title stands as the title', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Copy' })
    let said = spans().find(s => s.classList.contains('hc-hint'))!
    expect(tierOf(said, 'title')).toBe('Copy')
    expect(tierOf(said, 'text')).toBeNull()

    EffectBus.emitTransient('hint:say', { label: 'beta', title: ' ', text: 'Copies the tile' })
    said = spans().find(s => s.classList.contains('hc-hint'))!
    expect(tierOf(said, 'title')).toBe('Copies the tile')
    expect(tierOf(said, 'text')).toBeNull()

    // nothing to say is no hint at all: the name stays
    EffectBus.emitTransient('hint:say', { label: 'beta' })
    expect(spans().some(s => s.classList.contains('hc-hint'))).toBe(false)
    expect(spans().map(textOf)).toContain('beta')
  })

  it('is set at its own, smaller size than the label — more text must not mean a bigger block', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    const scaleOf = (span: HTMLElement): number => parseFloat(/scale\(([\d.]+)\)/.exec(span.style.transform)![1])
    const label = spans().find(s => textOf(s) === 'beta')!
    const labelScale = scaleOf(label)
    // the plate's bottom edge in world px: translate(0, T) is in the span's own
    // layout px, so T * scale is where the hint is anchored in the world
    const bottomOf = (span: HTMLElement): number =>
      parseFloat(/translate\(0,([\d.]+)px\)/.exec(span.style.transform)![1]) * scaleOf(span)

    EffectBus.emitTransient('hint:say', {
      label: 'beta', title: 'Send to the shelf', text: 'Send a reference to this tile to the shelf at the top',
    })
    const said = spans().find(s => s.classList.contains('hc-hint'))!
    expect(scaleOf(said)).toBeLessThan(labelScale)
    // …and set smaller it still hangs from the same bottom edge, so it rises
    // from the icons and never settles over their row
    const half = ((1 + 0.28 * 2) / 2) * 40 * labelScale
    expect(bottomOf(said)).toBeCloseTo(half, 3)
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

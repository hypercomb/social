// tile-name.hint.spec.ts — an icon's explanation is said UNDER the tile's icons.
//
// Resting the pointer on one of a tile's icons says what it does. By default
// that is said ON THE TILE: on its own plate hung below the icon block (hint:say)
// — its title, then what it does — wrapped and falling from the plate's top edge.
// The tile's name stays on its plate above the icons the whole time, and the
// hint keeps the same gap under the icons that the name keeps over them. A tile
// that is not showing its icons never carries words.

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
const { DEFAULT_HEX_GEOMETRY } = await import('../grid/hex-geometry.js')
const icons = await import('./tile-action-icons.js')

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
const spans = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hc-tile-names-world > span')]
/** The plate carrying an icon's words, when one is up. */
const hintSpan = (): HTMLElement | undefined => spans().find(s => s.classList.contains('hc-hint') && !s.hidden)
/** The tile's name plate — the one that says `beta`. */
const nameSpan = (): HTMLElement => spans().find(s => textOf(s) === 'beta')!
const scaleOf = (span: HTMLElement): number => parseFloat(/scale\(([\d.]+)\)/.exec(span.style.transform)![1])
/** The world y a span's transform puts its anchor at. */
const yOf = (span: HTMLElement): number => parseFloat(/translate\([-\d.]+px,([-\d.]+)px\)/.exec(span.style.transform)![1])

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

describe('an icon hint is said on its own plate under the icons', () => {
  it('the name stays on its plate, and the hint is a second plate that goes when the words are taken down', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    expect(hintSpan()).toBeUndefined()

    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: 'Hide this tile from the hive' })
    const said = hintSpan()
    expect(said).toBeTruthy()
    // two tiers: the icon's title, then what it does
    expect(tierOf(said!, 'title')).toBe('Hide')
    expect(tierOf(said!, 'text')).toBe('Hide this tile from the hive')
    expect(said!.classList.contains('hc-raised')).toBe(true)
    // the name is still there, on its own raised plate
    expect(textOf(nameSpan())).toBe('beta')
    expect(nameSpan().classList.contains('hc-raised')).toBe(true)
    expect(nameSpan().classList.contains('hc-hint')).toBe(false)

    EffectBus.emitTransient('hint:say', { label: null })
    expect(hintSpan()).toBeUndefined()
    expect(textOf(nameSpan())).toBe('beta')
  })

  it('hangs from its top edge below the icons, where the name sits above them', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Share', text: 'Copy a link to this tile' })
    const said = hintSpan()!
    const name = nameSpan()
    // anchored by its TOP edge, so wrapped words fall away from the icons
    expect(said.style.transform).toContain('translate(-50%,0)')
    expect(name.style.transform).toContain('translate(-50%,-50%)')
    // …under the name, in the world, and at exactly the place the helper says
    const R = DEFAULT_HEX_GEOMETRY.circumRadiusPx
    expect(yOf(said)).toBeCloseTo(icons.hintTopY(1) * R / 32, 3)
    expect(yOf(said)).toBeGreaterThan(yOf(name))
    // a wider bound than a name, because a sentence wraps
    expect(parseFloat(said.style.maxWidth)).toBeGreaterThan(parseFloat(name.style.maxWidth))
  })

  it('keeps under a row the same gap the name keeps over the top row', () => {
    const nameHalf = icons.RAISED_NAME_EM * (1 + icons.RAISED_NAME_PAD_EM * 2) / 2
    const aboveTop = (icons.iconRowY(0) - icons.PLATE_REACH) - (icons.raisedNameY() + nameHalf)
    expect(aboveTop).toBeGreaterThan(0)
    for (const rows of [1, 2]) {
      for (let row = 0; row < rows; row++) {
        const belowRow = icons.hintTopY(rows, row) - (icons.iconRowY(row) + icons.PLATE_REACH)
        expect(belowRow).toBeCloseTo(aboveTop, 6)
      }
      // pinned beside the name: the same gap under the name's plate
      expect(icons.hintTopY(rows, -1) - (icons.raisedNameY() + nameHalf)).toBeCloseTo(aboveTop, 6)
    }
  })

  it('puts the first icon row on the tile\'s centre line, however many rows wrap below it', () => {
    expect(icons.iconRowY(0)).toBe(0)
    // wrapped rows grow downward from it; the first never moves
    expect(icons.iconRowY(1)).toBeGreaterThan(icons.iconRowY(0))
    // …and the name rides above that row, clear of the centre line
    expect(icons.raisedNameY()).toBeLessThan(icons.iconRowY(0) - icons.PLATE_REACH)
  })

  it('hangs right below the row of the icon that speaks, not after the last row', () => {
    const R = DEFAULT_HEX_GEOMETRY.circumRadiusPx
    // two icon rows: the name, then row 0, then row 1
    EffectBus.emit('overlay:band-rows', { rows: 3, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })

    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '', row: 0 })
    const underFirst = yOf(hintSpan()!)
    expect(underFirst).toBeCloseTo(icons.hintTopY(2, 0) * R / 32, 3)

    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '', row: 1 })
    const underSecond = yOf(hintSpan()!)
    expect(underSecond).toBeCloseTo(icons.hintTopY(2, 1) * R / 32, 3)
    expect(underSecond).toBeGreaterThan(underFirst)
    // the first row's hint starts inside the second row's reach — it sits on the
    // row beneath it rather than skipping past it
    expect(underFirst).toBeLessThan((icons.iconRowY(1) + icons.PLATE_REACH) * R / 32)

    // an icon pinned beside the name speaks from under the name's plate
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '', row: -1 })
    expect(yOf(hintSpan()!)).toBeCloseTo(icons.hintTopY(2, -1) * R / 32, 3)
    expect(yOf(hintSpan()!)).toBeLessThan(underFirst)

    // no row said: the last row, as a single row's hint always was
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '' })
    expect(yOf(hintSpan()!)).toBeCloseTo(underSecond, 3)
  })

  it('follows the icon block down when the icons wrap onto a second row', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '' })
    const oneRow = yOf(hintSpan()!)
    EffectBus.emit('overlay:band-rows', { rows: 3, label: 'beta' })
    expect(yOf(hintSpan()!)).toBeGreaterThan(oneRow)
  })

  it('says only the tier there is — and a sentence with no title stands as the title', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Copy' })
    let said = hintSpan()!
    expect(tierOf(said, 'title')).toBe('Copy')
    expect(tierOf(said, 'text')).toBeNull()

    EffectBus.emitTransient('hint:say', { label: 'beta', title: ' ', text: 'Copies the tile' })
    said = hintSpan()!
    expect(tierOf(said, 'title')).toBe('Copies the tile')
    expect(tierOf(said, 'text')).toBeNull()

    // nothing to say is no hint at all: the name stays
    EffectBus.emitTransient('hint:say', { label: 'beta' })
    expect(hintSpan()).toBeUndefined()
    expect(textOf(nameSpan())).toBe('beta')
  })

  it('is set at its own, smaller size than the label — more text must not mean a bigger block', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    const labelScale = scaleOf(nameSpan())
    EffectBus.emitTransient('hint:say', {
      label: 'beta', title: 'Send to the shelf', text: 'Send a reference to this tile to the shelf at the top',
    })
    expect(scaleOf(hintSpan()!)).toBeLessThan(labelScale)
  })

  it('the holder count stays with the name while an icon speaks', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emit(TILE_STACK_DEPTHS, { depths: { beta: 3 } })
    const holders = (span: HTMLElement): HTMLElement => span.querySelector('.hc-tile-name-holders') as HTMLElement
    expect(holders(nameSpan()).hidden).toBe(false)
    expect(holders(nameSpan()).textContent).toBe('3')
    // the name is not what the icon speaks over, so its count is not disturbed
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: '' })
    expect(holders(nameSpan()).hidden).toBe(false)
    expect(holders(nameSpan()).textContent).toBe('3')
    // and the hint plate carries no count of its own
    expect(hintSpan()!.querySelector('.hc-tile-name-holders')).toBeNull()
  })

  it('a tile that is not showing its icons never carries words', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'gamma', title: 'Hide', text: 'Hide this tile' })
    expect(hintSpan()).toBeUndefined()
    expect(textOf(spanOf('gamma'))).toBe('gamma')
  })

  it('arriving somewhere else drops words that were up', () => {
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emitTransient('hint:say', { label: 'beta', title: 'Hide', text: 'Hide this tile' })
    expect(hintSpan()).toBeTruthy()
    EffectBus.emit('location:changed', {})
    EffectBus.emit('render:cell-count', page)
    EffectBus.emit('overlay:band-rows', { rows: 2, label: 'beta' })
    expect(hintSpan()).toBeUndefined()
  })
})

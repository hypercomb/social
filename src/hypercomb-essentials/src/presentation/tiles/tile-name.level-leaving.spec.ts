// tile-name.level-leaving.spec.ts — the names go before the pictures do.
//
// Walking into a tile hides the outgoing level's tiles and images at once, but
// the new level's names only arrive with its render:cell-count — after the
// viewport read and the image loads. The names are DOM text over the canvas, so
// the old ones used to hang over a blank screen, late to go (Jaime, 2026-11-04:
// "I see the images and tiles disappear and then the text is late. The text
// should always go first."). show-cell now says render:level-leaving before it
// hides the level, and the name layer takes every name down on it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const { TileNameDrone } = await import('./tile-name.drone.js')

const here = { count: 3, labels: ['alpha', 'beta', 'gamma'], coords: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }] }
const there = { count: 2, labels: ['delta', 'epsilon'], coords: [{ q: 0, r: 0 }, { q: 1, r: 0 }] }

const shown = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('.hc-tile-names-world > span')]
    .filter(s => !s.hidden)
    .map(s => s.querySelector('.hc-tile-name-text')?.textContent ?? '')

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
  EffectBus.emit('render:cell-count', here)
})

describe('the names go first when a level is left', () => {
  it('every name is off the screen the moment the level is announced leaving', () => {
    expect(shown()).toEqual(['alpha', 'beta', 'gamma'])
    EffectBus.emitTransient('render:level-leaving', { locationKey: '/delta' })
    expect(shown()).toEqual([])
  })

  it('stays empty until the next level\'s cell-count, which brings its own names', () => {
    EffectBus.emitTransient('render:level-leaving', { locationKey: '/delta' })
    expect(shown()).toEqual([])
    EffectBus.emit('render:cell-count', there)
    expect(shown()).toEqual(['delta', 'epsilon'])
  })

  it('a pass that repaints the same level does not announce it, and keeps its names', () => {
    EffectBus.emit('render:cell-count', here)
    expect(shown()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('drops the holder count with the names, so it never lands on a same-named tile of the next level', () => {
    EffectBus.emit('tile:hover', { label: 'beta' })
    EffectBus.emit('overlay:band-rows', { rows: 1, label: 'beta' })
    EffectBus.emitTransient('render:level-leaving', { locationKey: '/delta' })
    EffectBus.emit('render:cell-count', { count: 1, labels: ['beta'], coords: [{ q: 0, r: 0 }] })
    const holders = document.querySelector<HTMLElement>('.hc-tile-name-holders')
    expect(holders?.hidden).toBe(true)
  })
})

// ShowCellDrone cannot be stood up under vitest (Pixi renderer, IoC, OPFS), so
// the seam on its side is held by the shape of the source: the word is said
// BEFORE the outgoing layer is hidden, and only on the slow layer-change path.
describe('show-cell says it before it hides the outgoing level', () => {
  const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'latin1')
  const SAY = "EffectBus.emitTransient('render:level-leaving'"

  it('says it exactly once, and declares it among what it emits', () => {
    expect(SRC.split(SAY).length - 1).toBe(1)
    expect(SRC).toMatch(/protected override emits = \[[^\]]*'render:level-leaving'/)
  })

  it('says it ahead of the line that hides the layer, inside the layer-change branch', () => {
    const at = SRC.indexOf(SAY)
    const branch = SRC.lastIndexOf('if (layerChanged) {', at)
    const hide = SRC.indexOf('this.layer.visible = false', at)
    expect(branch).toBeGreaterThan(-1)
    expect(hide).toBeGreaterThan(at)
    // nothing between the word and the hide but the one line that follows it
    expect(SRC.slice(at, hide)).not.toMatch(/\bawait\b/)
  })
})

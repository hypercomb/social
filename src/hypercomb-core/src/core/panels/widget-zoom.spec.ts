// widget-zoom.spec.ts — the zoomable-widget primitive, driven directly.
//
// It moved out of an Angular directive in the everything-is-a-beehavior
// Phase 2 and is now shared by both kits, so it is worth pinning here: the
// live gate cannot reach it (the one surface using it renders only when a
// swarm has peers), and a silent regression would take every zoomable panel
// with it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '../../effect-bus.js'
import { attachWidgetZoom, readWidgetScale } from './widget-zoom.js'

const SCALE_KEY = 'hc:widget-scale'

/** An element whose `zoom` writes we can actually observe.
 *
 *  jsdom drops `zoom` — it is not in its CSS property table, so
 *  `setProperty('zoom', …)` is a no-op and reads back as ''. The browser
 *  keeps it (that is the whole point: `zoom` scales a panel without the
 *  glyph-softening a transform causes under a backdrop-filter). So assert
 *  the CALL, which is the contract, rather than a computed value the test
 *  environment refuses to store. */
const makeEl = (): { el: HTMLElement; zoom: () => string | null } => {
  const el = document.createElement('div')
  let applied: string | null = null
  const real = el.style.setProperty.bind(el.style)
  el.style.setProperty = (prop: string, value: string | null, priority?: string): void => {
    if (prop === 'zoom') applied = value
    real(prop, value, priority)
  }
  return { el, zoom: () => applied }
}

describe('attachWidgetZoom', () => {

  beforeEach(() => {
    localStorage.clear()
    EffectBus.clear()
  })

  it('tags the element with the contract the drone hovers on', () => {
    const { el } = makeEl()
    attachWidgetZoom(el, 'shortcut-sheet', 'bottom')
    expect(el.dataset['widget']).toBe('shortcut-sheet')
    expect(el.dataset['widgetAnchor']).toBe('bottom')
  })

  it('applies the persisted scale immediately, without waiting for the drone', () => {
    localStorage.setItem(SCALE_KEY, JSON.stringify({ 'shortcut-sheet': 1.4 }))
    const { el, zoom } = makeEl()
    attachWidgetZoom(el, 'shortcut-sheet')
    // On web the drones load from OPFS long after the shell paints, so the
    // scale has to come straight off localStorage or a zoomed panel would
    // flash at 1 on every boot.
    expect(zoom()).toBe('1.4')
  })

  it('follows later scale changes for ITS id only', () => {
    const mine = makeEl()
    const theirs = makeEl()
    attachWidgetZoom(mine.el, 'mine')
    attachWidgetZoom(theirs.el, 'theirs')

    EffectBus.emit('widget:scale-changed', { id: 'mine', scale: 2 })
    expect(mine.zoom()).toBe('2')
    // theirs was set once at attach and never again
    expect(theirs.zoom()).toBe('1')
  })

  it('stops following once torn down', () => {
    const { el, zoom } = makeEl()
    const detach = attachWidgetZoom(el, 'mine')
    detach()
    EffectBus.emit('widget:scale-changed', { id: 'mine', scale: 3 })
    // A subscription that outlives the element it scales is the leak this
    // teardown exists to prevent.
    expect(zoom()).toBe('1')
  })

  it('is a no-op for a blank id, and its teardown is safe to call', () => {
    const { el, zoom } = makeEl()
    const detach = attachWidgetZoom(el, '')
    expect(el.dataset['widget']).toBeUndefined()
    expect(zoom()).toBeNull()
    expect(() => detach()).not.toThrow()
  })

  describe('readWidgetScale', () => {
    it('answers 1 for anything it cannot trust', () => {
      expect(readWidgetScale('never-set')).toBe(1)
      localStorage.setItem(SCALE_KEY, 'not json')
      expect(readWidgetScale('any')).toBe(1)
      // A zero or negative scale would collapse the panel it is applied to.
      localStorage.setItem(SCALE_KEY, JSON.stringify({ a: 0, b: -2, c: 'big' }))
      expect(readWidgetScale('a')).toBe(1)
      expect(readWidgetScale('b')).toBe(1)
      expect(readWidgetScale('c')).toBe(1)
    })

    it('survives a storage-free session', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('private mode')
      })
      expect(readWidgetScale('any')).toBe(1)
      spy.mockRestore()
    })
  })
})

// tool-window.spec.ts — THE BASE LAYER. What every framework-free window is
// before it is any particular window: one header (title → own controls →
// gear → close, last), a body, a session the Escape policy reaches, a place
// (docked in the lane, reserving its edge; or floating), and an accent that
// follows the theme.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '../../effect-bus.js'
import { deepenAccent, installToolWindowStyles, mountToolWindow, TOOL_WINDOW_STYLE_ID, translateOr, type ToolWindow } from './tool-window.js'
import { focusedWindow, isWindowShowing, resetWindowSession } from './window-session.js'
import { laneOccupants, resetLanes } from './dock-lanes.js'

const luminance = ([r, g, b]: readonly number[]): number => {
  const lin = (c: number) => { const v = c / 255; return v > 0.03928 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92 }
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}

const mounted: ToolWindow[] = []
const mount = (options: Partial<Parameters<typeof mountToolWindow>[1]> = {}) => {
  const w = mountToolWindow(document.body, { id: 'spec-window', title: 'Offers', accent: [201, 162, 39], onClose: vi.fn(), ...options })
  mounted.push(w)
  return w
}

beforeEach(() => { resetWindowSession(); resetLanes() })
afterEach(() => { while (mounted.length) mounted.pop()!.dispose(); document.body.replaceChildren() })

describe('the tool window base layer', () => {
  it('builds one header — title, the window\'s own controls, then the close button last — and a body', () => {
    const w = mount()
    expect(w.root.classList.contains('hc-tw')).toBe(true)
    expect(w.root.firstElementChild).toBe(w.header)
    // What the window builds: title, its own controls, the close button.
    expect([...w.header.children].slice(0, 3).map(c => c.className)).toEqual(['hc-tw-title', 'hc-tw-actions', 'hc-tw-close'])
    // The gear DockedPanel injects rides after them in the DOM but is pinned
    // just left of the close, which keeps a margin for it: the close stays last on screen.
    const gear = w.header.children[3] as HTMLElement | undefined
    expect(gear?.style.position).toBe('absolute')
    expect((w.header.querySelector('.hc-tw-close') as HTMLElement).style.marginLeft).not.toBe('')
    expect(w.header.querySelector('.hc-tw-title')?.textContent).toBe('Offers')
    expect(w.body.className).toBe('hc-tw-body')
    expect(document.getElementById(TOOL_WINDOW_STYLE_ID)).not.toBeNull()
  })

  it('closes through the owner\'s verb, from the × and from the session', () => {
    const onClose = vi.fn()
    const w = mount({ onClose })
    ;(w.header.querySelector('.hc-tw-close') as HTMLButtonElement).click()
    w.session.close?.()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('is reachable by the Escape policy through its session, never by a listener of its own', () => {
    const dismiss = vi.fn(() => true)
    const w = mount({ dismiss })
    expect(isWindowShowing('spec-window')).toBe(true)
    w.body.appendChild(Object.assign(document.createElement('button'), { id: 'inside' }))
    ;(document.getElementById('inside') as HTMLButtonElement).focus()
    expect(focusedWindow()?.id).toBe('spec-window')
    expect(focusedWindow()?.session.dismiss?.()).toBe(true)
    expect(dismiss).toHaveBeenCalled()
  })

  it('parks out of the lane and back without losing what it holds', async () => {
    const settle = () => new Promise(r => setTimeout(r, 0))
    const w = mount()
    w.body.textContent = 'half-typed'
    await settle()
    expect(laneOccupants('right').map(m => m.laneId)).toContain('spec-window')
    w.session.park()
    await settle()
    expect(w.root.hidden).toBe(true)
    expect(w.panel).toBeNull()
    expect(laneOccupants('right').map(m => m.laneId)).not.toContain('spec-window')
    w.session.unpark()
    await settle()
    expect(w.root.hidden).toBe(false)
    expect(w.panel).not.toBeNull()
    expect(laneOccupants('right').map(m => m.laneId)).toContain('spec-window')
    expect(w.body.textContent).toBe('half-typed')
  })

  it('docked, reserves its edge so tiles lay out beside it; gives it back when disposed', async () => {
    const insets: { owner: string; size: number }[] = []
    const off = EffectBus.on<{ owner: string; size: number }>('viewport:inset', p => insets.push(p))
    const w = mount({ defaultWidth: 340 })
    vi.spyOn(w.root, 'getBoundingClientRect').mockReturnValue({ left: 684, right: 1024, top: 40, bottom: 768, width: 340, height: 728, x: 684, y: 40, toJSON: () => ({}) })
    await new Promise(r => setTimeout(r, 80))
    expect(insets.some(p => p.owner === 'dock-spec-window' && p.size === 1024 - 684)).toBe(true)
    w.dispose()
    mounted.pop()
    expect(insets.at(-1)).toMatchObject({ owner: 'dock-spec-window', size: 0 })
    expect(isWindowShowing('spec-window')).toBe(false)
    off()
  })

  it('floating, stays out of the lane but still in the session', () => {
    const w = mount({ placement: 'floating' })
    expect(w.panel).toBeNull()
    expect(w.root.dataset['hcPlacement']).toBe('floating')
    expect(isWindowShowing('spec-window')).toBe(true)
  })

  it('deepens the accent for bright themes as the Sass does: same hue, dark enough to read', () => {
    const w = mount()
    expect(w.root.style.getPropertyValue('--hc-tw-acc')).toBe('201, 162, 39')
    const deep = deepenAccent([201, 162, 39])
    expect(luminance(deep)).toBeLessThanOrEqual(0.12)
    expect(w.root.style.getPropertyValue('--hc-tw-acc-deep')).toBe(deep.join(', '))
    // Exactly what the Sass `deepen()` in _panel-identity.scss compiles to.
    expect(deepenAccent([126, 182, 214])).toEqual([39, 93, 123])
    expect(deep).toEqual([107, 86, 21])
    // An accent already dark enough is left alone.
    expect(deepenAccent([20, 30, 90])).toEqual([20, 30, 90])
  })

  it('installs its stylesheet once, and reads words through the i18n provider or the fallback', () => {
    installToolWindowStyles(); installToolWindowStyles()
    expect(document.querySelectorAll(`#${TOOL_WINDOW_STYLE_ID}`)).toHaveLength(1)
    expect(translateOr('nope.key', '{n} held', { n: 3 })).toBe('3 held')
  })
})

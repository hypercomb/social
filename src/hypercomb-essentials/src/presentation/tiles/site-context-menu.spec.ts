// site-context-menu.spec.ts — the website's right-click menu, driven through
// its doors: it opens where it was asked and stays on screen, its rows act, a
// copy row says Copied before it goes, keys walk it, Escape and a press
// outside put it away, and a row into the hive makes the menu a door.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { closeSiteContextMenu, isSiteContextMenuOpen, openSiteContextMenu, SITE_MENU_ID, type SiteMenuItem } from './site-context-menu.js'

const host = (): HTMLElement | null => document.getElementById(SITE_MENU_ID)
const rows = (): HTMLButtonElement[] => Array.from(host()?.shadowRoot?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
const panel = (): HTMLElement => host()!.shadowRoot!.querySelector<HTMLElement>('[role="menu"]')!

const item = (label: string, extra: Partial<SiteMenuItem> = {}): SiteMenuItem =>
  ({ icon: 'link', label, act: vi.fn(), ...extra })

afterEach(() => {
  closeSiteContextMenu()
  vi.useRealTimers()
})

describe('the website menu', () => {
  it('opens one menu at a time, with a row per item', () => {
    openSiteContextMenu({ x: 10, y: 10 }, [item('One'), item('Two')])
    openSiteContextMenu({ x: 20, y: 20 }, [item('Three')])
    expect(document.querySelectorAll(`#${SITE_MENU_ID}`)).toHaveLength(1)
    expect(rows().map(r => r.textContent)).toEqual(['Three'])
    // The glyph is inline SVG — a published door never loads the icon font.
    expect(rows()[0]!.querySelector('svg path')).not.toBeNull()
  })

  it('acts and goes away when a row is chosen', () => {
    const act = vi.fn()
    openSiteContextMenu({ x: 10, y: 10 }, [item('Back', { act })])
    rows()[0]!.click()
    expect(act).toHaveBeenCalledOnce()
    expect(isSiteContextMenuOpen()).toBe(false)
  })

  it('says Copied for a beat before it goes — and says so aloud', async () => {
    vi.useFakeTimers()
    openSiteContextMenu({ x: 10, y: 10 }, [item('Copy page link', { done: 'Copied', failed: 'Couldn\'t copy', act: () => Promise.resolve() })])
    rows()[0]!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(rows()[0]!.textContent).toContain('Copied')
    expect(host()!.shadowRoot!.querySelector('[aria-live]')!.textContent).toBe('Copied')
    await vi.advanceTimersByTimeAsync(800)
    expect(isSiteContextMenuOpen()).toBe(false)
  })

  it('never says Copied when the copy failed — it says it could not', async () => {
    vi.useFakeTimers()
    openSiteContextMenu({ x: 10, y: 10 }, [item('Copy page link', { done: 'Copied', failed: 'Couldn\'t copy', act: () => Promise.reject(new Error('no')) })])
    rows()[0]!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(rows()[0]!.textContent).toContain('Couldn\'t copy')
    await vi.advanceTimersByTimeAsync(800)
    expect(isSiteContextMenuOpen()).toBe(false)
  })

  it('chooses the focused row with Enter, and holds the hive keymap while it is up', () => {
    const held: string[] = []
    const offSuppress = EffectBus.on<{ reason: string }>('keymap:suppress', ({ reason }) => { held.push(`+${reason}`) })
    const offRelease = EffectBus.on<{ reason: string }>('keymap:unsuppress', ({ reason }) => { held.push(`-${reason}`) })
    const act = vi.fn()
    openSiteContextMenu({ x: 10, y: 10 }, [item('One', { act }), item('Two')])
    expect(held).toEqual(['+site-menu'])
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    panel().dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(act).toHaveBeenCalledOnce()
    expect(held).toEqual(['+site-menu', '-site-menu'])
    offSuppress()
    offRelease()
  })

  it('lands on its first row, walks the rows with the arrow keys, and Escape puts it away', () => {
    const before = document.body.appendChild(document.createElement('button'))
    before.focus()
    openSiteContextMenu({ x: 10, y: 10 }, [item('One'), item('Two')], 'Page menu')
    expect(panel().getAttribute('aria-label')).toBe('Page menu')
    const key = (k: string): void => { panel().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }
    expect(host()!.shadowRoot!.activeElement).toBe(rows()[0])
    key('ArrowDown')
    expect(host()!.shadowRoot!.activeElement).toBe(rows()[1])
    key('ArrowUp')
    expect(host()!.shadowRoot!.activeElement).toBe(rows()[0])
    key('Escape')
    expect(isSiteContextMenuOpen()).toBe(false)
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  it('goes away on a press outside — and the page hears none of that press', () => {
    openSiteContextMenu({ x: 10, y: 10 }, [item('One')])
    rows()[0]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 1 }))
    expect(isSiteContextMenuOpen()).toBe(true)
    const widget = document.body.appendChild(document.createElement('div'))
    const heard: string[] = []
    for (const type of ['pointerdown', 'pointerup', 'click']) widget.addEventListener(type, () => heard.push(type))
    widget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 2 }))
    expect(isSiteContextMenuOpen()).toBe(false)
    widget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 2 }))
    widget.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(heard).toEqual([])
    widget.remove()
  })

  it('stays up while the page scrolls itself, and goes on a wheel outside', () => {
    openSiteContextMenu({ x: 10, y: 10 }, [item('One')])
    document.dispatchEvent(new Event('scroll'))
    expect(isSiteContextMenuOpen()).toBe(true)
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    expect(isSiteContextMenuOpen()).toBe(false)
  })

  it('is a door into the hive only when a row opens it, and owns its Escape', () => {
    openSiteContextMenu({ x: 10, y: 10 }, [item('Copy page link')])
    expect(host()!.hasAttribute('data-hc-approach')).toBe(false)
    openSiteContextMenu({ x: 10, y: 10 }, [item('Hexagon view', { door: true })])
    expect(host()!.hasAttribute('data-hc-approach')).toBe(true)
    expect(host()!.hasAttribute('data-escape-local')).toBe(true)
    expect(document.activeElement).toBe(host())
  })

  it('stays on screen near the edges', () => {
    const at = { x: window.innerWidth - 2, y: window.innerHeight - 2 }
    openSiteContextMenu(at, [item('One')])
    const left = parseFloat(host()!.style.left)
    const top = parseFloat(host()!.style.top)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(left).toBeLessThanOrEqual(window.innerWidth - 8)
    expect(top).toBeLessThanOrEqual(window.innerHeight - 8)
  })
})

// site-view.context-menu.spec.ts — who is reading decides what the right
// button means on a website.
//
// On a PUBLISHED door it opens the website's menu and changes nothing on the
// page. It used to walk up a page and, at the site's floor, drop the reader
// into the hexagons. Now:
//   · a right-click opens the menu; the page, the mode and the place stay put
//   · Up one level is a row only below the site's floor, and walks up one
//   · Hexagon view is a row, and shows THIS page's hexagons
//   · a held finger and an editable field keep the browser's own menu
//   · the hexagons keep their own right-click (the menu is website-only)
//
// On the HOME DOMAIN (the reader's own hive — hypercomb.io, localhost) it goes
// back: no menu, the press is left to the back gesture, and the view's
// registered way out is the exit button's.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type BackEntry = { owner: string; back: () => void; active?: () => boolean }
let backEntry: BackEntry | null = null

let mode = 'website'
let segments: string[] = ['site']
const setMode = vi.fn((next: string) => {
  if (next === mode) return
  mode = next
  viewMode.dispatchEvent(new CustomEvent('change'))
})
class FakeViewMode extends EventTarget {
  get mode(): string { return mode }
  previous = 'hexagons'
  setMode = setMode
}
const viewMode = new FakeViewMode()
const explorerReplace = vi.fn((next: string[]) => { segments = [...next] })
class FakeLineage extends EventTarget {
  explorerSegments = (): string[] => segments
  explorerReplace = explorerReplace
}

const registered = new Map<string, unknown>()
const services = new Map<string, unknown>([
  ['@hypercomb.social/ViewMode', viewMode],
  ['@hypercomb.social/Lineage', new FakeLineage()],
  // No hypercombRoot: #reconcile stands down, which isolates the gesture.
  ['@hypercomb.social/Store', {}],
  // Records the view's way out; never listens, so nothing here answers a press.
  ['@diamondcoreprocessor.com/BackGesture', {
    register: (entry: BackEntry) => { backEntry = entry; return () => { if (backEntry === entry) backEntry = null } },
  }],
])
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => services.get(key) ?? registered.get(key),
  whenReady: () => {},
}

const { EffectBus, I18N_IOC_KEY } = await import('@hypercomb/core')
// A provider that knows none of the keys echoes them back — the menu must
// show its English, never `site-menu.back`.
services.set(I18N_IOC_KEY, { t: (key: string) => key })
const { SITE_MENU_ID } = await import('./site-context-menu.js')
await import('./site-view.drone.js')
const drone = registered.get('@diamondcoreprocessor.com/SiteViewDrone') as { pulse(g: string): Promise<void> }
await drone.pulse('')

const menuRows = (): string[] => Array.from(document.getElementById(SITE_MENU_ID)?.shadowRoot
  ?.querySelectorAll('[role="menuitem"]') ?? []).map(row => row.textContent ?? '')
const row = (label: string): HTMLButtonElement => Array.from(document.getElementById(SITE_MENU_ID)!.shadowRoot!
  .querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(r => r.textContent?.includes(label))!

const rightClick = (target: Element = document.body, init: MouseEventInit & { pointerType?: string } = {}): boolean => {
  const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40, pointerType: 'mouse', ...init })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  delete (globalThis as { __hcLastPress?: unknown }).__hcLastPress
  // The visitor shell's own mark (index.visitor.html): a published door.
  document.documentElement.dataset['hypercombMode'] = 'visitor'
  segments = ['site']
  if (mode !== 'website') setMode('website')
  setMode.mockClear()
  explorerReplace.mockClear()
})
afterEach(() => {
  document.getElementById(SITE_MENU_ID)?.remove()
  delete document.documentElement.dataset['hypercombMode']
})

describe('the home domain right-click', () => {
  beforeEach(() => { delete document.documentElement.dataset['hypercombMode'] })

  it('opens no menu and leaves the press to the back gesture', () => {
    expect(rightClick()).toBe(false)
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
    expect(setMode).not.toHaveBeenCalled()
    expect(explorerReplace).not.toHaveBeenCalled()
  })

  it('opens no menu below the site floor either — back is not Up one level', () => {
    segments = ['site', 'about']
    expect(rightClick()).toBe(false)
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
    expect(explorerReplace).not.toHaveBeenCalled()
  })

  it('registers the way out the exit button takes', () => {
    expect(backEntry?.owner).toBe('site-view')
    expect(backEntry?.active?.()).toBe(true)
    backEntry?.back()
    expect(setMode).toHaveBeenCalledWith('hexagons')
  })

  it('stands that way out down on a published door', () => {
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(backEntry?.active?.()).toBe(false)
  })

  it('stands that way out down in the hexagons — it never answers their right-click', () => {
    setMode('hexagons')
    expect(backEntry?.active?.()).toBe(false)
  })
})

describe('the website right-click on a published door', () => {
  it('opens the menu and changes nothing — at the floor there is no trap door', () => {
    expect(rightClick()).toBe(true)
    expect(menuRows().some(r => r.includes('Hexagon view'))).toBe(true)
    expect(menuRows().some(r => r.includes('Copy page link'))).toBe(true)
    expect(menuRows().some(r => r.includes('Up one level'))).toBe(false)
    expect(setMode).not.toHaveBeenCalled()
    expect(explorerReplace).not.toHaveBeenCalled()
  })

  it('offers Up one level below the floor, and it walks up one level', async () => {
    segments = ['site', 'about']
    rightClick()
    row('Up one level').click()
    await vi.waitFor(() => expect(explorerReplace).toHaveBeenCalledWith(['site']))
    expect(setMode).not.toHaveBeenCalled()
  })

  it('goes to the hexagons only when Hexagon view is chosen', () => {
    rightClick()
    expect(setMode).not.toHaveBeenCalled()
    row('Hexagon view').click()
    expect(setMode).toHaveBeenCalledWith('hexagons')
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
  })

  it('leaves a held finger and an editable field to the browser', () => {
    expect(rightClick(document.body, { pointerType: 'touch' })).toBe(false)
    const field = document.body.appendChild(document.createElement('input'))
    expect(rightClick(field)).toBe(false)
    field.remove()
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
    expect(setMode).not.toHaveBeenCalled()
  })

  it('keeps a field inside a seated part the browser’s, through its shadow root', () => {
    const part = document.body.appendChild(document.createElement('div'))
    const field = part.attachShadow({ mode: 'open' }).appendChild(document.createElement('input'))
    expect(rightClick(field, { composed: true })).toBe(false)
    part.remove()
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
  })

  it('hides the browser’s link menu from a long-press on an in-site link, not an outside one', () => {
    const inSite = document.body.appendChild(document.createElement('a'))
    inSite.setAttribute('href', '/about')
    const outside = document.body.appendChild(document.createElement('a'))
    outside.setAttribute('href', 'https://hypercomb.com/')
    expect(rightClick(inSite, { pointerType: 'touch' })).toBe(true)
    expect(rightClick(outside, { pointerType: 'touch' })).toBe(false)
    inSite.remove()
    outside.remove()
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
  })

  it('names the hexagons row without a key — H is the plain exit, not this row', () => {
    rightClick()
    expect(row('Hexagon view').textContent).toBe('Hexagon view')
  })

  describe('Open in my hive', () => {
    const pubkey = 'a'.repeat(64)
    afterEach(() => {
      EffectBus.emit('preview:mode', { active: false })
      vi.restoreAllMocks()
    })

    it('opens the visitor door for the page the reader stands on, in a tab of its own', () => {
      EffectBus.emit('preview:mode', { active: true, segments: ['site'], pubkey, hosts: ['host.example'] })
      segments = ['site', 'about']
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      rightClick()
      row('Open in my hive').click()
      expect(open).toHaveBeenCalledWith(
        `https://hypercomb.io/?hive=${pubkey}&on=host.example&of=site&at=about`, '_blank', 'noopener')
      expect(setMode).not.toHaveBeenCalled()
      expect(explorerReplace).not.toHaveBeenCalled()
    })

    it('is no row where no published creation is named', () => {
      rightClick()
      expect(menuRows().some(r => r.includes('Open in my hive'))).toBe(false)
    })
  })

  it('leaves a right-click the page answered itself to the page', () => {
    const canvas = document.body.appendChild(document.createElement('canvas'))
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    rightClick(canvas)
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
    expect(explorerReplace).not.toHaveBeenCalled()
    canvas.remove()
  })

  it('changes nothing for a right-click on the menu itself', () => {
    rightClick()
    const host = document.getElementById(SITE_MENU_ID)!
    const where = [host.style.left, host.style.top]
    expect(rightClick(row('Copy page link'), { composed: true, clientX: 200, clientY: 200 })).toBe(true)
    expect(document.getElementById(SITE_MENU_ID)).toBe(host)
    expect([host.style.left, host.style.top]).toEqual(where)
  })

  it('opens from the Menu key in the middle of the screen, not the corner', () => {
    rightClick(document.body, { button: -1, clientX: 1, clientY: 1 })
    const host = document.getElementById(SITE_MENU_ID)!
    expect(parseFloat(host.style.left)).toBeGreaterThan(8)
    expect(parseFloat(host.style.top)).toBeGreaterThan(8)
  })

  it('stays up for a lineage change that leaves the page where it was', () => {
    rightClick()
    const lineage = services.get('@hypercomb.social/Lineage') as EventTarget
    lineage.dispatchEvent(new CustomEvent('change'))
    expect(document.getElementById(SITE_MENU_ID)).not.toBeNull()
    segments = ['site', 'elsewhere']
    lineage.dispatchEvent(new CustomEvent('change'))
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
  })

  it('stays out of the hexagons — their right-click is their own', () => {
    setMode('hexagons')
    setMode.mockClear()
    expect(rightClick()).toBe(false)
    expect(document.getElementById(SITE_MENU_ID)).toBeNull()
  })
})

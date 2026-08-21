// Right-click = come back out. This pins the LADDER (hovered scope → open
// view → page-covering mode → the lineage) and the two carve-outs the browser
// keeps, because every one of them is a rule a future surface will otherwise
// re-decide for itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackGesture as BackGestureType } from './back-gesture.service.js'

type Registry = { new (): BackGestureType }

/** Every instance binds a window listener; a leaked one from a previous test
 *  would claim the event first and the test under it would see nothing. */
const live: BackGestureType[] = []
const stand = (): BackGestureType => {
  const gesture = new BackGesture()
  live.push(gesture)
  return gesture
}

let BackGesture: Registry
let viewOwners: string[] = []
let navigationBack: ReturnType<typeof vi.fn>
let segments: string[] = []

beforeEach(async () => {
  viewOwners = []
  segments = ['a', 'b']
  navigationBack = vi.fn()
  const services: Record<string, unknown> = {
    '@diamondcoreprocessor.com/ModeRegistry': {
      ownersOf: (mode: string) => (mode === 'view:active' ? viewOwners : []),
    },
    '@hypercomb.social/Lineage': { explorerSegments: () => segments },
    '@hypercomb.social/Navigation': { back: navigationBack },
  }
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services[key],
    // The module registers its own singleton on import, and that singleton is
    // listening on the same window as the instances below. Catch it here and
    // stand it down, or it answers every event first and the instance under
    // test never sees one.
    register: (_key: string, value: unknown) => { live.push(value as BackGestureType) },
  }
  document.body.innerHTML = ''
  BackGesture = (await import('./back-gesture.service.js')).BackGesture as unknown as Registry
  while (live.length) live.pop()?.dispose()
})

afterEach(() => {
  while (live.length) live.pop()?.dispose()
  vi.restoreAllMocks()
})

/** Dispatch a real contextmenu on `target` and report what the shell did. */
const rightClick = (target: Element, init: MouseEventInit = {}): boolean => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

const el = (tag = 'div', parent: Element = document.body): Element => {
  const node = document.createElement(tag)
  parent.appendChild(node)
  return node
}

describe('back gesture', () => {
  it('walks the lineage back when nothing is registered', () => {
    stand()
    expect(rightClick(el())).toBe(true)
    expect(navigationBack).toHaveBeenCalledOnce()
  })

  it('leaves the hive root alone — nothing to come back from', () => {
    segments = []
    stand()
    rightClick(el())
    expect(navigationBack).not.toHaveBeenCalled()
  })

  it('gives editable fields and selected text back to the browser', () => {
    stand()
    const input = el('input')
    expect(rightClick(input)).toBe(false)

    const text = el('p')
    text.textContent = 'a note'
    const selection = { isCollapsed: false, toString: () => 'a note', anchorNode: text }
    vi.spyOn(globalThis, 'getSelection').mockReturnValue(selection as unknown as Selection)
    expect(rightClick(text)).toBe(false)
    expect(navigationBack).not.toHaveBeenCalled()
  })

  it('stands down when a surface closer to the event already answered', () => {
    stand()
    const target = el()
    target.addEventListener('contextmenu', e => e.preventDefault(), true)
    rightClick(target)
    expect(navigationBack).not.toHaveBeenCalled()
  })

  it('asks the TOP open view, not the first one registered', () => {
    const gesture = stand()
    const under = vi.fn()
    const over = vi.fn()
    gesture.register({ owner: 'site-view', back: under })
    gesture.register({ owner: 'photo', back: over })
    viewOwners = ['site-view', 'photo']

    rightClick(el())
    expect(over).toHaveBeenCalledOnce()
    expect(under).not.toHaveBeenCalled()
    expect(navigationBack).not.toHaveBeenCalled()
  })

  it('prefers the INNERMOST hovered scope over the open view', () => {
    const gesture = stand()
    const outer = el()
    const inner = el('div', outer)
    const outerBack = vi.fn()
    const innerBack = vi.fn()
    const viewBack = vi.fn()
    gesture.register({ owner: 'outer-panel', back: outerBack, within: () => outer })
    gesture.register({ owner: 'inner-panel', back: innerBack, within: () => inner })
    gesture.register({ owner: 'site-view', back: viewBack })
    viewOwners = ['site-view']

    rightClick(inner)
    expect(innerBack).toHaveBeenCalledOnce()
    expect(outerBack).not.toHaveBeenCalled()
    expect(viewBack).not.toHaveBeenCalled()
  })

  it('answers a page-covering mode that is not a view, only while it is live', () => {
    const gesture = stand()
    let open = false
    const close = vi.fn()
    gesture.register({ owner: 'clipboard-mode', back: close, active: () => open })

    rightClick(el())
    expect(close).not.toHaveBeenCalled()
    expect(navigationBack).toHaveBeenCalledOnce()

    open = true
    rightClick(el())
    expect(close).toHaveBeenCalledOnce()
    expect(navigationBack).toHaveBeenCalledOnce()   // the lineage stayed put
  })

  it('drops an entry once its surface unregisters', () => {
    const gesture = stand()
    const back = vi.fn()
    const off = gesture.register({ owner: 'welcome-view', back })
    viewOwners = ['welcome-view']
    off()

    rightClick(el())
    expect(back).not.toHaveBeenCalled()
    expect(navigationBack).toHaveBeenCalledOnce()
  })
})

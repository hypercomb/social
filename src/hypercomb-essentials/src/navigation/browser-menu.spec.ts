// browser-menu.spec.ts — which press sent a `contextmenu`, in every dialect a
// browser speaks. A long-press is a finger (or a pen tip) held still; the
// mouse's right button and a pen's barrel button are the right button.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserKeepsMenu, isLongPressMenu, watchPresses } from './browser-menu.js'

const press = (pointerType: string, button = 0): void => {
  window.dispatchEvent(new PointerEvent('pointerdown', { pointerType, button, pointerId: 3, isPrimary: true }))
}
const lift = (): void => { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 })) }
const menu = (init: PointerEventInit = {}): MouseEvent =>
  new PointerEvent('contextmenu', { cancelable: true, button: 2, ...init })

beforeEach(() => {
  delete (globalThis as { __hcLastPress?: unknown }).__hcLastPress
  watchPresses()
})
afterEach(() => { vi.restoreAllMocks() })

describe('isLongPressMenu', () => {
  it('reads the pointer the event names', () => {
    expect(isLongPressMenu(menu({ pointerType: 'touch' }))).toBe(true)
    expect(isLongPressMenu(menu({ pointerType: 'mouse' }))).toBe(false)
  })

  it('tells a pen tip held still from the pen barrel button', () => {
    press('pen', 0)
    expect(isLongPressMenu(menu({ pointerType: 'pen' }))).toBe(true)
    press('pen', 2)
    expect(isLongPressMenu(menu({ pointerType: 'pen' }))).toBe(false)
  })

  it('reads Chromium and Firefox flags on an event with no pointer type', () => {
    const chromium = new MouseEvent('contextmenu')
    Object.defineProperty(chromium, 'sourceCapabilities', { value: { firesTouchEvents: true } })
    expect(isLongPressMenu(chromium)).toBe(true)
    const firefox = new MouseEvent('contextmenu')
    Object.defineProperty(firefox, 'mozInputSource', { value: 5 })
    expect(isLongPressMenu(firefox)).toBe(true)
  })

  it('falls back to the last press — a finger down, or lifted under a second ago', () => {
    const plain = (): MouseEvent => new MouseEvent('contextmenu')
    expect(isLongPressMenu(plain())).toBe(false)
    press('touch')
    expect(isLongPressMenu(plain())).toBe(true)
    const now = performance.now()
    lift()
    expect(isLongPressMenu(plain())).toBe(true)
    vi.spyOn(performance, 'now').mockReturnValue(now + 5000)
    expect(isLongPressMenu(plain())).toBe(false)
  })

  it('never reads a mouse press as a hold', () => {
    press('mouse', 2)
    expect(isLongPressMenu(new MouseEvent('contextmenu'))).toBe(false)
  })
})

describe('browserKeepsMenu', () => {
  it('keeps editable fields, not plain page', () => {
    const input = document.body.appendChild(document.createElement('input'))
    const box = document.body.appendChild(document.createElement('div'))
    expect(browserKeepsMenu(input)).toBe(true)
    expect(browserKeepsMenu(box)).toBe(false)
  })

  it('keeps a selection that starts in one element and runs across another', () => {
    const first = document.body.appendChild(document.createElement('p'))
    first.textContent = 'one'
    const second = document.body.appendChild(document.createElement('p'))
    second.textContent = 'two'
    const range = document.createRange()
    range.setStart(first.firstChild!, 0)
    range.setEnd(second.firstChild!, 3)
    const selection = getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(browserKeepsMenu(second)).toBe(true)
    selection.removeAllRanges()
    expect(browserKeepsMenu(second)).toBe(false)
  })
})

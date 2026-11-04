// navigation/zoom/wheel-gesture.spec.ts — ONE DECISION PER GESTURE.

import { describe, expect, it, vi } from 'vitest'
import { WHEEL_GESTURE_GAP_MS, WheelGestureOwner } from './wheel-gesture.js'

const wheel = (target: EventTarget, path: EventTarget[] = [target]): WheelEvent =>
  ({ target, composedPath: () => path } as unknown as WheelEvent)

describe('the wheel gesture owner', () => {
  it('asks once for a burst over the same target', () => {
    const owner = new WheelGestureOwner()
    const canvas = document.createElement('div')
    const decide = vi.fn(() => null)
    for (let n = 0; n < 40; n++) owner.owner(wheel(canvas), decide, n * 16)
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('asks again after a pause longer than a gesture gap', () => {
    const owner = new WheelGestureOwner()
    const canvas = document.createElement('div')
    const decide = vi.fn(() => null)
    owner.owner(wheel(canvas), decide, 0)
    owner.owner(wheel(canvas), decide, WHEEL_GESTURE_GAP_MS - 1)
    expect(decide).toHaveBeenCalledTimes(1)
    owner.owner(wheel(canvas), decide, WHEEL_GESTURE_GAP_MS * 2)
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('keeps a scroll region as owner while its rows move under the pointer', () => {
    const owner = new WheelGestureOwner()
    const list = document.createElement('div')
    const rows = [document.createElement('div'), document.createElement('div'), document.createElement('div')]
    for (const row of rows) list.appendChild(row)
    const decide = vi.fn(() => list)
    expect(owner.owner(wheel(rows[0], [rows[0], list]), decide, 0)).toBe(list)
    expect(owner.owner(wheel(rows[1], [rows[1], list]), decide, 20)).toBe(list)
    expect(owner.owner(wheel(rows[2], [rows[2], list]), decide, 40)).toBe(list)
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('asks again when the pointer leaves the owner mid-gesture', () => {
    const owner = new WheelGestureOwner()
    const list = document.createElement('div')
    const canvas = document.createElement('div')
    const decide = vi.fn((event: WheelEvent) => event.target === canvas ? null : list)
    expect(owner.owner(wheel(list), decide, 0)).toBe(list)
    expect(owner.owner(wheel(canvas), decide, 20)).toBe(null)
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('asks again when the canvas gesture crosses onto something else', () => {
    const owner = new WheelGestureOwner()
    const canvas = document.createElement('div')
    const panel = document.createElement('div')
    const decide = vi.fn((event: WheelEvent) => event.target === panel ? panel : null)
    expect(owner.owner(wheel(canvas), decide, 0)).toBe(null)
    expect(owner.owner(wheel(canvas), decide, 20)).toBe(null)
    expect(owner.owner(wheel(panel), decide, 40)).toBe(panel)
    expect(decide).toHaveBeenCalledTimes(2)
  })
})

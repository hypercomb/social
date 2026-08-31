// hypercomb-shared/ui/accordion.spec.ts
//
// The rule is one sentence — one section open at a time — and every case
// below is a way that sentence gets broken by a second signal creeping in
// beside it.

import { describe, it, expect } from 'vitest'
import { accordion } from './accordion'

describe('accordion', () => {
  it('opens nothing until asked', () => {
    const a = accordion()
    expect(a.open()).toBeNull()
    expect(a.isOpen('starter')).toBe(false)
  })

  it('opening one closes the other', () => {
    const a = accordion()
    a.toggle('starter')
    expect(a.isOpen('starter')).toBe(true)

    a.toggle('expert')
    expect(a.isOpen('expert')).toBe(true)
    expect(a.isOpen('starter')).toBe(false)
    expect(a.open()).toBe('expert')
  })

  it('clicking the open one closes it, so a list can be all-closed', () => {
    const a = accordion('starter')
    a.toggle('starter')
    expect(a.open()).toBeNull()
  })

  it('reveal does not toggle — twice is still open', () => {
    const a = accordion()
    a.reveal('beginner')
    a.reveal('beginner')
    expect(a.isOpen('beginner')).toBe(true)
  })

  it('closeAll is what a window opens on', () => {
    const a = accordion('expert')
    a.closeAll()
    expect(a.open()).toBeNull()
  })

  it('dismiss consumes the press only when something was open', () => {
    const a = accordion()
    // Nothing open: the press is NOT ours, and must fall through to the next
    // rung of the cascade rather than being swallowed.
    expect(a.dismiss()).toBe(false)

    a.toggle('intermediate')
    expect(a.dismiss()).toBe(true)
    expect(a.open()).toBeNull()
    expect(a.dismiss()).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { altProvenUp } from './quick-menu.alt-held.js'

describe('altProvenUp', () => {
  it('clears a tracked Alt when the event says Alt is not held (a lost keyup)', () => {
    expect(altProvenUp(true, { altKey: false })).toBe(true)
  })

  it('keeps a tracked Alt while the event still says it is held', () => {
    expect(altProvenUp(true, { altKey: true })).toBe(false)
  })

  it('has nothing to clear when Alt was not tracked down', () => {
    expect(altProvenUp(false, { altKey: false })).toBe(false)
    expect(altProvenUp(false, { altKey: true })).toBe(false)
  })

  it('an event with no modifier state proves nothing', () => {
    expect(altProvenUp(true, {})).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { HOVER_GRACE_MS, activeOf, escapeRung, idle, lifted, litMap, litOf, reduce, tapActs, type LightEvent, type LightState } from './lit-state.js'

const run = (events: LightEvent[], from: LightState = idle()): LightState => events.reduce(reduce, from)

describe('lit-state', () => {
  it('the grace is 120ms and an input, not a timer', () => {
    expect(HOVER_GRACE_MS).toBe(120)
    const s = run([{ type: 'pointer-enter', part: 'a' }, { type: 'pointer-leave', part: 'a' }])
    expect(s.hover).toBe('a')                            // still lit across the leader gap
    expect(run([{ type: 'grace-elapsed' }], s).hover).toBeNull()
  })

  it('entering another part before the grace ends takes over; a stale grace does nothing', () => {
    const s = run([{ type: 'pointer-enter', part: 'a' }, { type: 'pointer-leave', part: 'a' }, { type: 'pointer-enter', part: 'b' }])
    expect(s.hover).toBe('b')
    expect(run([{ type: 'grace-elapsed', part: 'a' }], s).hover).toBe('b')
  })

  it('strong reads over soft', () => {
    const s = run([{ type: 'pointer-enter', part: 'a' }, { type: 'focus-in', part: 'a' }])
    expect(litOf(s, 'a')).toBe('strong')
    expect(litOf(run([{ type: 'pointer-enter', part: 'a' }]), 'a')).toBe('soft')
    expect(litOf(s, 'b')).toBeNull()
  })

  it('focus beats hover: the focused part stays strong while another is hovered', () => {
    const s = run([{ type: 'focus-in', part: 'a' }, { type: 'pointer-enter', part: 'b' }])
    expect(litOf(s, 'a')).toBe('strong')
    expect(litOf(s, 'b')).toBe('soft')
  })

  it('an open card and a pin are strong too', () => {
    expect(litOf(run([{ type: 'toggle-open', part: 'a' }]), 'a')).toBe('strong')
    expect(litOf(run([{ type: 'touch-tap', part: 'a' }]), 'a')).toBe('strong')
  })

  it('the alert tone forces strong', () => {
    expect(litOf(idle(), 'a', 'alert')).toBe('strong')
    expect(litMap(idle(), ['a', 'b'], 'b').get('b')).toBe('strong')
    expect(litMap(idle(), ['a', 'b'], 'b').has('a')).toBe(false)
  })

  it('focus-out clears only its own part', () => {
    const s = run([{ type: 'focus-in', part: 'a' }])
    expect(run([{ type: 'focus-out', part: 'b' }], s).focus).toBe('a')
    expect(run([{ type: 'focus-out', part: 'a' }], s).focus).toBeNull()
  })

  it('a tab toggles its card and closes any other; an outside click closes it', () => {
    let s = run([{ type: 'toggle-open', part: 'a' }, { type: 'toggle-open', part: 'b' }])
    expect(s.open).toBe('b')
    s = run([{ type: 'toggle-open', part: 'b' }], s)
    expect(s.open).toBeNull()
    expect(run([{ type: 'toggle-open', part: 'a' }, { type: 'outside-click' }]).open).toBeNull()
  })

  it('touch: the first tap pins, the second acts, empty ground unpins; touch enter lights nothing', () => {
    let s = run([{ type: 'touch-tap', part: 'a' }])
    expect(s.pin).toBe('a')
    expect(tapActs(s, 'a')).toBe(true)
    expect(tapActs(s, 'b')).toBe(false)
    expect(run([{ type: 'touch-tap', part: 'a' }], s).pin).toBe('a')
    s = run([{ type: 'touch-tap', part: null }], s)
    expect(s.pin).toBeNull()
    expect(run([{ type: 'pointer-enter', part: 'a', pointer: 'touch' }]).hover).toBeNull()
    expect(run([{ type: 'pointer-enter', part: 'a', pointer: 'pen' }]).hover).toBe('a')
  })

  it('escape takes one rung per press: the card, then the pin', () => {
    let s = run([{ type: 'toggle-open', part: 'a' }, { type: 'touch-tap', part: 'b' }])
    expect(escapeRung(s)).toBe('open')
    s = reduce(s, { type: 'escape' })
    expect(s.open).toBeNull()
    expect(s.pin).toBe('b')
    expect(escapeRung(s)).toBe('pin')
    s = reduce(s, { type: 'escape' })
    expect(s.pin).toBeNull()
    expect(escapeRung(s)).toBeNull()
    expect(reduce(s, { type: 'escape' })).toBe(s)
  })

  it('a gesture suspends hover', () => {
    expect(run([{ type: 'pointer-enter', part: 'a' }, { type: 'gesture-start' }]).hover).toBeNull()
  })

  it('lifts while the image part is lit or a pan is in progress', () => {
    expect(lifted(idle(), 'p', false)).toBe(false)
    expect(lifted(run([{ type: 'pointer-enter', part: 'p' }]), 'p', false)).toBe(true)
    expect(lifted(run([{ type: 'pointer-enter', part: 'q' }]), 'p', false)).toBe(false)
    expect(lifted(idle(), 'p', true)).toBe(true)
    expect(lifted(idle(), null, false)).toBe(false)
  })

  it('set patches from outside; activeOf prefers open, then focus, then pin', () => {
    const s = reduce(idle(), { type: 'set', patch: { focus: 'n' } })
    expect(s.focus).toBe('n')
    expect(activeOf(s)).toBe('n')
    expect(activeOf({ ...s, open: 'o' })).toBe('o')
  })

  it('never mutates its input', () => {
    const s = idle()
    reduce(s, { type: 'pointer-enter', part: 'a' })
    expect(s).toEqual(idle())
  })
})

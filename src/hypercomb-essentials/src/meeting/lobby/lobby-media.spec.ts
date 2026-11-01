import { describe, expect, it } from 'vitest'
import { SEATS, deviceLabel, failureOf, levelOf, seatPositions, seatsTaken } from './lobby-media.js'

describe('why a camera did not open', () => {
  it('names the four things a participant can act on', () => {
    expect(failureOf({ name: 'NotAllowedError' })).toBe('blocked')
    expect(failureOf({ name: 'SecurityError' })).toBe('blocked')
    expect(failureOf({ name: 'NotFoundError' })).toBe('missing')
    expect(failureOf({ name: 'OverconstrainedError' })).toBe('missing')
    expect(failureOf({ name: 'NotReadableError' })).toBe('busy')
    expect(failureOf({ name: 'TypeError' })).toBe('error')
  })

  it('does not throw on what is not an error', () => {
    expect(failureOf(null)).toBe('error')
    expect(failureOf(undefined)).toBe('error')
    expect(failureOf('nope')).toBe('error')
  })
})

describe('the 1+6 circle', () => {
  const seats = seatPositions(5)

  it('has the leader in the middle and six around', () => {
    expect(seats).toHaveLength(SEATS)
    expect(seats[0]).toEqual({ x: 0, y: 0 })
  })

  it('puts every neighbour one hexagon-width from the middle', () => {
    for (const seat of seats.slice(1)) expect(Math.hypot(seat.x, seat.y)).toBeCloseTo(5 * Math.sqrt(3), 6)
  })

  it('puts the ring seats one hexagon-width from each other next door', () => {
    for (let i = 1; i <= 6; i++) {
      const next = seats[(i % 6) + 1]
      expect(Math.hypot(seats[i].x - next.x, seats[i].y - next.y)).toBeCloseTo(5 * Math.sqrt(3), 6)
    }
  })

  it('fills the middle first, then round, and never past seven', () => {
    expect(seatsTaken(0).filter(Boolean)).toHaveLength(0)
    expect(seatsTaken(1)).toEqual([true, false, false, false, false, false, false])
    expect(seatsTaken(4).filter(Boolean)).toHaveLength(4)
    expect(seatsTaken(99)).toHaveLength(SEATS)
    expect(seatsTaken(99).every(Boolean)).toBe(true)
    expect(seatsTaken(-3).some(Boolean)).toBe(false)
  })
})

describe('how loud the microphone is', () => {
  it('reads silence as nothing', () => {
    expect(levelOf(new Uint8Array(256).fill(128))).toBe(0)
    expect(levelOf(new Uint8Array(0))).toBe(0)
  })

  it('moves for speech and stays within 0..1', () => {
    const quiet = Uint8Array.from({ length: 256 }, (_, i) => 128 + (i % 2 ? 6 : -6))
    const loud = Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 255 : 0))
    expect(levelOf(quiet)).toBeGreaterThan(0.1)
    expect(levelOf(quiet)).toBeLessThan(levelOf(loud))
    expect(levelOf(loud)).toBeLessThanOrEqual(1)
  })
})

describe('what a device is called', () => {
  it('uses its name when it has one', () => {
    expect(deviceLabel({ label: ' Logitech C920 ' }, 0, 'camera')).toBe('Logitech C920')
  })

  it('numbers an unnamed one, as browsers hide names until permission', () => {
    expect(deviceLabel({ label: '' }, 1, 'camera')).toBe('Camera 2')
    expect(deviceLabel({ label: '  ' }, 0, 'microphone')).toBe('Microphone 1')
  })
})

import { describe, expect, it } from 'vitest'
import {
  advanceFixed,
  advanceFixedValue,
  buildDosCollisionMasks,
  DOS_DETERMINISTIC_SEED,
  DOS_ENEMY_HIGH_JUMP,
  DOS_ENEMY_HOP,
  DOS_PLAYER_BUBBLE_BOUNCE,
  DOS_PLAYER_JUMP,
  DosRandom,
  dosVelocity,
  dosBlocksDirection,
  dosCollisionWord,
  fixedVelocityPerSecond,
  signedByte,
  signedWord,
  snapDosCoordinate,
  wrapDosY,
} from './dos-mechanics.js'

describe('NovaLogic DOS integer mechanics', () => {
  it('rebuilds the native refresh-adjusted speed table', () => {
    expect(dosVelocity(0x10)).toBe(0x100)
    expect(dosVelocity(0xf0)).toBe(-0x100)
    expect(dosVelocity(1, 70)).toBe(14)
    expect(dosVelocity(-1, 70)).toBe(-14)
    expect(signedByte(0xff)).toBe(-1)
    expect(signedWord(0xffff)).toBe(-1)
  })

  it('matches 8086 8.8 addition including negative fractional carries', () => {
    expect(advanceFixed({ pixel: 10, fraction: 0 }, 0x0180)).toEqual({ pixel: 11, fraction: 0x80 })
    expect(advanceFixed({ pixel: 11, fraction: 0x80 }, 0x0180)).toEqual({ pixel: 13, fraction: 0 })
    expect(advanceFixed({ pixel: 10, fraction: 0 }, -0x80)).toEqual({ pixel: 9, fraction: 0x80 })
    expect(advanceFixed({ pixel: 9, fraction: 0x80 }, -0x80)).toEqual({ pixel: 9, fraction: 0 })
    expect(wrapDosY(-1)).toBe(231)
    expect(wrapDosY(232)).toBe(0)
    expect(advanceFixedValue(10, 0x180)).toBe(11.5)
    expect(advanceFixedValue(10, -0x80)).toBe(9.5)
    expect(fixedVelocityPerSecond(-720)).toBe(-168.75)
  })

  it('reproduces the deterministic native LFSR word stream', () => {
    const random = new DosRandom(DOS_DETERMINISTIC_SEED)
    expect(Array.from({ length: 10 }, () => random.nextWord())).toEqual([
      0xe1e5, 0x70f2, 0x8c78, 0xf23b, 0x791d,
      0x3c8e, 0xaa46, 0xe122, 0xc490, 0xd647,
    ])
    expect(random.state).toBe(0xd648)
  })

  it('retains the four native 60 Hz vertical tuning pairs', () => {
    expect(DOS_PLAYER_JUMP).toEqual({ impulse: -720, acceleration: 24 })
    expect(DOS_PLAYER_BUBBLE_BOUNCE).toEqual({ impulse: -416, acceleration: 18 })
    expect(DOS_ENEMY_HIGH_JUMP).toEqual({ impulse: -1280, acceleration: 80 })
    expect(DOS_ENEMY_HOP).toEqual({ impulse: -384, acceleration: 20 })
  })

  it('packs native terrain neighborhoods and applies directional contact flags', () => {
    const cells = Array.from({ length: 25 }, (_, row) => Array.from({ length: 40 }, (_cell, column) =>
      column < 2 || column >= 30 || row === 24 ? 1 : 0))
    const masks = buildDosCollisionMasks(cells)
    expect(masks).toHaveLength(0x3c0)
    // The native mover's y coordinate includes the two guard rows. A body at
    // y=192 has its lower probes against visible terrain row 24.
    const floor = dosCollisionWord(masks, 193, 64)
    expect(dosBlocksDirection(floor, 'down')).toBe(true)
    expect(dosBlocksDirection(floor, 'up')).toBe(false)
    const wall = dosCollisionWord(masks, 184, 55)
    expect(dosBlocksDirection(wall, 'left')).toBe(true)
    expect(snapDosCoordinate(55.75, -0x100)).toBe(56)
    expect(snapDosCoordinate(193.25, 0x100)).toBe(192)
  })
})

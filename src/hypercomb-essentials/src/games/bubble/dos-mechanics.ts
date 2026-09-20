/**
 * Integer primitives recovered from the NovaLogic DOS executable.
 *
 * These functions intentionally retain the original 16-bit behaviour. They
 * are the deterministic foundation for the higher-level TypeScript actors;
 * no downloaded program code is loaded or executed at runtime.
 */

export const DOS_TICK_RATE = 60
export const DOS_TICK_SECONDS = 1 / DOS_TICK_RATE
export const DOS_FIXED_ONE = 0x100
export const DOS_DETERMINISTIC_SEED = 0xabcd

/** Coerce a JavaScript number to the signed 16-bit value the 8086 observes. */
export function signedWord(value: number): number {
  const word = value & 0xffff
  return word & 0x8000 ? word - 0x10000 : word
}

/** Coerce a JavaScript number to the signed 8-bit value the 8086 observes. */
export function signedByte(value: number): number {
  const byte = value & 0xff
  return byte & 0x80 ? byte - 0x100 : byte
}

/**
 * Rebuild one entry in the native speed table initialized at CS:0775.
 * Speed codes are sixteenths of a pixel per nominal 60 Hz tick. The original
 * rounds up after adapting them to the measured display refresh rate.
 */
export function dosVelocity(speedCode: number, refreshRate = DOS_TICK_RATE): number {
  if (!Number.isInteger(refreshRate) || refreshRate <= 0) throw new Error('DOS refresh rate must be positive')
  const speed = signedByte(speedCode)
  const magnitude = Math.ceil(Math.abs(speed) * 16 * DOS_TICK_RATE / refreshRate)
  return signedWord(speed < 0 ? -magnitude : magnitude)
}

export interface FixedCoordinate {
  pixel: number
  fraction: number
}

/**
 * Apply an 8.8 fixed-point velocity exactly as CS:1C52/CS:1C87 do: add the
 * low byte into the actor's fractional byte, then add the signed high byte
 * plus the resulting carry into the integer coordinate.
 */
export function advanceFixed(coordinate: FixedCoordinate, velocity: number): FixedCoordinate {
  const word = velocity & 0xffff
  const fractionTotal = (coordinate.fraction & 0xff) + (word & 0xff)
  return {
    pixel: coordinate.pixel + signedByte(word >>> 8) + (fractionTotal > 0xff ? 1 : 0),
    fraction: fractionTotal & 0xff,
  }
}

/** Apply one native 8.8 velocity to a JavaScript coordinate while retaining
 * the DOS integer/fraction split. The result is always exactly representable
 * as a multiple of 1/256; rounding only normalizes externally-authored input. */
export function advanceFixedValue(position: number, velocity: number): number {
  if (!Number.isFinite(position)) throw new Error('DOS coordinate must be finite')
  const fixed = Math.round(position * DOS_FIXED_ONE)
  const coordinate = {
    pixel: Math.floor(fixed / DOS_FIXED_ONE),
    fraction: fixed & 0xff,
  }
  const next = advanceFixed(coordinate, velocity)
  return next.pixel + next.fraction / DOS_FIXED_ONE
}

/** Convert a native 8.8-per-tick velocity to the engine's pixels/second view. */
export function fixedVelocityPerSecond(velocity: number): number {
  return signedWord(velocity) * DOS_TICK_RATE / DOS_FIXED_ONE
}

const COLLISION_COLUMNS = 32
const COLLISION_MASK_CELLS = 0x3c0

/** CS:2537/25A6: the compacted DS:3690 surface, including seam guard rows.
 * Direct item predicates at CS:1E63/1D24 read these cells, not the masks. */
export function buildDosCollisionCells(nativeCells: readonly (readonly number[])[]): Uint8Array {
  if (nativeCells.length !== 25 || nativeCells.some(row => row.length !== 40)) {
    throw new Error('DOS collision input must be a 25 by 40 native workspace')
  }
  // Addresses are relative to native DS:3128, the first byte touched by the
  // wrap extender. Keeping those offsets makes the overlapping copies exact.
  const memory = new Uint8Array(0x540)
  const original = 0xa0 // DS:31C8 - DS:3128
  nativeCells.forEach((row, index) => memory.set(row, original + index * 40))

  let source = 0xa0, destination = 0x79
  for (let count = 0; count < 40; count++) {
    let low = (memory[source] ^ 1) | 0xfe
    source++
    const high = low & memory[source - 2]
    memory[destination - 2] |= high
    low &= memory[source]
    memory[destination++] = low
  }
  source = 0x9e; destination = 0x76
  memory[destination + 2] = 3; memory[destination + 3] = 3
  memory[destination + 0x20] = 7; memory[destination + 0x21] = 7
  for (let count = 0; count < 60; count++) {
    memory[destination] = memory[source]
    memory[destination + 1] = memory[source + 1]
    source -= 2; destination -= 2
  }

  source = 0x460; destination = 0x489
  for (let count = 0; count < 40; count++) {
    let low = (memory[source] ^ 1) | 0xfe
    source++
    const high = low & memory[source - 2]
    memory[destination - 2] |= high
    low &= memory[source]
    memory[destination++] = low
  }
  memory[source] = 3; memory[source + 1] = 3
  memory[source + 0x1e] = 7; memory[source + 0x1f] = 7
  destination = 0x4b0
  for (let count = 0; count < 60; count++) {
    memory[destination] = memory[source]
    memory[destination + 1] = memory[source + 1]
    source += 2; destination += 2
  }

  const contiguous = new Uint8Array(33 * COLLISION_COLUMNS)
  source = 0
  for (let row = 0; row < 33; row++) {
    contiguous.set(memory.subarray(source, source + COLLISION_COLUMNS), row * COLLISION_COLUMNS)
    source += 40
  }
  // Native DS:3690 begins two rows into the contiguous buffer. The mask loop
  // reads one row beyond its 30 outputs, hence the 31-row source slice.
  return contiguous.subarray(2 * COLLISION_COLUMNS)
}

/** CS:25BF: pack the compacted surface into actor directional masks. */
export function buildDosCollisionMasks(nativeCells: readonly (readonly number[])[]): Uint8Array {
  const cells = buildDosCollisionCells(nativeCells)
  const masks = new Uint8Array(COLLISION_MASK_CELLS)
  masks[COLLISION_MASK_CELLS - 1] = 0x77
  for (let index = COLLISION_MASK_CELLS - 2; index >= 0; index--) {
    let mask = (masks[index + 1] >>> 1) & 0x33
    if (cells[index] & 1) mask |= 0x40
    if (cells[index + COLLISION_COLUMNS] & 1) mask |= 0x04
    masks[index] = mask
  }
  return masks
}

export type DosCollisionDirection = 'up' | 'down' | 'left' | 'right'

/** CS:1ED1: collect the two collision bytes around one native actor origin. */
export function dosCollisionWord(masks: Uint8Array, y: number, x: number): number {
  if (masks.length !== COLLISION_MASK_CELLS) throw new Error('Invalid DOS collision-mask table')
  const integerY = Math.floor(y)
  const clampedY = integerY < 8 || integerY > 0xd8 ? 0xd8 : integerY
  const relativeX = Math.floor(x) - 0x28
  const index = ((clampedY << 2) & 0xffe0) + Math.floor(relativeX / 8)
  let high = masks[index] ?? 0
  let low = masks[index + 0x40] ?? 0
  if (integerY & 7) high |= 0x88
  if (relativeX & 7) low |= 0x88
  return (high << 8) | low
}

/** CS:1FA4, 1FC9, 2011 and 2023: directional contact predicates. */
export function dosBlocksDirection(word: number, direction: DosCollisionDirection): boolean {
  const high = (word >>> 8) & 0xff
  const low = word & 0xff
  if (direction === 'up') {
    if (high & 0x60) return true
    if ((low & 0x80) && (high & 0x10)) return true
    if (!(high & 0x80)) return false
    if (high & 0x06) return true
    return !!((low & 0x80) && (high & 0x01))
  }
  if (direction === 'down') {
    if (high & 0x80) {
      if (low & 0x60) return true
      return !!((low & 0x80) && (low & 0x10))
    }
    if (high & 0x06) return true
    return !!((low & 0x80) && (high & 0x01))
  }
  if (direction === 'left') {
    return !!(high & 0x44) || !!((high & 0x80) && (low & 0x40))
  }
  if (low & 0x80) {
    return !!(high & 0x22) || !!((high & 0x80) && (low & 0x20))
  }
  return !!(high & 0x11) || !!((high & 0x80) && (low & 0x10))
}

/** CS:1E9B/1EB6: discard the fractional byte and snap out of contact. */
export function snapDosCoordinate(position: number, velocity: number): number {
  const aligned = Math.floor(position) & ~7
  return velocity < 0 ? aligned + 8 : aligned
}

/** The vertical actor coordinate wraps over the native 232-pixel field. */
export function wrapDosY(pixel: number): number {
  if (pixel < 0) return pixel + 0xe8
  if (pixel >= 0xe8) return pixel - 0xe8
  return pixel
}

/**
 * NovaLogic's 16-bit right-shifting LFSR at CS:12DF.
 * nextWord() returns AX (state - 1), while state exposes the stored word.
 */
export class DosRandom {
  #state: number

  constructor(seed = DOS_DETERMINISTIC_SEED) {
    this.#state = seed & 0xffff
  }

  get state(): number { return this.#state }

  set state(seed: number) { this.#state = seed & 0xffff }

  nextWord(): number {
    const carry = this.#state & 1
    this.#state >>>= 1
    if (carry) this.#state ^= 0xb400
    this.#state &= 0xffff
    return (this.#state - 1) & 0xffff
  }

  /** Equivalent to the parity/carry helper at CS:1326. */
  nextHalf(): boolean {
    let lowByte = this.nextWord() & 0xff
    let ones = 0
    while (lowByte) { ones ^= lowByte & 1; lowByte >>>= 1 }
    return ones === 0
  }

  /** Equivalent to CS:1326, 132F, 1338...: every parity trial must carry. */
  nextPowerOfTwo(power: number): boolean {
    if (!Number.isInteger(power) || power < 1) throw new Error('DOS probability power must be a positive integer')
    for (let trial = 0; trial < power; trial++) if (!this.nextHalf()) return false
    return true
  }

  /** Equivalent to CS:12FA; callers treat zero as their selected outcome. */
  nextModulo(divisor: number): number {
    if (!Number.isInteger(divisor) || divisor < 1 || divisor > 0xff) {
      throw new Error('DOS byte random divisor must be from 1 through 255')
    }
    let word = this.nextWord()
    if ((word >>> 8) >= divisor) word &= 0x00ff
    return word % divisor
  }

  /** Adapter for effects that have not yet been expressed as native branches. */
  nextUnit(): number { return this.nextWord() / 0x10000 }
}

/** Native 60 Hz tuning tables selected for a measured 55-64 Hz display. */
export const DOS_PLAYER_JUMP = Object.freeze({ impulse: -720, acceleration: 24 })
export const DOS_PLAYER_BUBBLE_BOUNCE = Object.freeze({ impulse: -416, acceleration: 18 })
export const DOS_ENEMY_HIGH_JUMP = Object.freeze({ impulse: -1280, acceleration: 80 })
export const DOS_ENEMY_HOP = Object.freeze({ impulse: -384, acceleration: 20 })

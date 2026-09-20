/** Bounded ordinary-pop collectible path from CS:BC41..BE21/BEC2.
 * Clocks are inputs because the DOS general clock (011E) and work clock
 * (001C) are separate producers. This module does not simulate the PIT. */

import {
  advanceFixedValue, dosBlocksDirection, dosCollisionWord, wrapDosY,
} from './dos-mechanics.js'

export type DosFruitPhase = 'falling' | 'timed' | 'expiring' | 'pickup' | 'score'
export interface DosOrdinaryFruit {
  kind: number
  points: number
  /** Native actor origin: screen x and collision-space y (screen y + 16). */
  x: number
  y: number
  phase: DosFruitPhase
  deadline: number
  display: number
  /** BC41 runs inside the defeated actor's pass; BC6B starts next pass. */
  fresh: boolean
}
export interface DosFruitClocks { generalTick: number; workTick: number }
export interface DosFruitPlayer { x: number; y: number; w: number; h: number }
export interface DosFruitEnvironment {
  cells: Uint8Array
  masks: Uint8Array
  player: DosFruitPlayer | null
  /** DS:0034 gate at BD72; the fixed-60 browser adapter supplies true. */
  pickupEnabled: boolean
}
export interface DosFruitStep { collected: number; removed: boolean }

const ORDINARY_POINTS = new Map<number, number>([
  [0x12, 500], [0x10, 1_000], [0x11, 2_000], [0x14, 4_000],
  [0x46, 8_000], [0x47, 16_000], [0x50, 6_000],
])
const ORDINARY_DISPLAY = new Map<number, number>([
  [0x12, 0xc1], [0x10, 0xc0], [0x11, 0xcd], [0x14, 0xde],
  [0x46, 0xe8], [0x47, 0xe7], [0x50, 0xd5],
])
const TIMED_DURATION = 0x258 // BBB4 CL=1 -> BC41 -> BCAA selector 1.
const SCORE_DURATION = 0x5a
const u16 = (value: number): number => value & 0xffff
// BD0F/BD3F/BEC2 use raw unsigned CMP/Jcc, not wrap-safe elapsed arithmetic.
const u16AtOrAfter = (now: number, deadline: number): boolean => u16(now) >= u16(deadline)
const u16Past = (now: number, deadline: number): boolean => u16(now) > u16(deadline)

/** BC41/1F44 aligns/clamps x but retains the defeated actor's y. */
export function createDosOrdinaryFruit(x: number, nativeY: number, kind: number): DosOrdinaryFruit {
  const points = ORDINARY_POINTS.get(kind)
  if (points === undefined) throw new Error(`Unverified ordinary item ID: ${kind}`)
  return {
    kind, points, x: Math.min(0x110, Math.max(0x38, Math.floor(x) & ~7)),
    y: nativeY, phase: 'falling', deadline: 0, display: 0x51, fresh: true,
  }
}

/** CS:1E63/1D24 read raw occupancy at two or three adjacent DS:3690 cells. */
export function dosFruitFootprint(cells: Uint8Array, x: number, nativeY: number, yOffset: 15 | 16): boolean {
  if (yOffset === 16 && (nativeY < 0x10 || nativeY >= 0xd8)) return false
  const row = Math.floor((Math.floor(nativeY) + yOffset) / 8)
  const column = Math.floor((Math.floor(x) - 0x28) / 8)
  const index = row * 32 + column
  let occupancy = (cells[index] ?? 0) | (cells[index + 1] ?? 0)
  if ((Math.floor(x) - 0x28) & 7) occupancy |= cells[index + 2] ?? 0
  return !!(occupancy & 1)
}

function playerTouchesFruit(state: DosOrdinaryFruit, player: DosFruitPlayer | null): boolean {
  if (!player) return false
  // BDC0 uses inclusive actor rectangles (1B85). The browser's current
  // 16-pixel item/player boxes are a presentation-size adapter; exact sprite
  // descriptor dimensions are a separate evidence gap.
  const y = state.y - 16
  return state.x <= player.x + player.w - 1 && state.x + 15 >= player.x
    && y <= player.y + player.h - 1 && y + 15 >= player.y
}

function stepDown(state: DosOrdinaryFruit, masks: Uint8Array): boolean {
  // 1D14 substitutes speed-table code +10h, calls 1C52, then restores vy.
  // At the fixed-60 baseline that is +0100h, one pixel per invocation.
  state.y = wrapDosY(advanceFixedValue(state.y, 0x100))
  return dosBlocksDirection(dosCollisionWord(masks, Math.floor(state.y), state.x), 'down')
}

/** Advance one ordinary fruit procedure invocation with independently supplied clocks. */
export function stepDosOrdinaryFruit(
  state: DosOrdinaryFruit, clocks: DosFruitClocks, env: DosFruitEnvironment,
): DosFruitStep {
  if (state.fresh) {
    state.fresh = false
    return { collected: 0, removed: false }
  }
  const generalTick = u16(clocks.generalTick)
  const workTick = u16(clocks.workTick)
  if (state.phase === 'falling') {
    if (state.y < 0x10 || dosFruitFootprint(env.cells, state.x, state.y, 15)) {
      stepDown(state, env.masks)
    } else if (dosFruitFootprint(env.cells, state.x, state.y, 16)) {
      // 1CEB clear -> BC7D -> BCAA. Ordinary CL=1 selects 0258h.
      state.phase = 'timed'
      state.deadline = (workTick + TIMED_DURATION) & 0xffff
      state.display = ORDINARY_DISPLAY.get(state.kind)!
    } else if (stepDown(state, env.masks)) {
      // Only the 1CFC branch clears fraction and aligns y on a contact carry.
      state.y = Math.floor(state.y) & ~7
    }
    return { collected: 0, removed: false }
  }
  if (state.phase === 'timed') {
    // BD0F gives player overlap priority over the work-clock expiry test.
    if (playerTouchesFruit(state, env.player)) {
      state.phase = 'pickup'
    } else if (u16AtOrAfter(workTick, state.deadline)) {
      state.phase = 'expiring'
    }
    return { collected: 0, removed: false }
  }
  if (state.phase === 'expiring') {
    if (u16AtOrAfter(workTick, state.deadline)) {
      state.deadline = (workTick + 6) & 0xffff
      state.display = Math.max(state.display, 0x10e) + 1
      if (state.display >= 0x112) return { collected: 0, removed: true }
    }
    return { collected: 0, removed: false }
  }
  if (state.phase === 'pickup') {
    if (!env.pickupEnabled) return { collected: 0, removed: false }
    // BD72 -> ordinary score handler -> BE21. Score is credited once; the
    // score-display actor persists until a separate 011E deadline.
    state.phase = 'score'
    state.deadline = (generalTick + SCORE_DURATION) & 0xffff
    return { collected: state.points, removed: false }
  }
  // BEC2 moves by signed speed code -08h and deletes only when deadline < now.
  state.y = wrapDosY(advanceFixedValue(state.y, -0x80))
  return { collected: 0, removed: u16Past(generalTick, state.deadline) }
}

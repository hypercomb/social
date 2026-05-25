// diamondcoreprocessor.com/presentation/grid/center-slot-tracker.ts
//
// CenterSlotTracker — passively maintains the viewport-dependent half
// of each grid slot's "where should a new tile land" score.
//
// Per-index it caches two numbers, both in screen-fraction units
// (halfW = 1.0 horizontal, halfH = 1.0 vertical) so a wide screen
// doesn't unfairly favour horizontally-distant slots over vertically-
// distant ones — distance is measured relative to how much of the
// visible area it consumes.
//
//   off    — how far outside the screen rect the hex center sits, in
//            screen-fractions. Inside the rect ties at zero (fully on-
//            screen); outside grows with screen-relative distance from
//            the visible area.
//   center — squared screen-fraction distance from the screen center.
//            Among on-screen candidates this picks the most-centered
//            slot in aspect-aware terms.
//
// Occupancy and whitespace-around-candidate are NOT this tracker's
// concern — they change every time a tile is added or moved, while
// these scores only change when the viewport does. The allocator in
// show-cell.drone combines this cached map with a fresh whitespace
// pass over sparse[] at placement time.
//
// Invalidation: viewport gestures emit `viewport:manual` (transient),
// the post-debounce persist emits `viewport:persisted`, and a window
// resize listener handles canvas-size changes. Recompute is lazy on
// next read after a dirty mark, so rapid viewport churn does not pay
// re-sort cost until someone needs the result.

import { EffectBus } from '@hypercomb/core'
import type { AxialService } from './axial-service.js'

export type SlotScore = { off: number; center: number }

export class CenterSlotTracker {
  #dirty = true
  #cached: Map<number, SlotScore> = new Map()

  constructor() {
    EffectBus.on('viewport:persisted', () => { this.#dirty = true })
    EffectBus.on('viewport:manual', () => { this.#dirty = true })
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => { this.#dirty = true })
    }
  }

  /** Per-index viewport score map. Keys are every index the
   *  AxialService knows about; values are the screen-fraction
   *  (off, center) pair. Recomputed lazily on next read after a
   *  viewport change. */
  get scores(): ReadonlyMap<number, SlotScore> {
    if (this.#dirty) {
      this.#cached = this.#compute()
      this.#dirty = false
    }
    return this.#cached
  }

  #compute = (): Map<number, SlotScore> => {
    const out = new Map<number, SlotScore>()
    const ioc = (window as any).ioc
    const axial = ioc?.get?.('@diamondcoreprocessor.com/AxialService') as AxialService | undefined
    if (!axial || axial.items.size === 0) return out

    const vp = ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as
      | { lastZoom?: { scale: number }; lastPan?: { dx: number; dy: number } }
      | undefined

    const scale = vp?.lastZoom?.scale ?? 1
    const dx = vp?.lastPan?.dx ?? 0
    const dy = vp?.lastPan?.dy ?? 0
    const halfW = Math.max(1, (typeof window !== 'undefined' ? window.innerWidth : 0) / 2)
    const halfH = Math.max(1, (typeof window !== 'undefined' ? window.innerHeight : 0) / 2)

    for (const [i, coord] of axial.items) {
      // Hex center in screen coordinates relative to screen center —
      // pixi's stage sits at (screenW/2 + pan.dx, screenH/2 + pan.dy)
      // scaled by zoom, so subtracting screen center cancels the
      // half-dimensions and leaves wx*scale + dx. Normalize by half-
      // dimensions so both axes are in screen-fraction units.
      const sxN = (coord.Location.x * scale + dx) / halfW
      const syN = (coord.Location.y * scale + dy) / halfH
      const oxN = Math.max(0, Math.abs(sxN) - 1)
      const oyN = Math.max(0, Math.abs(syN) - 1)
      const off = Math.sqrt(oxN * oxN + oyN * oyN)
      const center = sxN * sxN + syN * syN
      out.set(i, { off, center })
    }
    return out
  }
}

const _centerSlotTracker = new CenterSlotTracker()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CenterSlotTracker', _centerSlotTracker)

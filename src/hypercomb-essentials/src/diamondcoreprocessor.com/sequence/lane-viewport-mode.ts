// Mobile-only contract shared by the arrangement and navigation inputs.
// `x` is the flat-top left↔right scroller; `y` is the point-top top↔bottom
// scroller. Desktop ALWAYS reads null: lane locking does not belong to the
// desktop viewport, regardless of which caller tried to engage it.
//
// The axis is DERIVED FROM THE DEVICE ON EVERY READ, never stored. Lane mode
// is one boolean — on or off — and the direction is whichever way the screen
// is long right now. Storing the axis at arrange time made the lock depend on
// the re-pack pass surviving a rotation, and a rotation is precisely when that
// pass is least reliable: `orientationchange` fires before the metrics update
// (iOS), the resize burst can arrive while the render snapshot is empty, and a
// swallowed pass left the phone locked ACROSS the screen — up/down travel in
// landscape, which is the one thing lanes exists to prevent. Deriving it live
// costs a comparison and can never go stale: the worst a missed re-pack can do
// now is leave the hexes packed the old way for a moment, with the viewport
// already scrolling the right direction.

import { EffectBus } from '@hypercomb/core'
import { MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'
import { LANE_DEFAULT, LANE_MAX, LANE_MIN, clampLanes } from './arrangements.js'

const LANE_COUNT_KEY = 'hc:lane-count'

/** The switch itself travels on the BUS, because module scope is not shared.
 *
 *  Every bee is bundled standalone, so this file is INLINED SEPARATELY into
 *  each one that imports it — the sequence drone that engages lanes and the
 *  pan/zoom inputs that must obey the lock each got their own private copy of
 *  the variable below. In the dev shell (one TypeScript graph, one module)
 *  they are the same variable and everything worked; in the runtime shell —
 *  the web app, the DCP install, the deployed phone — `setLaneViewport(true)`
 *  set the SEQUENCE bee's copy while pan kept reading its own, permanently
 *  false. The strip re-packed and the hexes turned, because those ride the
 *  bus, and the travel stayed free in both directions: exactly the "lanes do
 *  not constrain anything on my phone" report, invisible on desktop.
 *
 *  EffectBus is a `globalThis` singleton with last-value replay, so it IS
 *  shared across bundles: the boolean below is now a per-copy MIRROR of one
 *  bus value, and a copy loaded later replays into step on subscribe. */
export const LANE_VIEWPORT_EFFECT = 'lanes:viewport'

export type LaneScrollAxis = 'x' | 'y'

let laneViewport = false
try {
  EffectBus.on<{ active?: boolean }>(LANE_VIEWPORT_EFFECT, (p) => {
    laneViewport = p?.active === true
  })
} catch {
  /* no bus (unit context) — the local mirror is still authoritative */
}

// The ladder rung the phone is reading at: 3 = scan, 2 = browse, 1 = read.
// Runtime + participant-local only. It is a legibility choice, never tile
// truth — the ARRANGEMENT it produces is the truth, and that is written by
// the ordinary placement commit.
let laneCount = LANE_DEFAULT

const mobileModeActive = (): boolean => {
  const ioc = (globalThis as {
    ioc?: { get?: (key: string) => unknown }
  }).ioc
  return (ioc?.get?.(MOBILE_MODE_IOC_KEY) as { active?: boolean } | undefined)?.active === true
}

/** Which way the strip runs: left↔right exactly when the viewport is wider
 *  than it is tall. ONE definition, shared by the axis lock and the packer, so
 *  the direction the phone scrolls and the direction the lanes were packed can
 *  never disagree. Lanes always run across the SHORT side of the screen and
 *  the strip travels along the long one. */
export const laneStripHorizontal = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth > window.innerHeight

export const getLaneScrollAxis = (): LaneScrollAxis | null =>
  laneViewport && mobileModeActive()
    ? (laneStripHorizontal() ? 'x' : 'y')
    : null

/** The ladder rung, restored per participant. Readable on desktop too — it
 *  says nothing about the desktop viewport, it is simply the last rung the
 *  phone chose, and `/lanes` on a phone resumes there.
 *
 *  Read from storage, for the same reason the switch rides the bus: the
 *  in-memory rung belongs to whichever bundle set it. localStorage is the one
 *  copy every bee can see. */
export const getLaneCount = (): number => {
  try {
    const stored = Number(window.localStorage?.getItem(LANE_COUNT_KEY))
    if (Number.isFinite(stored) && stored > 0) laneCount = clampLanes(stored)
  } catch {
    /* storage disabled — the local rung is the best we have */
  }
  return laneCount
}

export const setLaneCount = (lanes: number): number => {
  laneCount = clampLanes(lanes)
  try {
    window.localStorage?.setItem(LANE_COUNT_KEY, String(laneCount))
  } catch {
    /* private mode / storage disabled — the rung just won't persist */
  }
  return laneCount
}

/** Step the ladder. `dir < 0` reads closer (fewer, wider lanes); `dir > 0`
 *  scans wider. Clamped at both ends — a step past the edge is a no-op the
 *  caller can report, never a wrap that jumps from read back to scan. */
export const stepLaneCount = (dir: number): number =>
  setLaneCount(getLaneCount() + (dir < 0 ? -1 : 1))

export const laneCountAtEdge = (dir: number): boolean =>
  dir < 0 ? getLaneCount() <= LANE_MIN : getLaneCount() >= LANE_MAX

try {
  const stored = Number(window.localStorage?.getItem(LANE_COUNT_KEY))
  laneCount = Number.isFinite(stored) && stored > 0 ? clampLanes(stored) : LANE_DEFAULT
} catch {
  laneCount = LANE_DEFAULT
}

/** Engage or release the lane viewport. There is no axis to pass: the caller
 *  owns WHETHER the phone is reading in lanes, the device owns WHICH WAY. */
export const setLaneViewport = (active: boolean): boolean => {
  // Enforce the platform boundary here, at the source read by pan + zoom.
  // Command/UI guards are useful feedback, but must not be the safety boundary.
  const next = active && mobileModeActive()
  if (laneViewport === next) return false
  laneViewport = next
  // Publish so every OTHER copy of this module — pan, zoom, anything bundled
  // separately — flips with it. Without this the lock only ever existed
  // inside the bundle that engaged it.
  try {
    EffectBus.emit(LANE_VIEWPORT_EFFECT, { active: next })
  } catch {
    /* no bus — single-copy contexts still read the local mirror */
  }
  return true
}

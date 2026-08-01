// Mobile-only contract shared by the arrangement and navigation inputs.
// `x` is the flat-top left↔right scroller; `y` is the point-top top↔bottom
// scroller. Desktop ALWAYS reads null: lane locking does not belong to the
// desktop viewport, regardless of which caller attempted to set an axis.

import { MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'
import { LANE_DEFAULT, LANE_MAX, LANE_MIN, clampLanes } from './arrangements.js'

const LANE_COUNT_KEY = 'hc:lane-count'

export type LaneScrollAxis = 'x' | 'y'

let laneAxis: LaneScrollAxis | null = null
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

export const getLaneScrollAxis = (): LaneScrollAxis | null =>
  mobileModeActive() ? laneAxis : null

/** The ladder rung, restored per participant. Readable on desktop too — it
 *  says nothing about the desktop viewport, it is simply the last rung the
 *  phone chose, and `/lanes` on a phone resumes there. */
export const getLaneCount = (): number => laneCount

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
  setLaneCount(laneCount + (dir < 0 ? -1 : 1))

export const laneCountAtEdge = (dir: number): boolean =>
  dir < 0 ? laneCount <= LANE_MIN : laneCount >= LANE_MAX

try {
  const stored = Number(window.localStorage?.getItem(LANE_COUNT_KEY))
  laneCount = Number.isFinite(stored) && stored > 0 ? clampLanes(stored) : LANE_DEFAULT
} catch {
  laneCount = LANE_DEFAULT
}

export const setLaneScrollAxis = (axis: LaneScrollAxis | null): boolean => {
  // Enforce the platform boundary here, at the source read by pan + zoom.
  // Command/UI guards are useful feedback, but must not be the safety boundary.
  const next = axis && mobileModeActive() ? axis : null
  if (laneAxis === next) return false
  laneAxis = next
  return true
}

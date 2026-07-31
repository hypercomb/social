// Mobile-only contract shared by the arrangement and navigation inputs.
// `x` is the flat-top left↔right scroller; `y` is the point-top top↔bottom
// scroller. Desktop ALWAYS reads null: lane locking does not belong to the
// desktop viewport, regardless of which caller attempted to set an axis.

import { MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

export type LaneScrollAxis = 'x' | 'y'

let laneAxis: LaneScrollAxis | null = null

const mobileModeActive = (): boolean => {
  const ioc = (globalThis as {
    ioc?: { get?: (key: string) => unknown }
  }).ioc
  return (ioc?.get?.(MOBILE_MODE_IOC_KEY) as { active?: boolean } | undefined)?.active === true
}

export const getLaneScrollAxis = (): LaneScrollAxis | null =>
  mobileModeActive() ? laneAxis : null

export const setLaneScrollAxis = (axis: LaneScrollAxis | null): boolean => {
  // Enforce the platform boundary here, at the source read by pan + zoom.
  // Command/UI guards are useful feedback, but must not be the safety boundary.
  const next = axis && mobileModeActive() ? axis : null
  if (laneAxis === next) return false
  laneAxis = next
  return true
}

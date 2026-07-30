// View-local contract shared by the arrangement and navigation inputs.
// `x` is the flat-top left↔right scroller; `y` is the point-top top↔bottom
// scroller. Null restores the ordinary free-pan/free-zoom hive viewport.

export type LaneScrollAxis = 'x' | 'y'

let laneAxis: LaneScrollAxis | null = null

export const getLaneScrollAxis = (): LaneScrollAxis | null => laneAxis

export const setLaneScrollAxis = (axis: LaneScrollAxis | null): boolean => {
  if (laneAxis === axis) return false
  laneAxis = axis
  return true
}

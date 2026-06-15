// diamondcoreprocessor.com/pixi/stage-centering.ts
//
// Pure centering math for the Pixi stage — the single source of truth
// shared by PixiHostWorker's resize/fullscreen handling and its tests.
//
// The viewport model everywhere in the codebase is:
//
//   stage.position = viewportCenter + pan
//
// where `pan` is the participant's offset-from-center (PanningDrone
// persists exactly `stage.position - screenCenter`). On ANY viewport
// size change — window resize, device rotation, fullscreen toggle —
// pan is untouched and the stage absorbs the full center delta. That
// keeps content centered relative to its current position no matter
// what size the screen becomes: centered content stays centered,
// panned content keeps the same offset from the new center.

export type ScreenSize = { width: number; height: number }
export type Pan = { dx: number; dy: number }
export type FitZoom = { fit?: boolean }

/**
 * Stage position for a given canvas size and pan offset.
 * Center is rounded to integer pixels so a zero-pan grid lands on whole
 * pixels with no sub-pixel drift after rotation/resize/fullscreen.
 * Missing pan (VP read still in flight at boot) centers exactly.
 */
export const computeStageCenter = (
  screen: ScreenSize,
  pan?: Pan | null,
): { x: number; y: number } => ({
  x: Math.round(screen.width * 0.5) + (pan?.dx ?? 0),
  y: Math.round(screen.height * 0.5) + (pan?.dy ?? 0),
})

/**
 * The "fixed extra" a viewport size change demands of the stage: the
 * delta between the old and new rounded centers. Recentering is exactly
 * `stage += computeCenterDelta(oldSize, newSize)` — independent of pan.
 */
export const computeCenterDelta = (
  from: ScreenSize,
  to: ScreenSize,
): { dx: number; dy: number } => ({
  dx: Math.round(to.width * 0.5) - Math.round(from.width * 0.5),
  dy: Math.round(to.height * 0.5) - Math.round(from.height * 0.5),
})

export type WindowMetrics = {
  screenX: number
  screenY: number
  outerWidth: number
  outerHeight: number
  innerWidth: number
  innerHeight: number
}
export type ViewportOrigin = { left: number; top: number }
export type PhysicalAnchor = { x: number; y: number }

/**
 * Physical screen position of the viewport's top-left corner. Browser
 * chrome (tab strip + address bar) sits above the viewport, so the top
 * is screenY plus the full outer−inner height difference; window
 * borders split the width difference evenly. Standard approximation:
 * a docked DevTools pane or bottom toolbar gets misattributed to the
 * top — only relevant during the brief fullscreen pin, and off by at
 * most that pane's height in that one configuration.
 */
export const computeViewportOrigin = (w: WindowMetrics): ViewportOrigin => ({
  left: w.screenX + (w.outerWidth - w.innerWidth) / 2,
  top: w.screenY + (w.outerHeight - w.innerHeight),
})

/**
 * Where the stage origin sits on the PHYSICAL screen. The canvas host
 * is fixed inset:0, so canvas coordinates are viewport coordinates and
 * the physical position is simply origin + stage. (A host narrowed by
 * sidebar CSS adds a constant canvas offset, but constants cancel
 * across a pin: capture and re-apply both carry the same offset.)
 */
export const computePhysicalAnchor = (
  origin: ViewportOrigin,
  stage: { x: number; y: number },
): PhysicalAnchor => ({ x: origin.left + stage.x, y: origin.top + stage.y })

/**
 * Stage position that keeps `anchor` at the exact same physical screen
 * spot for a viewport now at `origin`. This is the fullscreen-toggle
 * policy: entering fullscreen gains MORE height at the top (browser
 * chrome) than the bottom (taskbar), so plain recentering (stage moves
 * by the center delta, ΔH/2) lifts content by the asymmetry — e.g.
 * 1536×695 maximized → 1536×864 fullscreen: top edge rises 129px,
 * center descends only 84px, content visibly jumps UP 45px. Pinning
 * makes the stage absorb the full origin delta instead; the resulting
 * offset-from-center becomes the pan, and an exit transition reverses
 * it exactly (round-trip restores the original stage and pan).
 */
export const computePinnedStage = (
  anchor: PhysicalAnchor,
  origin: ViewportOrigin,
): { x: number; y: number } => ({
  x: anchor.x - origin.left,
  y: anchor.y - origin.top,
})

/**
 * Whether a viewport size change should recompute a saved fit zoom.
 * A fit's saved (cx, cy) was derived from the previous safe area, so it
 * must be recomputed for the new viewport — but ONLY when pan is known
 * to be zero. A user pan means they explicitly moved away from the fit
 * position; refitting would clobber it (zoomToFit resets pan to 0,0).
 * An undefined pan means the VP read may still be in flight — defer
 * rather than risk a destructive refit against half-loaded state.
 */
export const shouldRefit = (
  zoom?: FitZoom | null,
  pan?: Pan | null,
): boolean => !!zoom?.fit && !!pan && pan.dx === 0 && pan.dy === 0

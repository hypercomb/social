// editor/editor-surface.ts
//
// WHERE THE TILE EDITOR SITS — and the one rule that decides it.
//
// The editor fits INTO the view. On a screen with room beside the hive it is
// a docked window on the right and the hive re-fits beside it, so a crop, a
// rim colour and a name are judged against the neighbouring tiles. On a phone
// — and on any screen too narrow to leave a usable hive — it is a full-height
// page above the control bar, which is how every other surface behaves there.
//
// It is never a popup: the old editor blacked the hive out behind a scrim,
// which is exactly what you cannot do to someone framing a picture that has
// to sit next to other pictures.

import { isPhoneViewport } from '@hypercomb/core'
import { MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

export type EditorSurface = 'dock' | 'page'

/** The hive keeps at least this much width beside a docked editor. Below it
 *  the dock stops being "beside the hive" and the page is the honest answer. */
export const MIN_HIVE_WIDTH = 360

export const DOCK_DEFAULT_WIDTH = 400
export const DOCK_MIN_WIDTH = 340
export const DOCK_MAX_WIDTH = 560

/** The app's phone mode — pointer and size, or the `/mobile on` override. */
export const mobileModeActive = (): boolean => {
  try {
    const mobile = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
      ?.get?.(MOBILE_MODE_IOC_KEY) as { active?: boolean } | undefined
    return mobile?.active === true
  } catch { return false }
}

/** Dock or page, for a viewport width. Phone-shaped (either axis) is always a
 *  page; so is a viewport that cannot spare `MIN_HIVE_WIDTH` beside the
 *  narrowest dock. A portrait tablet (768) keeps the dock. */
export const editorSurface = (width: number = typeof window === 'undefined' ? 0 : window.innerWidth): EditorSurface => {
  if (isPhoneViewport() || mobileModeActive()) return 'page'
  return width - DOCK_MIN_WIDTH < MIN_HIVE_WIDTH ? 'page' : 'dock'
}

/** How wide the dock opens: its default, narrowed as far as its minimum so the
 *  hive always keeps `MIN_HIVE_WIDTH`. */
export const dockWidthFor = (width: number = typeof window === 'undefined' ? 0 : window.innerWidth): number => {
  const room = Math.max(DOCK_MIN_WIDTH, width - MIN_HIVE_WIDTH)
  return Math.round(Math.min(DOCK_DEFAULT_WIDTH, room))
}

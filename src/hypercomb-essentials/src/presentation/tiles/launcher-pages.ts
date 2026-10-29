// presentation/tiles/launcher-pages.ts
//
// THE SCREENS, pure. A launcher is a row of screens you turn with a sideways
// swipe. On a launch-group page (/games, /websites, …) each screen IS one
// group. Anywhere else, the screens are pages of this layer's tiles.
//
// Two ways to draw a tile, one pager: phone icons, or square plates.

import type { LauncherStyle } from '../../commands/launcher-kind.js'

export type LaunchGroupScreen = { readonly id: string; readonly openDirectly?: boolean }

/** Travel that makes a horizontal drag a turn of the screen. A vertical
 *  scroll has to be clearly more down than across before it wins. */
export const SWIPE_PX = 56

/**
 * When this place is itself a launcher page and there is another one to
 * turn to, the screens are those pages in registry order. Otherwise null:
 * the caller pages the tiles of this one place.
 */
export function launcherGroupScreens(
  groups: readonly LaunchGroupScreen[],
  segments: readonly string[],
): { ids: readonly string[]; index: number } | null {
  if (segments.length !== 1) return null
  const ids = groups.filter(group => group.id && group.openDirectly !== true).map(group => group.id)
  const index = ids.indexOf(segments[0] ?? '')
  if (index < 0 || ids.length < 2) return null
  return { ids, index }
}

/** Columns and rows that fill a viewport without scrolling a screen. */
export function gridFor(
  style: LauncherStyle,
  width: number,
  height: number,
): { cols: number; rows: number } {
  const room = Math.max(0, height - 148)
  if (style === 'icons') {
    const cols = width < 520 ? 4 : width < 960 ? 5 : 6
    const rows = Math.max(3, Math.min(6, Math.floor(room / 112)))
    return { cols, rows }
  }
  const cols = width < 700 ? 2 : width < 1100 ? 3 : 4
  const rows = Math.max(2, Math.min(4, Math.floor(room / 220)))
  return { cols, rows }
}

export function perScreen(style: LauncherStyle, width: number, height: number): number {
  const grid = gridFor(style, width, height)
  return grid.cols * grid.rows
}

/** Cut `items` into screens of `per`. An empty place is no screens. */
export function pagesOf<T>(items: readonly T[], per: number): T[][] {
  const size = Math.max(1, Math.floor(per) || 1)
  const pages: T[][] = []
  for (let at = 0; at < items.length; at += size) pages.push(items.slice(at, at + size))
  return pages
}

/** The page a swipe lands on. The ends hold: a swipe past them stays. */
export function pageAfter(index: number, count: number, step: -1 | 0 | 1): number {
  if (count <= 0) return 0
  const current = Math.max(0, Math.min(count - 1, Math.floor(index)))
  if (step === 0 || count <= 1) return current
  const next = current + step
  if (next < 0 || next >= count) return current
  return next
}

/**
 * Left is the next screen. A drag that is more down than across is a
 * scroll, not a turn. Under the threshold, a finger that rested is a tap.
 */
export function swipeStep(dx: number, dy: number, threshold = SWIPE_PX): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold) return 0
  if (Math.abs(dx) < Math.abs(dy) * 1.4) return 0
  return dx < 0 ? 1 : -1
}

/** The letter a plate wears until its picture is painted. */
export function plateLetter(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return ''
  const first = [...trimmed][0] ?? ''
  return first.toUpperCase()
}

/** A stable hue so neighbouring empty plates are not one grey field. */
export function plateHue(label: string): number {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return hash % 360
}

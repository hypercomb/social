// hypercomb-essentials/src/presentation/tiles/page-cells.ts
//
// WHAT A PAGE SHOWS — ONE ANSWER, EVERY VIEW.
//
// Which tiles a page shows is decided once. show-cell reads the layer and
// applies every filter there is — the pheromone filter (`tags:filter`,
// including the flatten that gathers matches from anywhere in the hive),
// search, hidden tiles, the participant filter, history — and publishes the
// result as `render:cell-count`. It keeps doing that while another view is
// open, because it paints beneath it.
//
// A view is an ADAPTER over that answer: it lays the same cells out its own
// way. A view that reads the layer's children itself shows the tiles a filter
// removed, and every new filter has to be taught to every view again. The
// square tile view did exactly that (jwize 2026-10-05: "square tile view
// doesn't filter when you filter by pheromone … if architected right we
// should get that for free").
//
// So a view never asks `childNamesOf` what to show. It asks `pageCellsAt`,
// and re-renders on `onPageCellsChanged`. A filter added later reaches every
// view that reads here without touching any of them.

import { EffectBus } from '@hypercomb/core'

/** One cell a page shows: its name, and where the tile itself lives. On an
 *  ordinary page that is `[...page, label]`; under a flattening filter it is
 *  the match's own path, anywhere in the hive. */
export type PageCell = { readonly label: string; readonly segments: readonly string[] }

/** The page's answer: its cells, and whether something narrows it — so a
 *  view can tell "nothing matches the filter" from an empty branch. */
export type PageCells = { readonly cells: readonly PageCell[]; readonly narrowed: boolean }

type CellCountPayload = {
  readonly locationKey?: string
  readonly labels?: readonly string[]
  /** Absolute path per label — present only while a filter flattens. */
  readonly flatPaths?: Record<string, readonly string[]>
  /** False while a render is still streaming its cells in. */
  readonly settled?: boolean
  readonly narrowed?: boolean
}

/** The key show-cell renders a place under (Lineage.explorerLabel). */
export const pageKeyOf = (segments: readonly string[]): string => '/' + segments.join('/')

let shown: { key: string; answer: PageCells; print: string } | null = null
const listeners = new Set<() => void>()

EffectBus.on<CellCountPayload>('render:cell-count', payload => {
  // A streaming pass reports partial lists; a view rebuilt on each of them
  // would flicker through every intermediate page. The settled pass follows.
  if (!payload || payload.settled === false) return
  const key = String(payload.locationKey ?? '')
  if (!key) return
  const page = key.split('/').filter(Boolean)
  const flat = payload.flatPaths ?? {}
  const cells: PageCell[] = (payload.labels ?? []).map(label => {
    const path = flat[label]
    return { label, segments: Array.isArray(path) && path.length ? [...path] : [...page, label] }
  })
  const narrowed = payload.narrowed === true
  const print = `${key}\n${narrowed}\n` + cells.map(cell => cell.segments.join('/')).join('\n')
  if (shown?.print === print) return
  shown = { key, answer: { cells, narrowed }, print }
  for (const listener of [...listeners]) {
    try { listener() } catch (error) { console.error('[page-cells] listener threw:', error) }
  }
})

/** What the page at `segments` shows, cells in the order the hive lays them
 *  out — or null while no render has reported that page yet. */
export const pageCellsAt = (segments: readonly string[]): PageCells | null =>
  shown && shown.key === pageKeyOf(segments) ? shown.answer : null

/** The page's cells, waiting up to `timeoutMs` for its first render when it
 *  has not reported yet. Null means nothing rendered that page in time — a
 *  view open on a place the hive is not standing on. */
export const whenPageCells = (segments: readonly string[], timeoutMs = 1500): Promise<PageCells | null> => {
  const ready = pageCellsAt(segments)
  if (ready) return Promise.resolve(ready)
  return new Promise(resolve => {
    const done = (answer: PageCells | null): void => {
      clearTimeout(timer)
      listeners.delete(check)
      resolve(answer)
    }
    const check = (): void => {
      const answer = pageCellsAt(segments)
      if (answer) done(answer)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    listeners.add(check)
  })
}

/** Called whenever what the current page shows changes — a filter toggled, a
 *  tile added, hidden or removed, a navigation landing. Returns the way off. */
export const onPageCellsChanged = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// editor/diagram/placement.ts
//
// WHERE THE TABS GO AND HOW THEIR LEADERS RUN. Pure: anchors in, rectangles and
// polylines out. Each column is packed once, from the CLOSED heights only, so an
// open card floats over its neighbours and nothing else ever moves or goes
// diagonal. A leader is a polyline anchor -> kink -> tab edge; the kink sits a
// fixed distance off the tab so a pushed-down tab still leaves horizontally.

import type { Pt } from '../models/tile-model.js'
import { GAP, GAP_TOOL, HEAD, TOOL } from './layout.js'

export interface PackItem { desired: number; h: number; top?: number }

/**
 * One pass per column: sort by the desired top, push each down below the one
 * before it, then pull back up from the bottom limit. Sets `top` on every item
 * (and leaves the array sorted). Order is always preserved.
 */
export function packColumn(items: PackItem[], top: number, bottom: number, gap: number): void {
  items.sort((p, q) => p.desired - q.desired)
  let prev = top - gap
  for (const it of items) {
    it.top = Math.max(it.desired, prev + gap)
    prev = it.top + it.h
  }
  let limit = bottom
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.top! + it.h > limit) it.top = limit - it.h
    limit = it.top! - gap
  }
}

export interface TabIn {
  readonly id: string
  readonly side: 'left' | 'right'
  /** Stage px; null for a callout that is not on the tile (it has no leader). */
  readonly anchor: Pt | null
  /** Not on the tile: keeps to the outer corner on the toolbar's row. */
  readonly free?: boolean
  /** Present on the ONE open tab: how tall its card body is. */
  readonly open?: { readonly bodyHeight: number }
}

export interface TabPlace {
  /** Top of the whole callout (when it grows up, the top of its card). */
  readonly left: number
  readonly top: number
  readonly width: number
  readonly grow: 'down' | 'up'
  /** An open card would half-cover it: not drawn until the card closes. */
  readonly covered: boolean
  /** Where its head sits, whichever way the card grows. */
  readonly headTop: number
  /** The edge the leader meets (the tab's inner edge). */
  readonly edge: number
  readonly cardTop: number
  readonly cardBottom: number
}

export interface Placement {
  readonly tabs: ReadonlyMap<string, TabPlace>
  readonly leaders: ReadonlyMap<string, readonly Pt[]>
  /** Leaders that would run under an open card: the line is not drawn, the dot stays. */
  readonly hiddenLeaders: ReadonlySet<string>
  readonly crossings: number
  /** The picture toolbar reaches into the right-hand column. */
  readonly crowded: boolean
  readonly overlaps: readonly string[]
  readonly offscreen: readonly string[]
}

export interface PlaceInput {
  tabs: TabIn[]
  extent: { min: number; max: number }
  figure: { left: number; top: number }
  size: number
  viewport: { width: number; height: number }
  unit: number
  tab: number
  card: number
  /** The toolbar's right-hand reach and top, viewport px; null when it is not shown. */
  toolbar: { reach: number; top: number } | null
}

/** Proper crossing of two segments (touching ends do not count). */
export function segmentsCross(a: readonly [Pt, Pt], b: readonly [Pt, Pt]): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(b[0], b[1], a[0]), d2 = o(b[0], b[1], a[1])
  const d3 = o(a[0], a[1], b[0]), d4 = o(a[0], a[1], b[1])
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Crossings between the polylines of DIFFERENT leaders. */
export function countCrossings(lines: ReadonlyMap<string, readonly Pt[]>): number {
  const segs: { id: string; s: [Pt, Pt] }[] = []
  for (const [id, pts] of lines) for (let k = 0; k < pts.length - 1; k++) segs.push({ id, s: [pts[k], pts[k + 1]] })
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) if (segs[i].id !== segs[j].id && segmentsCross(segs[i].s, segs[j].s)) n++
  }
  return n
}

type Column = { id: string; tab: TabIn; desired: number; h: number; top?: number; width: number }

export function placeTabs(i: PlaceInput): Placement {
  const U = i.unit
  const head = HEAD * U
  const { width: vw, height: vh } = i.viewport
  const toolTop = i.toolbar ? i.toolbar.top : i.figure.top + i.size + GAP_TOOL * U
  const toolRow = toolTop + (TOOL * U - head) / 2
  const rightEdge = Math.min(i.figure.left + i.extent.max + GAP * U, vw - i.card - 12 * U)
  const crowded = !!i.toolbar && i.toolbar.reach > rightEdge - 8 * U

  const cols: Record<'left' | 'right', Column[]> = { left: [], right: [] }
  for (const t of i.tabs) {
    const width = t.open ? i.card : i.tab
    let desired: number
    if (t.free || !t.anchor) desired = crowded ? toolTop - 4 * U - head : toolRow
    else desired = i.figure.top + t.anchor.y - head / 2
    cols[t.side].push({ id: t.id, tab: t, desired, h: head, width })
  }

  const tabs = new Map<string, TabPlace>()
  for (const side of ['left', 'right'] as const) {
    const list = cols[side]
    packColumn(list, 8, side === 'right' && crowded ? toolTop - 4 * U : vh - 8, 8 * U)
    const rawEdge = side === 'left' ? i.figure.left + i.extent.min - GAP * U : i.figure.left + i.extent.max + GAP * U
    for (const it of list) {
      const body = it.tab.open ? it.tab.open.bodyHeight : 0
      const up = !!it.tab.open && it.top! + head + body > vh - 8
      const left = side === 'left' ? rawEdge - it.width : Math.min(rawEdge, vw - it.width - 12 * U)
      const cardTop = up ? it.top! - body : it.top!
      tabs.set(it.id, {
        left: Math.round(left), top: Math.round(cardTop), width: it.width, grow: up ? 'up' : 'down',
        covered: false, headTop: it.top!,
        edge: side === 'left' ? rawEdge : left,
        cardTop, cardBottom: it.top! + head + (up ? 0 : body),
      })
    }
  }

  // a tab that an open card would half-cover is not drawn at all; it returns when the card closes
  const bySide = (s: 'left' | 'right') => cols[s].map(c => c.id)
  for (const side of ['left', 'right'] as const) {
    const openId = bySide(side).find(id => i.tabs.find(t => t.id === id)?.open)
    if (!openId) continue
    const o = tabs.get(openId)!
    for (const id of bySide(side)) {
      if (id === openId) continue
      const p = tabs.get(id)!
      if (p.headTop < o.cardBottom + 2 && p.headTop + head > o.cardTop - 2) tabs.set(id, { ...p, covered: true })
    }
  }

  const leaders = new Map<string, readonly Pt[]>()
  const hidden = new Set<string>()
  const drawn = new Map<string, readonly Pt[]>()
  for (const t of i.tabs) {
    if (t.free || !t.anchor) continue
    const p = tabs.get(t.id)!
    const dir = t.side === 'left' ? -1 : 1
    const ax = i.figure.left + t.anchor.x, ay = i.figure.top + t.anchor.y
    const ey = p.headTop + head / 2
    const kink = p.edge - dir * 26 * U
    const pts: Pt[] = Math.abs(ay - ey) < 1
      ? [{ x: ax, y: ay }, { x: p.edge, y: ey }]
      : [{ x: ax, y: ay }, { x: kink, y: ey }, { x: p.edge, y: ey }]
    leaders.set(t.id, pts)
    // a neighbour's leader that would run under an open card is not drawn
    const other = i.tabs.find(o => o.id !== t.id && o.side === t.side && o.open)
    const op = other ? tabs.get(other.id) : undefined
    if (op && ey > op.cardTop - 2 && ey < op.cardBottom + 2) hidden.add(t.id)
    else drawn.set(t.id, pts)
  }

  const overlaps: string[] = []
  const offscreen: string[] = []
  const ids = [...tabs.keys()]
  const rect = (id: string) => {
    const p = tabs.get(id)!
    return { l: p.left, r: p.left + p.width, t: p.headTop, b: p.headTop + head }
  }
  for (let a = 0; a < ids.length; a++) {
    const ra = rect(ids[a])
    for (let b = a + 1; b < ids.length; b++) {
      const rb = rect(ids[b])
      if (ra.l < rb.r - 1 && ra.r > rb.l + 1 && ra.t < rb.b - 1 && ra.b > rb.t + 1) overlaps.push(`${ids[a]}x${ids[b]}`)
    }
    const p = tabs.get(ids[a])!
    if (p.left < -1 || p.left + p.width > vw + 1 || p.cardTop < -1 || p.cardBottom > vh + 1) offscreen.push(ids[a])
  }

  return { tabs, leaders, hiddenLeaders: hidden, crossings: countCrossings(drawn), crowded, overlaps, offscreen }
}

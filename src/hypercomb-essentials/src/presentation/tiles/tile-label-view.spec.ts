// tile-label-view.spec.ts — A PAGE WITH MORE NAMES THAN LABEL SLOTS (SCALE-1),
// on its own. A layer that fits pins every cell; an oversized one pins the
// cells in view plus a ring; an out-of-view cell never claims a slot; a
// settled gesture repaints only when it brings unslotted cells into view.
import { describe, expect, it } from 'vitest'

import { LabelView, type LabelViewHost, type ViewCell } from './tile-label-view.js'

// A row of cells one spacing apart on screen: q = 0..n-1, r = 0, identity
// transform, spacing 10 — so cell q sits at x = √3·10·q.
const row = (n: number): ViewCell[] => Array.from({ length: n }, (_, q) => ({ label: `c${q}`, q, r: 0 }))

const hostWith = ({ capacity = 4, cells = [], ...over }: Partial<Omit<LabelViewHost, 'cells'>> & { capacity?: number; cells?: ViewCell[] } = {}) => {
  const slots = new Set<string>()
  let repaints = 0
  const host: LabelViewHost & { repaints: () => number; slots: Set<string> } = {
    slots,
    repaints: () => repaints,
    atlas: () => ({ capacity, hasLabel: label => slots.has(label) }),
    toGlobal: () => p => p,
    screen: () => ({ width: 100, height: 20 }),
    viewportPending: () => false,
    spacing: () => 10,
    flat: () => false,
    cells: () => cells,
    repaint: () => { repaints++ },
    ...over,
  }
  return host
}

describe('the label view', () => {
  it('a layer that fits the atlas pins every cell, as it always has', () => {
    const view = new LabelView(hostWith({ capacity: 256 }))
    expect(view.forPaint(row(20))).toBeNull()
    expect(view.pinned('c19')).toBe(true)
    expect(view.unbaked('c19', 'c19')).toBe(false)
  })

  it('an oversized layer pins the cells in view and a one-ring margin, nothing past it', () => {
    const view = new LabelView(hostWith())
    const pinned = view.forPaint(row(20))!
    // Screen 100 wide, margin (√3 + 1.2)·10 ≈ 29: centres up to x ≈ 129.
    expect([...pinned]).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(view.pinned('c7')).toBe(true)
    expect(view.pinned('c8')).toBe(false)
  })

  it('an out-of-view cell never claims a slot, but keeps one it already holds', () => {
    const host = hostWith()
    host.slots.add('c12')
    const view = new LabelView(host)
    view.forPaint(row(20))
    expect(view.unbaked('c15', 'c15')).toBe(true)
    expect(view.unbaked('c12', 'c12')).toBe(false)
    expect(view.unbaked('c3', 'c3')).toBe(false)
  })

  it('pins every cell while the viewport cannot be trusted yet', () => {
    expect(new LabelView(hostWith({ viewportPending: () => true })).forPaint(row(20))).toBeNull()
    expect(new LabelView(hostWith({ toGlobal: () => null })).forPaint(row(20))).toBeNull()
    expect(new LabelView(hostWith({ screen: () => ({ width: 0, height: 0 }) })).forPaint(row(20))).toBeNull()
  })

  it('a settled gesture repaints when it brings unslotted cells into view, and only then', () => {
    let shift = 0
    const cells = row(20)
    const host = hostWith({ cells, toGlobal: () => p => ({ x: p.x - shift, y: p.y }) })
    const view = new LabelView(host)
    const first = view.forPaint(cells)!
    for (const label of first) host.slots.add(label)
    view.refresh()
    expect(host.repaints()).toBe(0)
    expect(view.stale).toBe(false)
    // Panned by eight cells: the view now holds cells with no slot.
    shift = Math.sqrt(3) * 10 * 8
    view.refresh()
    expect(host.repaints()).toBe(1)
    expect(view.stale).toBe(true)
  })

  it('a view identical to the pinned one repaints nothing, even with names unslotted', () => {
    const cells = row(20)
    const host = hostWith({ cells })
    const view = new LabelView(host)
    view.forPaint(cells)
    view.refresh()
    expect(host.repaints()).toBe(0)
  })
})

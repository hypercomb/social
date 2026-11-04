// show-cell.paint.spec.ts — the paint ledger, with the exact numbers single-paint.md promises (V7).
//
// Pure: fake cells, fake plans, a counting writer. Pixi never runs here; the
// drone's writer is the other half and is covered by the source-shape specs.

import { describe, expect, it } from 'vitest'
import { PaintLedger, type SlotPlan } from './show-cell.paint.js'

/** A fake page: `n` cells, each with the attributes the real writer carries. */
const page = (n: number, face: (label: string) => number = () => 1): Map<string, SlotPlan> => {
  const plans = new Map<string, SlotPlan>()
  for (let i = 0; i < n; i++) {
    const label = `cell-${i}`
    plans.set(label, {
      aPosition: [i, 0, i + 1, 1],
      aLabelUV: [0.1, 0.1, 0.2, 0.2],
      aImageUV: [face(label), 0, 1, 1],
      aHasImage: [face(label) ? 1 : 0],
      aHeat: [0],
      aBorderColor: [0.78, 0.59, 0.35],
      aShaded: [0],
    })
  }
  return plans
}

const harness = () => {
  const writes: { label: string; attr: string }[] = []
  const pushes: string[][] = []
  const write = (label: string, attr: string): void => { writes.push({ label, attr }) }
  const push = (attrs: readonly string[]): void => { pushes.push([...attrs]) }
  return { writes, pushes, write, push }
}

/** Bake a page: a full drain over fresh buffers writes every slot once. */
const baked = (ledger: PaintLedger, plans: Map<string, SlotPlan>): void => {
  ledger.dirtyAll('location')
  const h = harness()
  const report = ledger.drain(plans, h.write, h.push, { full: true })
  expect(report.written.length).toBe(plans.size)
}

describe('paint ledger — rendering never repeats', () => {
  it('one tile change on a 50-cell page → 1 slot written, 1 push', () => {
    const ledger = new PaintLedger()
    const plans = page(50)
    baked(ledger, plans)

    // The save: one cell's picture changes.
    const changed = { ...plans.get('cell-7')!, aImageUV: [0.5, 0.5, 0.75, 0.75] as const }
    plans.set('cell-7', changed)
    ledger.dirty('cell-7', 'tile:saved')

    const h = harness()
    const report = ledger.drain(plans, h.write, h.push)
    expect(report.written).toEqual(['cell-7'])
    expect(new Set(h.writes.map(w => w.label))).toEqual(new Set(['cell-7']))
    // Only the attribute that changed is written, and the buffer is pushed once.
    expect(h.writes.map(w => w.attr)).toEqual(['aImageUV'])
    expect(h.pushes).toEqual([['aImageUV']])
    expect(ledger.audit.slots).toBe(51)   // 50 baked + 1
    expect(ledger.audit.pushes).toBe(2)   // the bake, then this one
  })

  it('one arrival whose sig one cell holds → 1 slot; a page holding none → 0 slots, 0 pushes', () => {
    // The receiver whose page shows the picture.
    const shows = new PaintLedger()
    const plans = page(12, label => (label === 'cell-3' ? 0 : 1))   // cell-3 has no picture yet
    baked(shows, plans)
    // The bytes land: cell-3's face resolves in the atlas.
    plans.set('cell-3', { ...plans.get('cell-3')!, aImageUV: [0.3, 0.3, 0.6, 0.6], aHasImage: [1] })
    shows.dirty(['cell-3'], 'swarm:resource-arrived')
    const h1 = harness()
    const r1 = shows.drain(plans, h1.write, h1.push)
    expect(r1.written).toEqual(['cell-3'])
    expect(h1.pushes.length).toBe(1)

    // A peer whose page holds none of the arriving sigs: the handler's lookup
    // finds no cell, so nothing is dirtied — and even a dirty label that is not
    // on the page writes nothing.
    const elsewhere = new PaintLedger()
    const other = page(12)
    baked(elsewhere, other)
    elsewhere.dirty('not-here', 'swarm:resource-arrived')
    const h2 = harness()
    const r2 = elsewhere.drain(other, h2.write, h2.push)
    expect(r2.written).toEqual([])
    expect(r2.pushed).toBe(false)
    expect(h2.writes).toEqual([])
    expect(h2.pushes).toEqual([])
    expect(elsewhere.audit.slots).toBe(12)
  })

  it('arrivals within one frame coalesce into one drain', () => {
    const ledger = new PaintLedger()
    const plans = page(20, () => 0)
    baked(ledger, plans)
    // A layer, its picture, its meta and its tags land as four events for
    // two cells; one drain writes the two slots and pushes once.
    for (const label of ['cell-1', 'cell-2']) plans.set(label, { ...plans.get(label)!, aImageUV: [0.2, 0.2, 0.4, 0.4], aHasImage: [1] })
    ledger.dirty('cell-1', 'swarm:resource-arrived')
    ledger.dirty('cell-1', 'swarm:resource-arrived')
    ledger.dirty('cell-2', 'swarm:resource-arrived')
    ledger.dirty(['cell-1', 'cell-2'], 'tags:changed')
    const h = harness()
    const report = ledger.drain(plans, h.write, h.push)
    expect(report.written.sort()).toEqual(['cell-1', 'cell-2'])
    expect(h.pushes.length).toBe(1)
    expect(ledger.audit.drains).toBe(2)
  })

  it('a full pass over an already-baked page → 0 slots rewritten', () => {
    const ledger = new PaintLedger()
    const plans = page(40)
    baked(ledger, plans)
    // Back-navigation: the page is asked for again in full, with nothing changed.
    ledger.dirtyAll('location')
    const h = harness()
    const report = ledger.drain(plans, h.write, h.push, { full: true })
    expect(report.full).toBe(true)
    expect(report.reason).toBe('location')
    expect(report.written).toEqual([])
    expect(report.skipped).toBe(40)
    expect(report.pushed).toBe(false)
    expect(h.writes).toEqual([])
    // A full pass is allowed to over-ask: no unchanged-key report for it.
    expect(report.unchanged).toEqual([])
    expect(ledger.audit.unchangedRequests).toBe(0)
  })

  it('a full pass with one changed cell writes that cell only', () => {
    const ledger = new PaintLedger()
    const plans = page(40)
    baked(ledger, plans)
    plans.set('cell-9', { ...plans.get('cell-9')!, aBorderColor: [1, 0, 0] })
    ledger.dirtyAll('layout-mode')
    const h = harness()
    const report = ledger.drain(plans, h.write, h.push, { full: true })
    expect(report.written).toEqual(['cell-9'])
    expect(h.writes).toEqual([{ label: 'cell-9', attr: 'aBorderColor' }])
    expect(h.pushes).toEqual([['aBorderColor']])
  })

  it('a cell that left the page is forgotten by the next full drain; one that arrived is written', () => {
    const ledger = new PaintLedger()
    const plans = page(5)
    baked(ledger, plans)
    plans.delete('cell-4')
    plans.set('cell-5', { aPosition: [5, 0, 6, 1], aHasImage: [0] })
    ledger.dirtyAll('location')
    const h = harness()
    const report = ledger.drain(plans, h.write, h.push, { full: true })
    expect(report.written).toEqual(['cell-5'])
    expect(ledger.painted('cell-4')).toBeUndefined()
    expect(ledger.paintedCount).toBe(5)
  })

  it('an explicit dirty under an unchanged key is reported once per label (a defect, not a cost)', () => {
    const warned: string[] = []
    const ledger = new PaintLedger((label, why) => warned.push(`${label}:${why}`))
    const plans = page(8)
    baked(ledger, plans)
    ledger.dirty('cell-2', 'title:indexed')
    const h = harness()
    const r1 = ledger.drain(plans, h.write, h.push)
    expect(r1.written).toEqual([])
    expect(r1.unchanged).toEqual(['cell-2'])
    expect(warned).toEqual(['cell-2:title:indexed'])
    // Again: still a skip, but no second report.
    ledger.dirty('cell-2', 'title:indexed')
    ledger.drain(plans, h.write, h.push)
    expect(warned.length).toBe(1)
    expect(ledger.audit.unchangedRequests).toBe(2)
    expect(ledger.audit.slots).toBe(8)
  })

  it('an animation frame drains only its labels and leaves the rest dirty', () => {
    const ledger = new PaintLedger()
    const plans = page(10)
    baked(ledger, plans)
    // A heat fade on cell-0 while cell-6 awaits its picture.
    plans.set('cell-0', { ...plans.get('cell-0')!, aHeat: [0.8] })
    plans.set('cell-6', { ...plans.get('cell-6')!, aImageUV: [0.9, 0.9, 1, 1] })
    ledger.dirty('cell-6', 'swarm:resource-arrived')
    ledger.dirty('cell-0', 'heat')
    const h = harness()
    const frame = ledger.drain(plans, h.write, h.push, { only: ['cell-0'] })
    expect(frame.written).toEqual(['cell-0'])
    expect(h.writes).toEqual([{ label: 'cell-0', attr: 'aHeat' }])
    expect(h.pushes).toEqual([['aHeat']])
    expect(ledger.isDirty('cell-6')).toBe(true)
    // Loading labels are skipped and stay dirty too.
    const later = ledger.drain(plans, h.write, h.push, { skip: new Set(['cell-6']) })
    expect(later.written).toEqual([])
    expect(ledger.isDirty('cell-6')).toBe(true)
    // Their bytes land: one slot, one push.
    const r = ledger.drain(plans, h.write, h.push)
    expect(r.written).toEqual(['cell-6'])
    expect(h.pushes.length).toBe(2)
  })

  it('a per-frame step noted on the ledger is not written again by the next plan diff', () => {
    const ledger = new PaintLedger()
    const plans = page(3)
    baked(ledger, plans)
    expect(ledger.note('cell-1', 'aHeat', [0.5])).toBe(true)
    expect(ledger.note('cell-1', 'aHeat', [0.5])).toBe(false)
    plans.set('cell-1', { ...plans.get('cell-1')!, aHeat: [0.5] })
    ledger.dirty('cell-1', 'heat')
    const h = harness()
    const r = ledger.drain(plans, h.write, h.push)
    expect(r.written).toEqual([])
    expect(h.pushes).toEqual([])
  })

  it('a page-level request that finds the page converged settles without a drain', () => {
    const ledger = new PaintLedger()
    ledger.dirtyAll('request')
    expect(ledger.full).toBe('request')
    expect(ledger.pending).toBe(false)
    ledger.settle()
    expect(ledger.full).toBeNull()
  })

  it('a rebuild adopts every fresh slot and counts as one push', () => {
    const ledger = new PaintLedger()
    const plans = page(6)
    ledger.dirty('cell-1', 'tile:saved')
    ledger.adoptAll([...plans], 'build', 15)
    expect(ledger.pending).toBe(false)
    expect(ledger.audit.slots).toBe(6)
    expect(ledger.audit.pushes).toBe(1)
    expect(ledger.audit.bufferUpdates).toBe(15)
    expect(ledger.audit.byReason).toEqual({ build: 6 })
  })

  it('reset after a buffer rebuild: fresh slots are adopted, not diffed', () => {
    const ledger = new PaintLedger()
    const plans = page(4)
    baked(ledger, plans)
    ledger.dirty('cell-1', 'tile:saved')
    ledger.reset()
    expect(ledger.pending).toBe(false)
    expect(ledger.paintedCount).toBe(0)
    for (const [label, plan] of plans) ledger.adopt(label, plan)
    ledger.dirtyAll('location')
    const h = harness()
    const r = ledger.drain(plans, h.write, h.push, { full: true })
    expect(r.written).toEqual([])
    expect(ledger.full).toBeNull()
  })
})

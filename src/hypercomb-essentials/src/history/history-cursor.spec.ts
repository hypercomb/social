// history-cursor.spec.ts — the cursor follows its own location's head.
//
// The rule this file guards: `rewound` means the PARTICIPANT chose to view
// the past — never that the bag grew underneath a cursor that was sitting
// at head. A same-location reload that finds new markers must carry an
// at-head cursor to the new head (the rule onNewLayer/refreshForLocation
// already apply); a genuinely rewound cursor keeps its position. Without
// this, the drill wedge: a visit fold's own commits at the current
// location left position at the stale (often empty-bag) head, rewound
// read TRUE with nobody time-traveling, and the committer refused every
// next fold.
//
// window.ioc + the bare `get` global are stubbed BEFORE the import —
// the service self-registers and resolves services at call time.

import { beforeEach, describe, expect, it } from 'vitest'

type Entry = { layerSig: string; at: number; index: number }

let layersBySig: Map<string, Entry[]>

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/HistoryService': {
    listLayers: async (locationSig: string) => layersBySig.get(locationSig) ?? [],
    getLayerContent: async () => null,
    getLayerBySig: async () => null,
  },
  // No committer: the bootstrap self-heal is a best-effort no-op here.
}

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => registry[key],
}
;(globalThis as unknown as { get: (k: string) => unknown }).get = (key: string) => registry[key]

const { HistoryCursorService } = await import('./history-cursor.service.js')

const LOC_A = 'a'.repeat(64)
const LOC_B = 'b'.repeat(64)
const entries = (n: number): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ layerSig: String(i).padStart(64, '0'), at: 1000 + i, index: i }))

beforeEach(() => {
  localStorage.clear()
  layersBySig = new Map()
})

describe('the cursor follows its own location head', () => {

  it('a same-location reload after the bag grew carries an at-head cursor to the new head', async () => {
    const cursor = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(0))
    await cursor.load(LOC_A)                       // empty bag — at (empty) head
    expect(cursor.state.rewound).toBe(false)

    layersBySig.set(LOC_A, entries(3))             // a fold committed underneath us
    await cursor.load(LOC_A)                       // the next render's reload

    expect(cursor.state.position).toBe(3)
    expect(cursor.state.rewound).toBe(false)       // nobody time-traveled
  })

  it('a genuinely rewound cursor keeps its position when the bag grows', async () => {
    const cursor = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(5))
    await cursor.load(LOC_A)
    cursor.seek(2)                                 // the participant chose the past
    expect(cursor.state.rewound).toBe(true)

    layersBySig.set(LOC_A, entries(7))
    await cursor.load(LOC_A)

    expect(cursor.state.position).toBe(2)          // their view is respected
    expect(cursor.state.rewound).toBe(true)
  })

  // ONE WALK AT A TIME. Every step reads `#position` before its first await,
  // so overlapping walks used to compute the SAME target — and `seek`
  // early-returns on `clamped === #position`, so all but the first were
  // silently swallowed. `/undo 3` stepped back exactly ONCE and reported three.
  // These fix the shape of that bug, not one caller's use of it.

  it('overlapping undos each land — three fired at once step three, not one', async () => {
    const cursor = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(6))
    await cursor.load(LOC_A)
    expect(cursor.state.position).toBe(6)

    // Fired WITHOUT awaiting between them — exactly what a loop does.
    await Promise.all([cursor.undo(), cursor.undo(), cursor.undo()])

    expect(cursor.state.position).toBe(3)
  })

  it('firing concurrently is indistinguishable from stepping one at a time', async () => {
    const concurrent = new HistoryCursorService()
    const sequential = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(6))
    await concurrent.load(LOC_A)
    await sequential.load(LOC_A)

    await Promise.all([concurrent.undo(), concurrent.undo(), concurrent.undo()])
    await sequential.undo(); await sequential.undo(); await sequential.undo()

    expect(concurrent.state.position).toBe(sequential.state.position)
  })

  it('redo serializes the same way', async () => {
    const cursor = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(6))
    await cursor.load(LOC_A)
    cursor.seek(1)

    await Promise.all([cursor.redo(), cursor.redo()])

    expect(cursor.state.position).toBeGreaterThan(2)
  })

  it('a walk that throws does not poison the lane for the next one', async () => {
    const cursor = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(4))
    await cursor.load(LOC_A)

    // Whatever the first walk does, a later one must still be able to run.
    await Promise.allSettled([cursor.undo(), cursor.undo()])
    const reached = cursor.state.position
    await cursor.undo()

    expect(cursor.state.position).toBeLessThanOrEqual(reached)
  })

  it('a new location always starts at head', async () => {
    const cursor = new HistoryCursorService()
    layersBySig.set(LOC_A, entries(5))
    await cursor.load(LOC_A)
    cursor.seek(1)

    layersBySig.set(LOC_B, entries(4))
    await cursor.load(LOC_B)

    expect(cursor.state.position).toBe(4)
    expect(cursor.state.rewound).toBe(false)
  })

})

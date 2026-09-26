// ring-ahead.spec.ts — the ring follows the reader by name.
//
// A reader's arrival keeps the tree local only a ring ahead of where they
// stand (hive-visit.boot.drone.ts). A place below the preview root has no
// head of its own, so the drone finds its layer by name down the tree:
//   1. each name is matched among its parent's children;
//   2. a child slot holding a META ENVELOPE is stepped through to the layer it
//      names, and the name matched there;
//   3. a name that is not there is no place — null, never a guess.

import { beforeAll, describe, expect, it } from 'vitest'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
  whenReady: () => void 0,
}

let layerBelow: typeof import('./hive-visit.boot.drone.js').layerBelow

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)

const ROOT = SIG('1')
const JOURNAL = SIG('2')
const ENTRY_EDGE = SIG('3')
const ENTRY = SIG('4')
const LOUNGE = SIG('5')

const records: Record<string, Record<string, unknown>> = {
  [ROOT]: { name: 'revolucion', children: [LOUNGE, JOURNAL] },
  [LOUNGE]: { name: 'lounge' },
  [JOURNAL]: { name: 'journal', children: [ENTRY_EDGE] },
  [ENTRY_EDGE]: { meta: 1, layer: ENTRY, relation: 'children' },
  [ENTRY]: { name: 'first-entry' },
}
const read = async (sig: string) => records[sig] ?? null

beforeAll(async () => {
  ;({ layerBelow } = await import('./hive-visit.boot.drone.js'))
})

describe('layerBelow — the place a reader stands, found by name', () => {
  it('matches each name among its parent\'s children', async () => {
    expect(await layerBelow(ROOT, ['journal'], read)).toBe(JOURNAL)
    expect(await layerBelow(ROOT, ['Lounge'], read)).toBe(LOUNGE)
  })

  it('steps through a meta envelope to the layer it names', async () => {
    expect(await layerBelow(ROOT, ['journal', 'first-entry'], read)).toBe(ENTRY)
  })

  it('a name that is not there is no place', async () => {
    expect(await layerBelow(ROOT, ['journal', 'nowhere'], read)).toBeNull()
    expect(await layerBelow(ROOT, ['missing'], read)).toBeNull()
  })

  it('no names is the root itself', async () => {
    expect(await layerBelow(ROOT, [], read)).toBe(ROOT)
  })
})

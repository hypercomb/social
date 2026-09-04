// tutorial/tutorial-provenance.spec.ts — the sub-bucket is the location's ADDRESS.

import { describe, expect, it, vi } from 'vitest'

const LOC = 'a'.repeat(64)

const docs = new Map<string, ArrayBuffer>()
const store = {
  getPool: async () => ({ name: 'pool' } as unknown as FileSystemDirectoryHandle),
  getPoolDoc: async (_p: unknown, subKey?: string) => docs.get(String(subKey)) ?? null,
  putPoolDoc: async (_p: unknown, bytes: ArrayBuffer, subKey?: string) => { docs.set(String(subKey), bytes); return 'd'.repeat(64) },
}
let history: { sign?: (l: { explorerSegments: () => readonly string[] }) => Promise<string>; getLayerBySig: () => Promise<null> } = {
  sign: async l => (l.explorerSegments().join('/') === 'business/people' ? LOC : 'b'.repeat(64)),
  getLayerBySig: async () => null,
}

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
})
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => key === '@hypercomb.social/Store' ? store
    : key === '@diamondcoreprocessor.com/HistoryService' ? history : undefined,
  register: () => {}, whenReady: () => {},
}

import { clearTutorialRecord, readTutorialRecord, writeTutorialRecord } from './tutorial-provenance.js'

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer

describe('the tutorial record', () => {
  it('is written under the location SIGNATURE, never a path string', async () => {
    docs.clear()
    await writeTutorialRecord({ label: 'weekly-planner', segments: ['business', 'people'], plannerSig: null, coverSigs: [], updatedAt: 1 })
    expect([...docs.keys()]).toEqual([LOC])
    expect((await readTutorialRecord(['business', 'people']))?.label).toBe('weekly-planner')
  })

  it('still reads a record written under the legacy path key — nothing is rewritten', async () => {
    docs.clear()
    docs.set('tutorial:planner:business/people', enc({ label: 'old', segments: ['business', 'people'], plannerSig: null, coverSigs: [], updatedAt: 1 }))
    expect((await readTutorialRecord(['business', 'people']))?.label).toBe('old')
    expect(docs.size).toBe(1)
  })

  it('a tombstone reads as absent, and lands at the address too', async () => {
    docs.clear()
    await clearTutorialRecord(['business', 'people'])
    expect([...docs.keys()]).toEqual([LOC])
    expect(await readTutorialRecord(['business', 'people'])).toBeNull()
  })

  it('with no signer there is no address, and therefore no write', async () => {
    docs.clear()
    const saved = history
    history = { getLayerBySig: async () => null }
    try {
      await writeTutorialRecord({ label: 'x', segments: ['a'], plannerSig: null, coverSigs: [], updatedAt: 1 })
      expect(docs.size).toBe(0)
    } finally { history = saved }
  })
})

// tutorial/tutorial-provenance.spec.ts — the sub-bucket is the WORD's address.

import { describe, expect, it, vi } from 'vitest'
import { moleculeAddress } from '@hypercomb/core'

/** The interim path-derived address the fixture's signer mints for business/people. */
const PATH_LOC = 'a'.repeat(64)

const docs = new Map<string, ArrayBuffer>()
const store = {
  getPool: async () => ({ name: 'pool' } as unknown as FileSystemDirectoryHandle),
  getPoolDoc: async (_p: unknown, subKey?: string) => docs.get(String(subKey)) ?? null,
  putPoolDoc: async (_p: unknown, bytes: ArrayBuffer, subKey?: string) => { docs.set(String(subKey), bytes); return 'd'.repeat(64) },
}
let history: { sign?: (l: { explorerSegments: () => readonly string[] }) => Promise<string>; getLayerBySig: () => Promise<null> } = {
  sign: async l => (l.explorerSegments().join('/') === 'business/people' ? PATH_LOC : 'b'.repeat(64)),
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
  it('is written under the WORD\'s molecule address — never a path, hashed or spelled', async () => {
    docs.clear()
    await writeTutorialRecord({ label: 'weekly-planner', segments: ['business', 'people'], plannerSig: null, coverSigs: [], updatedAt: 1 })
    expect([...docs.keys()]).toEqual([await moleculeAddress('people')])
    expect((await readTutorialRecord(['business', 'people']))?.label).toBe('weekly-planner')
    // The same word at another route is the same molecule, so the same record.
    expect((await readTutorialRecord(['clubs', 'People']))?.label).toBe('weekly-planner')
  })

  it('still reads a record written under the interim path-derived address, or the legacy path key — nothing is rewritten', async () => {
    docs.clear()
    docs.set(PATH_LOC, enc({ label: 'interim', segments: ['business', 'people'], plannerSig: null, coverSigs: [], updatedAt: 1 }))
    expect((await readTutorialRecord(['business', 'people']))?.label).toBe('interim')
    docs.clear()
    docs.set('tutorial:planner:business/people', enc({ label: 'old', segments: ['business', 'people'], plannerSig: null, coverSigs: [], updatedAt: 1 }))
    expect((await readTutorialRecord(['business', 'people']))?.label).toBe('old')
    expect(docs.size).toBe(1)
  })

  it('a tombstone reads as absent, and lands at the address too', async () => {
    docs.clear()
    await clearTutorialRecord(['business', 'people'])
    expect([...docs.keys()]).toEqual([await moleculeAddress('people')])
    expect(await readTutorialRecord(['business', 'people'])).toBeNull()
  })

  it('at the root there is no word, no address, and therefore no write — with or without a signer', async () => {
    docs.clear()
    await writeTutorialRecord({ label: 'x', segments: [], plannerSig: null, coverSigs: [], updatedAt: 1 })
    expect(docs.size).toBe(0)
    const saved = history
    history = { getLayerBySig: async () => null }
    try {
      await writeTutorialRecord({ label: 'x', segments: ['a'], plannerSig: null, coverSigs: [], updatedAt: 1 })
      expect([...docs.keys()]).toEqual([await moleculeAddress('a')])
    } finally { history = saved }
  })
})

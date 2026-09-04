// history/marker-meta.spec.ts — the marker is immutable; the annotation is a record.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { poolKindOfMeaning } from '@hypercomb/core'
import {
  MARKER_META_MEANING, listMarkerMetaRecords, readMarkerMetaRecord, writeMarkerMetaRecord, type MarkerMetaStore,
} from './marker-meta.js'

const LAYER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const RECEIPT = 'c'.repeat(64)

/** A store fake with the document-pool contract: one current member per sub-bucket. */
const fake = () => {
  const buckets = new Map<string, { name: string; bytes: ArrayBuffer }>()
  const pool = {
    name: 'pool',
    kind: 'directory',
    async *entries() {
      for (const [sub, doc] of buckets) {
        yield [sub, {
          kind: 'directory',
          async *entries() { yield [doc.name, { kind: 'file', getFile: async () => ({ arrayBuffer: async () => doc.bytes }) }] },
        }]
      }
    },
  } as unknown as FileSystemDirectoryHandle
  const store: MarkerMetaStore & { writes: number } = {
    writes: 0,
    getPool: async () => pool,
    getPoolDoc: async (_p, subKey) => buckets.get(String(subKey))?.bytes ?? null,
    putPoolDoc: async (_p, bytes, subKey) => {
      store.writes++
      buckets.set(String(subKey), { name: 'd'.repeat(64), bytes })
      return 'd'.repeat(64)
    },
  }
  return store
}

describe('the pool', () => {
  it('is a DOCUMENT — per-participant, replaced in place, never wipe-safe', () => {
    expect(poolKindOfMeaning(MARKER_META_MEANING)?.kind).toBe('document')
    expect(poolKindOfMeaning(MARKER_META_MEANING)?.wipeSafe).toBe(false)
  })
})

describe('writeMarkerMetaRecord', () => {
  it('writes one record keyed by the layer sig, and a later patch merges over it', async () => {
    const store = fake()
    const where = { layer: LAYER, location: OTHER, marker: '00000003' }
    const first = await writeMarkerMetaRecord(store, where, { label: '  before lunch ', marked: true })
    expect(first).toMatchObject({ layer: LAYER, location: OTHER, marker: '00000003', label: 'before lunch', marked: true })
    const second = await writeMarkerMetaRecord(store, where, { prune: RECEIPT })
    expect(second).toMatchObject({ label: 'before lunch', marked: true, prune: RECEIPT })
    expect((await readMarkerMetaRecord(store, LAYER))?.prune).toBe(RECEIPT)
    expect(store.writes).toBe(2)
  })

  it('drops a field on "", false, [] or null, ignores undefined, and refuses reserved keys', async () => {
    const store = fake()
    const where = { layer: LAYER, location: OTHER, marker: '00000001' }
    await writeMarkerMetaRecord(store, where, { label: 'x', marked: true, path: ['a', 'b'] })
    const next = await writeMarkerMetaRecord(store, where, { label: '', marked: false, path: [], layer: OTHER, at: 1 })
    expect(next).not.toHaveProperty('label')
    expect(next).not.toHaveProperty('marked')
    expect(next).not.toHaveProperty('path')
    expect(next?.layer).toBe(LAYER)
    expect(next?.at).not.toBe(1)
    const untouched = await writeMarkerMetaRecord(store, where, { label: undefined })
    expect(untouched).not.toHaveProperty('label')
  })

  it('refuses a non-signature key and a store with no document api — never a false success', async () => {
    expect(await writeMarkerMetaRecord(fake(), { layer: 'nope', location: OTHER, marker: '00000001' }, { marked: true })).toBeNull()
    expect(await writeMarkerMetaRecord({ getPool: async () => undefined }, { layer: LAYER, location: OTHER, marker: '00000001' }, { marked: true })).toBeNull()
    expect(await readMarkerMetaRecord(undefined, LAYER)).toBeNull()
  })
})

describe('listMarkerMetaRecords', () => {
  it('lists one current record per bucket, and nothing from an empty pool', async () => {
    const store = fake()
    expect(await listMarkerMetaRecords(store)).toEqual([])
    await writeMarkerMetaRecord(store, { layer: LAYER, location: OTHER, marker: '00000001' }, { marked: true })
    await writeMarkerMetaRecord(store, { layer: OTHER, location: OTHER, marker: '00000002' }, { label: 'quiet' })
    const rows = await listMarkerMetaRecords(store)
    expect(rows.map(r => r.layer).sort()).toEqual([LAYER, OTHER].sort())
    expect(rows.find(r => r.layer === LAYER)?.marked).toBe(true)
  })
})

describe('the history service', () => {
  it('never rewrites a marker file, and the delta-record path is gone', () => {
    const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'history', 'history.service.ts'), 'utf8')
    for (const name of ['setMarkerMeta', 'stampMarkerSig']) {
      const start = src.indexOf(`public readonly ${name} = async`)
      expect(start).toBeGreaterThan(-1)
      const body = src.slice(start, src.indexOf('\n  }\n', start))
      expect(body.includes('createWritable')).toBe(false)
      expect(body.includes('writeMarkerMetaRecord(')).toBe(true)
    }
    expect(src.includes('mechanical delta-record primitives')).toBe(false)
    expect(src.includes('hydratedStateAt')).toBe(false)
    expect(src.includes('delta-record')).toBe(false)
  })
})

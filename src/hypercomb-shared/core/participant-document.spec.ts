// hypercomb-shared/core/participant-document.spec.ts
//
// The four localStorage stores became document pools behind one class. This
// proves the class: legacy read as the first value, the pool winning once it
// answers, writes going THROUGH to the pool and never back to localStorage,
// an early edit outliving a late disk, and reads that never mint.

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ParticipantDocument, legacyJson, type DocumentStoreLike } from './participant-document'

type Rec = { n: number }
const parse = (raw: unknown): Rec | null =>
  raw && typeof raw === 'object' && typeof (raw as Rec).n === 'number' ? { n: (raw as Rec).n } : null

const text = (b: ArrayBuffer): string => new TextDecoder().decode(b)
const bytes = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }

/** A store fake: pools exist only once WRITTEN; documents keyed by pool + sub-bucket. */
const fake = (seed: Record<string, unknown> = {}) => {
  const pools = new Set<string>(Object.keys(seed).map(k => k.split('|')[0]!))
  const docs = new Map<string, ArrayBuffer>(Object.entries(seed).map(([k, v]) => [k, bytes(v)]))
  const handle = (m: string) => ({ name: m } as unknown as FileSystemDirectoryHandle)
  const log: string[] = []
  const store: DocumentStoreLike & { docs: Map<string, ArrayBuffer>; log: string[]; puts: number } = {
    docs, log, puts: 0,
    initialize: async () => { log.push('init') },
    openPool: async m => { log.push(`open:${m}`); return pools.has(m) ? handle(m) : null },
    getPool: async m => { log.push(`create:${m}`); pools.add(m); return handle(m) },
    getPoolDoc: async (pool, subKey) => docs.get(`${pool!.name}|${subKey ?? ''}`) ?? null,
    putPoolDoc: async (pool, b, subKey) => { store.puts++; docs.set(`${pool.name}|${subKey ?? ''}`, b); return 'f'.repeat(64) },
  }
  return store
}

/** A readiness hook the test fires by hand. */
const readiness = () => {
  let fire: ((s: DocumentStoreLike) => void) | null = null
  return {
    whenStore: (ready: (s: DocumentStoreLike) => void) => { fire = ready },
    ready: (s: DocumentStoreLike) => fire?.(s),
  }
}

describe('ParticipantDocument', () => {
  beforeEach(() => localStorage.clear())

  it('starts from the legacy read, and the pool wins once it answers', async () => {
    localStorage.setItem('legacy', JSON.stringify({ n: 1 }))
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, legacy: () => legacyJson('legacy'), whenStore: r.whenStore })
    expect(doc.value).toEqual({ n: 1 })
    expect(doc.hydrated).toBe(false)
    let changes = 0
    doc.addEventListener('change', () => changes++)
    r.ready(fake({ 'test:doc|': { n: 2 } }))
    await settle()
    expect(doc.value).toEqual({ n: 2 })
    expect(doc.hydrated).toBe(true)
    expect(changes).toBe(1)
  })

  it('reads with the read-only open and never creates a pool', async () => {
    localStorage.setItem('legacy', JSON.stringify({ n: 1 }))
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, legacy: () => legacyJson('legacy'), whenStore: r.whenStore })
    const store = fake()
    r.ready(store)
    await settle()
    expect(doc.value).toEqual({ n: 1 })           // the legacy value stands
    expect(store.log).toEqual(['init', 'open:test:doc'])
    expect(store.log.some(l => l.startsWith('create:'))).toBe(false)
  })

  it('a write before the store is ready is held, then lands — and localStorage is never written', async () => {
    localStorage.setItem('legacy', JSON.stringify({ n: 1 }))
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, legacy: () => legacyJson('legacy'), whenStore: r.whenStore })
    doc.write({ n: 5 })
    expect(doc.value).toEqual({ n: 5 })
    const store = fake()
    r.ready(store)
    await settle()
    expect(text(store.docs.get('test:doc|')!)).toBe('{"n":5}')
    expect(localStorage.getItem('legacy')).toBe(JSON.stringify({ n: 1 }))   // untouched, never advanced
  })

  it('an edit made before the disk answered is newer than the disk', async () => {
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, whenStore: r.whenStore })
    doc.write({ n: 7 })
    r.ready(fake({ 'test:doc|': { n: 2 } }))
    await settle()
    expect(doc.value).toEqual({ n: 7 })
  })

  it('coalesces a burst of writes — the last one is what lands', async () => {
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, whenStore: r.whenStore })
    const store = fake()
    r.ready(store)
    await settle()
    doc.write({ n: 1 }); doc.write({ n: 2 }); doc.write({ n: 3 })
    await settle()
    expect(text(store.docs.get('test:doc|')!)).toBe('{"n":3}')
    expect(store.puts).toBeLessThanOrEqual(2)
  })

  it('keeps sub-bucket documents apart', async () => {
    const r = readiness()
    const a = new ParticipantDocument<Rec>({ meaning: 'test:doc', subKey: 'a', parse, empty: { n: 0 }, whenStore: r.whenStore })
    const store = fake({ 'test:doc|b': { n: 9 } })
    r.ready(store)
    await settle()
    expect(a.value).toEqual({ n: 0 })
    a.write({ n: 4 })
    await settle()
    expect(text(store.docs.get('test:doc|a')!)).toBe('{"n":4}')
    expect(text(store.docs.get('test:doc|b')!)).toBe('{"n":9}')
  })

  it('rejects garbage on disk and keeps what it had', async () => {
    localStorage.setItem('legacy', JSON.stringify({ n: 1 }))
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, legacy: () => legacyJson('legacy'), whenStore: r.whenStore })
    r.ready(fake({ 'test:doc|': ['not', 'a', 'record'] }))
    await settle()
    expect(doc.value).toEqual({ n: 1 })
  })
})

describe('the four stores', () => {
  const files = ['saved-locations-store.ts', 'pinned-entrances.store.ts', 'recent-portals.store.ts', 'icon-override.store.ts']

  it('never write localStorage again — the record is the document', () => {
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), 'hypercomb-shared', 'core', f), 'utf8')
      expect(src.includes('localStorage.setItem('), f).toBe(false)
      expect(src.includes('localStorage.removeItem('), f).toBe(false)
      expect(src.includes('ParticipantDocument'), f).toBe(true)
    }
  })
})

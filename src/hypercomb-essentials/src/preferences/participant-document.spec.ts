// preferences/participant-document.spec.ts
//
// What participants make moved out of localStorage into document pools behind
// one class. This proves the class: the legacy key as the first value, the
// pool winning once it answers, writes going through to the pool and never
// back to localStorage, an early edit outliving a late disk, reads that never
// mint — and that no store it serves still writes localStorage.

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ParticipantDocument, type DocumentStoreLike } from './participant-document.js'

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
  const created: string[] = []
  const store: DocumentStoreLike & { docs: Map<string, ArrayBuffer>; created: string[] } = {
    docs, created,
    initialize: async () => {},
    openPool: async m => pools.has(m) ? handle(m) : null,
    getPool: async m => { created.push(m); pools.add(m); return handle(m) },
    getPoolDoc: async (pool, subKey) => docs.get(`${pool!.name}|${subKey ?? ''}`) ?? null,
    putPoolDoc: async (pool, b, subKey) => { docs.set(`${pool.name}|${subKey ?? ''}`, b); return 'f'.repeat(64) },
  }
  return store
}

const readiness = () => {
  let fire: ((s: DocumentStoreLike) => void) | null = null
  return {
    whenStore: (ready: (s: DocumentStoreLike) => void) => { fire = ready },
    ready: (s: DocumentStoreLike) => fire?.(s),
  }
}

describe('ParticipantDocument (essentials)', () => {
  beforeEach(() => localStorage.clear())

  it('starts from the legacy key, and the pool wins once it answers', async () => {
    localStorage.setItem('legacy', JSON.stringify({ n: 1 }))
    const r = readiness()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, legacyKey: 'legacy', whenStore: r.whenStore })
    expect(doc.value).toEqual({ n: 1 })
    let changes = 0
    doc.addEventListener('change', () => changes++)
    r.ready(fake({ 'test:doc|': { n: 2 } }))
    await settle()
    expect(doc.value).toEqual({ n: 2 })
    expect(changes).toBe(1)
    expect(doc.hydrated).toBe(true)
  })

  it('writes through to the pool, never to localStorage', async () => {
    localStorage.setItem('legacy', JSON.stringify({ n: 1 }))
    const r = readiness()
    const store = fake()
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', subKey: 'a', parse, empty: { n: 0 }, legacyKey: 'legacy', whenStore: r.whenStore })
    r.ready(store)
    doc.write({ n: 5 })
    await settle()
    expect(text(store.docs.get('test:doc|a')!)).toBe('{"n":5}')
    expect(localStorage.getItem('legacy')).toBe('{"n":1}')
  })

  it('an edit made before the disk answered outlives the disk', async () => {
    const r = readiness()
    const store = fake({ 'test:doc|': { n: 2 } })
    const doc = new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, whenStore: r.whenStore })
    doc.write({ n: 9 })
    r.ready(store)
    await settle()
    expect(doc.value).toEqual({ n: 9 })
    expect(text(store.docs.get('test:doc|')!)).toBe('{"n":9}')
  })

  it('reading never mints a pool', async () => {
    const r = readiness()
    const store = fake()
    new ParticipantDocument<Rec>({ meaning: 'test:doc', parse, empty: { n: 0 }, whenStore: r.whenStore })
    r.ready(store)
    await settle()
    expect(store.created).toEqual([])
  })

  it('no store it serves writes localStorage any more', () => {
    const root = join(process.cwd(), 'hypercomb-essentials', 'src')
    for (const file of [
      'games/arkanoid/levels.ts',
      'games/solomon/levels.ts',
      'sequence/sequence.service.ts',
      'sequence/frame.service.ts',
      'revolucionstyle.com/journal/journal.service.ts',
    ]) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/localStorage\.(setItem|getItem)/)
    }
  })
})

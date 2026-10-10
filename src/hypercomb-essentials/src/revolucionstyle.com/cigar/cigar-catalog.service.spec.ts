// revolucionstyle.com/cigar/cigar-catalog.service.spec.ts
//
// The catalog index lives in the participant's `cigars:catalog` document, not
// a browser key: a cigar added is written there, and a later load reads it
// back — waiting for the pool rather than settling for the first frame.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Cigar } from '../journal/journal-entry.js'

const pools = new Map<string, ArrayBuffer>()
const resources = new Map<string, string>()
// The test DOM's Blob has no text(): read it the way a browser could, and hand
// back a record that answers text().
const textOf = (blob: Blob): Promise<string> => new Promise(resolve => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.readAsText(blob)
})
const fakeStore = {
  getPool: async (meaning: string) => ({ name: meaning }),
  openPool: async (meaning: string) => (pools.has(meaning) ? { name: meaning } : null),
  getPoolDoc: async (pool: { name: string } | undefined) => (pool ? pools.get(pool.name) ?? null : null),
  putPoolDoc: async (pool: { name: string }, bytes: ArrayBuffer) => { pools.set(pool.name, bytes); return 'sig' },
  putResource: async (blob: Blob) => { const sig = String(resources.size).padStart(64, 'a'); resources.set(sig, await textOf(blob)); return sig },
  getResource: async (sig: string) => (resources.has(sig) ? { text: async () => resources.get(sig)! } as unknown as Blob : null),
}

beforeAll(() => {
  Object.defineProperty(window, 'ioc', {
    configurable: true,
    value: {
      get: (key: string) => (key === '@hypercomb.social/Store' ? fakeStore : undefined),
      register: () => { /* noop */ },
      whenReady: (key: string, cb: (v: unknown) => void) => { if (key === '@hypercomb.social/Store') cb(fakeStore) },
    },
  })
})

const robusto: Cigar = {
  brand: 'Padron', line: '1964', name: 'Anniversary', vitola: 'Robusto',
  wrapper: 'Maduro', origin: 'Nicaragua', strength: 'full' as Cigar['strength'],
}

describe('the cigar catalog index', () => {
  it('is written to its pool document and read back by a later load', async () => {
    const { CigarCatalogService } = await import('./cigar-catalog.service.js')
    const first = new CigarCatalogService()
    const sig = await first.add(robusto)
    await new Promise(r => setTimeout(r, 0))   // the pool write is async

    const index = JSON.parse(new TextDecoder().decode(pools.get('cigars:catalog')!)) as Record<string, string>
    expect(Object.values(index)).toEqual([sig])
    expect(localStorage.getItem('hc:cigar-catalog-index')).toBeNull()

    const later = new CigarCatalogService()
    await later.load()
    expect(later.search('padron').map(c => c.name)).toEqual(['Anniversary'])
  })
})

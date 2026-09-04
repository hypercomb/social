// hypercomb-shared/core/registry-document.spec.ts
//
// The one writer the four participant registries share. What matters:
//
//   1. THE RECORD IS THE DOCUMENT — a write goes through `putPoolDoc` into the
//      registry's own colon-scoped pool, and never touches `putResource` or
//      the old `registry` pool.
//   2. READS WALK BACK, WRITES NEVER DO — a hive whose record is still behind
//      the old pointer (pool member, or the root `0000` props before that)
//      reads it; the document pool wins the moment it holds one.
//   3. A store that cannot take a document THROWS rather than returning a
//      false success, so a caller's catch keeps its in-memory state.

import { describe, expect, it } from 'vitest'
import { readRegistryDocument, writeRegistryDocument, type RegistryStoreLike } from './registry-document.js'

const MEANING = 'registry:names'
const LEGACY_KEY = 'names-master'
const SIG = 'a'.repeat(64)

const enc = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer

/** A directory fake that answers only `getFileHandle(name)` for known files. */
const dir = (name: string, files: Record<string, string> = {}): FileSystemDirectoryHandle => ({
  name,
  kind: 'directory',
  getFileHandle: async (file: string) => {
    if (!(file in files)) throw new DOMException('NotFoundError')
    return { getFile: async () => ({ text: async () => files[file] }) }
  },
} as unknown as FileSystemDirectoryHandle)

interface Fake extends RegistryStoreLike {
  writes: { pool: string; text: string }[]
  resourceWrites: number
}

const fake = (opts: {
  doc?: unknown
  legacyPool?: Record<string, string>
  rootProps?: Record<string, string>
  resources?: Record<string, unknown>
  noDocApi?: boolean
} = {}): Fake => {
  const pools = new Map<string, FileSystemDirectoryHandle>()
  const poolFor = (meaning: string): FileSystemDirectoryHandle => {
    if (!pools.has(meaning)) {
      pools.set(meaning, dir(`pool:${meaning}`, meaning === 'registry' ? opts.legacyPool ?? {} : {}))
    }
    return pools.get(meaning)!
  }
  let current: unknown = opts.doc
  const store: Fake = {
    writes: [],
    resourceWrites: 0,
    getPool: async (meaning) => poolFor(meaning),
    getResource: async (sig) => {
      const value = opts.resources?.[sig]
      return value === undefined ? null : ({ text: async () => JSON.stringify(value) } as unknown as Blob)
    },
    opfsRoot: dir('root', opts.rootProps ? { '0000': JSON.stringify(opts.rootProps) } : {}),
  }
  if (!opts.noDocApi) {
    store.getPoolDoc = async (pool) => {
      if (!pool || pool.name !== `pool:${MEANING}` || current === undefined) return null
      return enc(current)
    }
    store.putPoolDoc = async (pool, bytes) => {
      const text = new TextDecoder().decode(bytes)
      store.writes.push({ pool: pool.name, text })
      current = JSON.parse(text)
      return SIG
    }
  }
  // Anything reaching for the OLD shape is a regression, and it is loud.
  ;(store as unknown as Record<string, unknown>)['putResource'] = async () => { store.resourceWrites++; return SIG }
  return store
}

describe('writeRegistryDocument', () => {
  it('writes the record as the current member of its OWN colon-scoped document pool — no resource, no pointer', async () => {
    const store = fake()
    const sig = await writeRegistryDocument(store, MEANING, { home: '/a/b' })
    expect(sig).toBe(SIG)
    expect(store.writes).toEqual([{ pool: `pool:${MEANING}`, text: '{"home":"/a/b"}' }])
    expect(store.resourceWrites).toBe(0)
  })

  it('throws when the store cannot take a document, rather than reporting a write that did not happen', async () => {
    await expect(writeRegistryDocument(fake({ noDocApi: true }), MEANING, {})).rejects.toThrow(/unavailable/)
  })
})

describe('readRegistryDocument', () => {
  it('reads the document pool first', async () => {
    const store = fake({ doc: { home: '/new' }, legacyPool: { [LEGACY_KEY]: SIG }, resources: { [SIG]: { home: '/old' } } })
    expect(await readRegistryDocument(store, MEANING, LEGACY_KEY)).toEqual({ home: '/new' })
  })

  it('falls back to the legacy pointer in the old `registry` pool when no document exists yet', async () => {
    const store = fake({ legacyPool: { [LEGACY_KEY]: SIG }, resources: { [SIG]: { home: '/old' } } })
    expect(await readRegistryDocument(store, MEANING, LEGACY_KEY)).toEqual({ home: '/old' })
  })

  it('falls back further to the pre-pool root `0000` props file', async () => {
    const store = fake({ rootProps: { [LEGACY_KEY]: SIG }, resources: { [SIG]: { home: '/oldest' } } })
    expect(await readRegistryDocument(store, MEANING, LEGACY_KEY)).toEqual({ home: '/oldest' })
  })

  it('answers null for a fresh hive — nothing anywhere is not a failure', async () => {
    expect(await readRegistryDocument(fake(), MEANING, LEGACY_KEY)).toBeNull()
  })

  it('round-trips: what was written is what is read, and the legacy pointer is no longer consulted', async () => {
    const store = fake({ legacyPool: { [LEGACY_KEY]: SIG }, resources: { [SIG]: { home: '/old' } } })
    await writeRegistryDocument(store, MEANING, { home: '/written' })
    expect(await readRegistryDocument(store, MEANING, LEGACY_KEY)).toEqual({ home: '/written' })
  })
})

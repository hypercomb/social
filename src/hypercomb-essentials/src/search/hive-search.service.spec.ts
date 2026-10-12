// search/hive-search.service.spec.ts — a record is complete, or it is not a record.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { HiveSearchService } from './hive-search.service.js'

const SIG = 'a'.repeat(64)

/** A pool fake: files by name. */
const fakePool = () => {
  const files = new Map<string, string>()
  const pool = {
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && !opts?.create) throw new Error('nf')
      return {
        getFile: async () => ({ text: async () => files.get(name) ?? '' }),
        createWritable: async () => ({ write: async (t: string) => { files.set(name, t) }, close: async () => {} }),
      }
    },
  } as unknown as FileSystemDirectoryHandle
  return { pool, files }
}

const withStore = (pool: FileSystemDirectoryHandle) => {
  const resolve = (key: string) => key === '@hypercomb.social/Store' ? { getPool: async () => pool } : undefined
  // the service resolves its store through the IoC; a bare global is a decoy here
  ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
  vi.stubGlobal('get', resolve)
}

describe('writeRecord', () => {
  it('refuses a TRUNCATED record — not to disk, not to the memo — so the next pass derives again', async () => {
    const { pool, files } = fakePool()
    withStore(pool)
    const service = new HiveSearchService()
    await service.writeRecord(SIG, { v: 1, rows: [], truncated: true })
    expect(files.size).toBe(0)
    expect(await service.readRecord(SIG)).toBeNull()
  })

  it('writes a complete record, and reads it back', async () => {
    const { pool, files } = fakePool()
    withStore(pool)
    const service = new HiveSearchService()
    await service.writeRecord(SIG, { v: 1, rows: [] })
    expect(files.has(SIG)).toBe(true)
    expect(await service.readRecord(SIG)).toMatchObject({ v: 1, rows: [] })
  })

  it('a record without the current derivation stamp is a miss, never an answer (2026-10-12)', async () => {
    // Keyed by the sig alone, a record from the old derivation (a missing
    // manifest read as a leaf) would stay THE record for that content.
    const { pool, files } = fakePool()
    withStore(pool)
    files.set(SIG, JSON.stringify({ v: 1, rows: [] }))
    const service = new HiveSearchService()
    expect(await service.readRecord(SIG)).toBeNull()
    await service.writeRecord(SIG, { v: 1, rows: [] })
    expect(JSON.parse(files.get(SIG)!).derivation).toBeDefined()
    expect(await service.readRecord(SIG)).toMatchObject({ v: 1, rows: [] })
  })
})

describe('warmBranches', () => {
  it('gives every branch of a root too big for one record a record of its own', async () => {
    // A root past the row cap keeps no record, and its derive stops adding
    // branches at the cap — the later branches were never derived at all.
    const { pool, files } = fakePool()
    const sig = (n: number): string => n.toString(16).padStart(64, '0')
    const manifests = new Map<string, unknown[]>([
      [sig(1), [{ sig: sig(2), layer: { name: 'big' } }, { sig: sig(3), layer: { name: 'dolphin' } }]],
      [sig(3), [{ sig: sig(4), layer: { name: 'members' } }]],
    ])
    // 'members' has no manifest; its layer is here and declares no children,
    // so it is provably a leaf (a missing manifest alone no longer says so).
    const layers = new Map<string, Uint8Array>([[sig(4), new TextEncoder().encode(JSON.stringify({ name: 'members' }))]])
    const store = {
      getPool: async () => pool,
      readChildrenManifest: async (s: string) => manifests.get(s) ?? null,
      getLayerLocalBytes: async (s: string) => layers.get(s) ?? null,
    }
    const resolve = (key: string) => key === '@hypercomb.social/Store' ? store : undefined
    ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
    vi.stubGlobal('get', resolve)
    const service = new HiveSearchService()
    // 'big' already has a record; 'dolphin' is the branch the root never reached.
    await service.writeRecord(sig(2), { v: 1, rows: [] })
    await service.warmBranches(sig(1), { nodes: 50 })
    expect(files.has(sig(3))).toBe(true)
    expect((await service.readRecord(sig(3)))?.rows.map(row => row.name)).toEqual(['members'])
  })
})

describe('derive — a missing manifest is not a leaf (2026-10-11/12)', () => {
  // /dolphin/associates/betz: 'associates' had no manifest on this device,
  // so derive read it as a leaf, sealed /dolphin's record as complete, and
  // "find betz /" answered a confident "not found" — permanently, because
  // the record's key (the parent sig) never changes.
  const sig = (n: number): string => n.toString(16).padStart(64, '0')
  const DOLPHIN = sig(10)
  const ASSOCIATES = sig(11)
  const BETZ = sig(12)
  const POINTER = sig(13)
  const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

  /** A store with ONLY the parent's manifest, which inlines the child's layer
   *  (the same layer its bytes hold, unless a case says otherwise). Layer
   *  bytes and resources are local reads, the manifest optimizer's door
   *  records what it is asked, and the history's host-fetching reader is a
   *  spy that must never be called. */
  const setup = (
    childLayer: unknown | null,
    resources: Map<string, string> = new Map(),
    inlined: unknown = childLayer ?? { name: 'associates' },
  ) => {
    const { pool, files } = fakePool()
    const manifests = new Map<string, unknown[]>([[DOLPHIN, [{ sig: ASSOCIATES, layer: inlined }]]])
    const layers = new Map<string, Uint8Array>()
    if (childLayer) layers.set(ASSOCIATES, bytesOf(childLayer))
    const layerReads: string[] = []
    const store = {
      getPool: async () => pool,
      readChildrenManifest: async (s: string) => manifests.get(s) ?? null,
      getLayerLocalBytes: async (s: string) => { layerReads.push(s); return layers.get(s) ?? null },
      getResourceLocal: async (s: string) => (resources.has(s) ? new Blob([resources.get(s)!]) : null),
    }
    const asked: Array<[string, string[]]> = []
    const door = { enqueue: (parent: string, children: readonly string[]) => { asked.push([parent, [...children]]) } }
    const history = { getLayerBySig: vi.fn(async () => null), peekLayerBySig: () => null, childrenManifestFor: async () => null }
    const resolve = (key: string) =>
      key === '@hypercomb.social/Store' ? store
        : key === '@diamondcoreprocessor.com/ManifestOptimizerDrone' ? door
          : key === '@diamondcoreprocessor.com/HistoryService' ? history
            : undefined
    ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
    vi.stubGlobal('get', resolve)
    return { service: new HiveSearchService(), files, manifests, layers, layerReads, asked, history }
  }

  /** The optimize phase's own sequence: derive, then write. */
  const pass = async (service: HiveSearchService) => {
    const record = await service.derive(DOLPHIN, { nodes: 50 })
    if (record) await service.writeRecord(DOLPHIN, record)
    return record
  }

  it('a child with children and no manifest makes the parent TRUNCATED and unwritten, and asks for the manifest', async () => {
    const { service, files, asked } = setup({ name: 'associates', children: [BETZ] })
    const record = await pass(service)
    expect(record?.truncated).toBe(true)
    // the child still has its own row — only the claim of completeness goes
    expect(record?.rows.map(row => row.name)).toEqual(['associates'])
    expect(files.has(DOLPHIN)).toBe(false)
    expect(await service.readRecord(DOLPHIN)).toBeNull()
    // the optimizer's one door is asked to mint the missing manifest
    expect(asked).toEqual([[ASSOCIATES, [BETZ]]])
  })

  it('the hole heals: the asked manifest lands, and the next pass writes the parent whole', async () => {
    const { service, files, manifests, layers } = setup({ name: 'associates', children: [BETZ] })
    expect((await pass(service))?.truncated).toBe(true)
    // what the optimizer's next pass does: mint associates' manifest; betz is here and childless
    manifests.set(ASSOCIATES, [{ sig: BETZ, layer: { name: 'betz' } }])
    layers.set(BETZ, bytesOf({ name: 'betz' }))
    const record = await pass(service)
    expect(record?.truncated).toBeUndefined()
    expect(record?.rows.map(row => row.path.join('/'))).toEqual(['associates', 'associates/betz'])
    expect(files.has(DOLPHIN)).toBe(true)
    expect(files.has(ASSOCIATES)).toBe(true)
  })

  it('asks once, not on each look; a manifest still missing on the next look is held — no reads — until the hold ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(1_000_000)
      const { service, files, asked, layerReads } = setup({ name: 'associates', children: [BETZ] })
      await pass(service)
      await pass(service) // asked before and still missing: held
      expect(asked).toHaveLength(1)
      const reads = layerReads.filter(s => s === ASSOCIATES).length
      expect((await pass(service))?.truncated).toBe(true)
      expect(layerReads.filter(s => s === ASSOCIATES).length).toBe(reads)
      vi.setSystemTime(1_000_000 + 31_000)
      expect((await pass(service))?.truncated).toBe(true)
      expect(layerReads.filter(s => s === ASSOCIATES).length).toBe(reads + 1)
      expect(asked).toHaveLength(1)
      expect(files.has(DOLPHIN)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an ask the optimizer forgot is asked again — after minutes, never on each look (2026-10-12)', async () => {
    // Past its 256 waiters the optimizer drops the longest; for a branch
    // nobody paints, the search is the only thing that will ever ask again.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(1_000_000)
      const { service, files, asked } = setup({ name: 'associates', children: [BETZ] })
      await pass(service)
      vi.setSystemTime(1_000_000 + 31_000) // the hold has ended; the ask is recent
      await pass(service)
      expect(asked).toHaveLength(1)
      vi.setSystemTime(1_000_000 + 301_000)
      expect((await pass(service))?.truncated).toBe(true)
      expect(asked).toEqual([[ASSOCIATES, [BETZ]], [ASSOCIATES, [BETZ]]])
      expect(files.has(DOLPHIN)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a child whose bytes are not here is judged on the layer its parent\'s manifest inlines — childless: a leaf, never fetched (2026-10-12)', async () => {
    // The inlined layer is the child's full layer, the copy history trusts
    // when the bytes are cold; read as a hole, it held every ancestor.
    const { service, files, asked, history } = setup(null)
    const record = await pass(service)
    expect(record?.truncated).toBeUndefined()
    expect(files.has(DOLPHIN)).toBe(true)
    expect(asked).toEqual([])
    // the derived-cache pass reads what is here; it never asks a host
    expect(history.getLayerBySig).not.toHaveBeenCalled()
  })

  it('a child whose bytes are not here and whose inlined layer declares children — truncated, unwritten, asked for, never fetched', async () => {
    const { service, files, asked, history } = setup(null, new Map(), { name: 'associates', children: [BETZ] })
    const record = await pass(service)
    expect(record?.truncated).toBe(true)
    expect(files.has(DOLPHIN)).toBe(false)
    expect(asked).toEqual([[ASSOCIATES, [BETZ]]])
    expect(history.getLayerBySig).not.toHaveBeenCalled()
  })

  it('a record sealed by the OLD derivation is not trusted — not at the parent, not spliced from the child (2026-10-12)', async () => {
    // The incident records: /dolphin sealed "complete" without associates/betz,
    // and associates sealed as a leaf. Both are still on the device.
    const { service, files, asked } = setup({ name: 'associates', children: [BETZ] })
    files.set(DOLPHIN, JSON.stringify({ v: 1, rows: [{ sig: ASSOCIATES, name: 'associates', path: ['associates'], words: 'associates' }] }))
    files.set(ASSOCIATES, JSON.stringify({ v: 1, rows: [] }))
    expect(await service.readRecord(DOLPHIN)).toBeNull()
    expect(await service.readRecord(ASSOCIATES)).toBeNull()
    const record = await pass(service)
    expect(record?.truncated).toBe(true)
    expect(asked).toEqual([[ASSOCIATES, [BETZ]]])
  })

  it('a child-slot POINTER not on this device cannot be known empty — truncated, unwritten', async () => {
    const { service, files, asked } = setup({ name: 'associates', children: POINTER })
    const record = await pass(service)
    expect(record?.truncated).toBe(true)
    expect(files.has(DOLPHIN)).toBe(false)
    expect(asked).toEqual([])
  })

  it('a provably childless child keeps today\'s behaviour — a leaf, and the parent record is complete', async () => {
    const { service, files, asked } = setup({ name: 'associates' })
    const record = await pass(service)
    expect(record?.truncated).toBeUndefined()
    expect(record?.rows.map(row => row.name)).toEqual(['associates'])
    expect(files.has(DOLPHIN)).toBe(true)
    expect(await service.readRecord(DOLPHIN)).toMatchObject(record!)
    expect(asked).toEqual([])
  })

  it('a child-slot pointer that is here and holds no sigs is childless too', async () => {
    const { service, files } = setup({ name: 'associates', children: POINTER }, new Map([[POINTER, '[]']]))
    const record = await pass(service)
    expect(record?.truncated).toBeUndefined()
    expect(files.has(DOLPHIN)).toBe(true)
  })
})

describe('warmBranches — a held hole does not starve the branches after it (2026-10-11/12)', () => {
  it('a branch with a hole is passed over while held, so the shared budget reaches the next branch', async () => {
    // A's subtree has a child whose children cannot be read here — its layer
    // is not here and the child-slot pointer its inlined layer carries is not
    // either (2026-10-12) — so A is never written; re-walked every pass it
    // spent the whole budget first, and B — healthy, after it in root order —
    // never got a record.
    const sig = (n: number): string => n.toString(16).padStart(64, '0')
    const [ROOT, A, B, A1, A2, B1, A1_SLOT] = [20, 21, 22, 23, 24, 25, 26].map(sig)
    const { pool, files } = fakePool()
    const manifests = new Map<string, unknown[]>([
      [ROOT, [{ sig: A, layer: { name: 'a' } }, { sig: B, layer: { name: 'b' } }]],
      [A, [{ sig: A1, layer: { name: 'a1', children: A1_SLOT } }, { sig: A2, layer: { name: 'a2' } }]],
      [B, [{ sig: B1, layer: { name: 'b1' } }]],
    ])
    const layers = new Map<string, Uint8Array>([
      [A2, new TextEncoder().encode(JSON.stringify({ name: 'a2' }))],
      [B1, new TextEncoder().encode(JSON.stringify({ name: 'b1' }))],
    ])
    const store = {
      getPool: async () => pool,
      readChildrenManifest: async (s: string) => manifests.get(s) ?? null,
      getLayerLocalBytes: async (s: string) => layers.get(s) ?? null,
    }
    const resolve = (key: string) => key === '@hypercomb.social/Store' ? store : undefined
    ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
    vi.stubGlobal('get', resolve)
    const service = new HiveSearchService()

    await service.warmBranches(ROOT, { nodes: 2 }) // A spends the whole budget on its hole
    expect(files.has(A)).toBe(false)
    expect(files.has(B)).toBe(false)
    await service.warmBranches(ROOT, { nodes: 2 }) // A is held: B gets the budget
    expect(files.has(A)).toBe(false)
    expect((await service.readRecord(B))?.rows.map(row => row.name)).toEqual(['b1'])
  })
})

describe('search — a holed branch does not hide its healthy siblings (2026-10-12)', () => {
  it('with no root record, a hive search still reads each branch\'s own record — a deep name is found, and it says partial', async () => {
    // ROOT → alpha → deepname, and beta: here, declaring a child that never
    // arrived, so beta has no manifest and ROOT's record is never written.
    // Answering from the root's ring alone dropped every name below it.
    const sig = (n: number): string => n.toString(16).padStart(64, '0')
    const [ROOT, ALPHA, BETA, DEEP, GONE] = [30, 31, 32, 33, 34].map(sig)
    const { pool, files } = fakePool()
    const manifests = new Map<string, unknown[]>([
      [ROOT, [
        { sig: ALPHA, layer: { name: 'alpha', children: [DEEP] } },
        { sig: BETA, layer: { name: 'beta', children: [GONE] } },
      ]],
      [ALPHA, [{ sig: DEEP, layer: { name: 'deepname' } }]],
    ])
    const layers = new Map<string, Uint8Array>([
      [BETA, new TextEncoder().encode(JSON.stringify({ name: 'beta', children: [GONE] }))],
    ])
    const store = {
      getPool: async () => pool,
      readChildrenManifest: async (s: string) => manifests.get(s) ?? null,
      getLayerLocalBytes: async (s: string) => layers.get(s) ?? null,
    }
    const history = { peekLayerBySig: () => null, childrenManifestFor: async () => null }
    const cursor = { currentLayerSig: ROOT }
    const resolve = (key: string) =>
      key === '@hypercomb.social/Store' ? store
        : key === '@diamondcoreprocessor.com/HistoryService' ? history
          : key === '@diamondcoreprocessor.com/HistoryCursorService' ? cursor
            : undefined
    ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
    vi.stubGlobal('get', resolve)
    const service = new HiveSearchService()

    // search-index.drone #warmRoot's own sequence
    const record = await service.derive(ROOT, { nodes: 400 })
    if (record) await service.writeRecord(ROOT, record)
    if (record?.truncated) await service.warmBranches(ROOT, { nodes: 400 })
    expect(files.has(ROOT)).toBe(false)
    expect(files.has(ALPHA)).toBe(true)

    for (const reach of ['hive', 'branch'] as const) {
      const answer = await service.search('deepname', reach)
      expect(answer.hits.map(hit => hit.path.join('/'))).toEqual(['alpha/deepname'])
      expect(answer.partial).toBe(true)
    }
    // the ring itself still answers
    expect((await service.search('beta', 'hive')).hits.map(hit => hit.name)).toEqual(['beta'])
  })
})

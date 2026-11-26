// site-replica.spec.ts — the replica's own rules, outside the view: a nested
// site stands at every segment of its route; "lagging" means moments ago, not
// forever; a take never lands over an edit made since it was decided; and a
// take replaces the whole tree in one queued step, the way the adopt placed it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEPENDENCY_DRAFTS_KIND, DRAFTS_KIND, LAG_WINDOW_MS, lagging, landed, notePublished, readReceipt, reconcile, replicaRoute, replicate, takePublished,
  type ReplicaReceipt, type ReplicaServices,
} from './site-replica'
import { dependencyDraftsListingBytes } from './decoration-closure'

// The sandbox door is read off the page's hostname; a spec says it outright.
const door = vi.hoisted(() => ({ sandbox: false }))
vi.mock('@hypercomb/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@hypercomb/core')>()),
  isSandboxDoor: () => door.sandbox,
}))

const { Blob: NodeBlob } = await import('node:buffer')
const sig = (ch: string): string => ch.repeat(64)
const HEAD = sig('1'), NEWER = sig('7')

const receipt = (over: Partial<ReplicaReceipt> = {}): ReplicaReceipt =>
  ({ kind: 'site:replica', v: 1, lineage: 'business-card', published: NEWER, local: sig('9'), past: [HEAD], at: Date.now(), ...over })

function services(over: Partial<ReplicaServices> = {}, layers: Record<string, unknown> = {}): ReplicaServices & { calls: string[] } {
  const calls: string[] = []
  const heads = new Map<string, { marker: string; sig: string; layer: unknown }>()
  // Node's Blob: jsdom's has no arrayBuffer().
  const blob = (value: unknown): Blob => new NodeBlob([JSON.stringify(value)]) as unknown as Blob
  return {
    calls,
    history: {
      sign: async (l: { explorerSegments: () => string[] }) => `loc:/${l.explorerSegments().join('/')}`,
      currentLayerAt: async (loc: string) => (heads.get(loc)?.layer as never) ?? null,
      headMarkerOf: (loc: string) => heads.get(loc)?.marker ?? null,
      warmHeadSigFor: (loc: string) => heads.get(loc)?.sig ?? null,
      commitLayer: async (loc: string, layer: unknown) => { calls.push(`commit ${loc}`); heads.set(loc, { marker: '2', sig: sig('8'), layer }); return sig('8') },
      getLayerBySig: async (s: string) => (layers[s] as never) ?? null,
      // test hooks
      ...({ __set: (loc: string, marker: string, layer: unknown) => heads.set(loc, { marker, sig: sig('9'), layer }) } as object),
    } as never,
    store: {
      getResource: async (s: string) => (layers[s] ? blob(layers[s]) : null),
      openPool: async () => null,
    },
    ...over,
  }
}

describe('a nested site stands at every segment of its route', () => {
  it('splits the lineage the way the worker’s index names it', () => {
    expect(replicaRoute('business-card')).toEqual(['business-card'])
    expect(replicaRoute('revolucion/meetup')).toEqual(['revolucion', 'meetup'])
    expect(replicaRoute(' revolucion / meetup ')).toEqual(['revolucion', 'meetup'])
  })

  it('is adopted under its parent route, named by its last segment', async () => {
    const adopted: unknown[] = []
    const s = services({ adopt: { adoptResolvedBranch: async (branch: unknown) => { adopted.push(branch); return 'declined' } } })
    await replicate(s, { lineage: 'revolucion/meetup', head: HEAD }, { host: 'meetup.example.com', zone: 'example.com', sources: [] })
    expect(adopted).toEqual([{ layerSig: HEAD, at: ['revolucion'], domain: 'example.com', label: 'meetup' }])
  })
})

describe('lagging means moments ago, never forever', () => {
  it('reads a head the replica just moved past as the page record catching up', () => {
    expect(lagging(receipt(), HEAD)).toBe(true)
  })

  it('reads the same head named long after as a real re-publish, to be followed', () => {
    const old = receipt({ at: Date.now() - LAG_WINDOW_MS - 1000 })
    expect(lagging(old, HEAD)).toBe(false)
  })
})

describe('a take', () => {
  it('never lands over an edit made since it was decided', async () => {
    const s = services({}, { [NEWER]: { name: 'business-card', decorations: [] } })
    ;(s.history as unknown as { __set: (l: string, m: string, layer: unknown) => void }).__set('loc:/business-card', 'B', { name: 'business-card', decorations: ['x'] })
    const taken = await takePublished(s, { lineage: 'business-card', head: NEWER }, { host: 'h', sources: [] }, { marker: 'A' })
    expect(taken).toEqual({ ok: false, error: 'edited' })
    expect(s.calls).toEqual([])
  })

  it('replaces the whole tree in one queued step with the committer’s deliberate replace', async () => {
    const child = sig('c')
    const layers = {
      [NEWER]: { name: 'business-card', decorations: [sig('d')], children: [child] },
      [child]: { name: 'about', decorations: [] },
    }
    const imports: Array<{ updates: Array<{ segments: readonly string[] }>; replace?: boolean }> = []
    const s = services({
      committer: {
        importTree: async (updates, _names, opts) => { imports.push({ updates: updates as never, replace: opts?.replace }) },
        settled: async () => { /* landed */ },
      },
    }, layers)
    ;(s.history as unknown as { __set: (l: string, m: string, layer: unknown) => void }).__set('loc:/business-card', 'A', { name: 'business-card' })
    const taken = await takePublished(s, { lineage: 'business-card', head: NEWER }, { host: 'h', sources: [] }, { marker: 'A' })
    expect(taken.ok).toBe(true)
    expect(imports).toHaveLength(1)
    expect(imports[0]!.replace).toBe(true)
    expect(imports[0]!.updates.map(u => u.segments.join('/'))).toEqual(['business-card', 'business-card/about'])
    expect(s.calls).toEqual([])                       // no single-location commit: the tree went in whole
  })

  it('falls back to the card’s own layer, guarded, where no committer is registered', async () => {
    const s = services({}, { [NEWER]: { name: 'business-card', decorations: [] } })
    ;(s.history as unknown as { __set: (l: string, m: string, layer: unknown) => void }).__set('loc:/business-card', 'A', { name: 'business-card' })
    const taken = await takePublished(s, { lineage: 'business-card', head: NEWER }, { host: 'h', sources: [] }, { marker: 'A' })
    expect(taken.ok).toBe(true)
    expect(s.calls).toEqual(['commit loc:/business-card'])
  })
})

// vi is imported for parity with the other specs' environment.
void vi

// HOME, HELD (jwize, 2026-11-20): a card that carries drafts brings them home
// held — after the card itself is in, only on the owner's own page, and never
// again for a draft this device already settled.
describe('drafts that come home with the card', () => {
  const DREC = sig('5'), ROOT = sig('a'), LAYER = sig('b'), TO = sig('c')
  const carried = { kind: DRAFTS_KIND, appliesTo: ['business-card'], payload: { drafts: [{ root: ROOT, layer: LAYER }] }, refs: [ROOT, LAYER, TO] }
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
  const clearPage = (): void => {
    door.sandbox = false
    delete document.documentElement.dataset['hypercombMode']
    delete (globalThis as { __HC_READONLY__?: unknown }).__HC_READONLY__
  }
  afterEach(clearPage)

  function home(over: {
    owns?: boolean | 'absent'
    status?: 'committed' | 'exists' | 'unavailable'
    outcome?: string
    record?: unknown
    decorations?: string[]
    /** More decorations on the card, by signature (a dependency drafts record). */
    extra?: Record<string, unknown>
  } = {}) {
    const blob = (value: unknown): Blob => new NodeBlob([JSON.stringify(value)]) as unknown as Blob
    const docs = new Map<string, ArrayBuffer>()
    const pool = {} as FileSystemDirectoryHandle
    const heads = new Map<string, { marker: string; sig: string; layer: unknown }>()
    const layers: Record<string, unknown> = {
      [HEAD]: { name: 'business-card', decorations: over.decorations ?? [sig('4'), DREC, ...Object.keys(over.extra ?? {})] },
      [NEWER]: { name: 'business-card', decorations: [DREC] },
    }
    const restored: Array<{ drafts: unknown; lineage: string }> = []
    const fetched: string[] = []
    const publish = over.owns === 'absent'
      ? { publishRoot: async () => ({ ok: false }) }
      : { publishRoot: async () => ({ ok: false }), ownsThisCard: async () => over.owns !== false }
    const s: ReplicaServices = {
      history: {
        sign: async (l: { explorerSegments: () => string[] }) => `loc:/${l.explorerSegments().join('/')}`,
        currentLayerAt: async (loc: string) => (heads.get(loc)?.layer as never) ?? null,
        headMarkerOf: (loc: string) => heads.get(loc)?.marker ?? null,
        warmHeadSigFor: (loc: string) => heads.get(loc)?.sig ?? null,
        commitLayer: async (loc: string, layer: unknown) => { heads.set(loc, { marker: '2', sig: sig('8'), layer }); return sig('8') },
      } as never,
      store: {
        getResource: async (k: string) => (layers[k] ? blob(layers[k]) : null),
        openPool: async () => pool,
        getPool: async () => pool,
        getPoolDoc: async (_p, key) => docs.get(String(key)) ?? null,
        putPoolDoc: async (_p, bytes, key) => { docs.set(String(key), bytes); return 'ok' },
      },
      adopt: {
        adoptResolvedBranch: async () => {
          const status = over.status ?? 'committed'
          if (status !== 'unavailable') heads.set('loc:/business-card', { marker: '1', sig: sig('9'), layer: { name: 'business-card', decorations: [DREC, ...Object.keys(over.extra ?? {})] } })
          return status
        },
      },
      broker: {
        fetchBySig: async (k: string) => {
          fetched.push(k)
          if (k === DREC) return encode(over.record ?? carried)
          if (over.extra && k in over.extra) { const v = over.extra[k]; return ArrayBuffer.isView(v) ? v as Uint8Array : encode(v) }
          if (k === sig('4')) return encode({ kind: 'visual:website:page', payload: {} })
          return null
        },
      },
      publish,
      drafts: {
        restore: async (record, _bytes, lineage) => {
          restored.push({ drafts: record.drafts, lineage })
          return record.drafts.map(d => ({ root: d.root, outcome: (over.outcome ?? 'applied') as never }))
        },
      },
    }
    return { s, restored, fetched, heads }
  }
  const SITE = { lineage: 'business-card', head: HEAD }
  /** The receipt as replicate wrote it, its drafts left unsettled. */
  const writeReceiptFresh = async (s: ReplicaServices): Promise<void> => {
    const now = await readReceipt(s.store, 'business-card')
    const { drafts: _drafts, ...rest } = now!
    await s.store.putPoolDoc!({} as FileSystemDirectoryHandle, new TextEncoder().encode(JSON.stringify(rest)).buffer as ArrayBuffer, 'business-card')
  }
  const WHERE = { host: 'business-card.example.com', zone: 'example.com', sources: [] }

  it('puts them back after the card is in, and the receipt remembers them', async () => {
    const { s, restored } = home()
    const done = await replicate(s, SITE, WHERE)
    expect(done).toMatchObject({ kind: 'replicated', drafts: { home: 1, otherBuild: 0 } })
    expect(restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
    expect((await readReceipt(s.store, 'business-card'))?.drafts).toEqual([ROOT])
  })

  it('a dependency draft in its own record goes only to a runtime that puts it back; to an older one it is neither sent nor settled', async () => {
    const DROOT = sig('d'), DTO = sig('e'), DDREC = sig('6'), LISTING = sig('7')
    // On the card the record names its listing alone; the drafts sit in it.
    const dependencyRecord = { kind: DEPENDENCY_DRAFTS_KIND, appliesTo: ['business-card'], payload: { listing: LISTING }, refs: [LISTING] }
    const listingOf = (refs: string[]) => dependencyDraftsListingBytes({ drafts: [{ root: DROOT, layer: LAYER }], refs })
    const extra = { [DDREC]: dependencyRecord, [LISTING]: listingOf([DROOT, LAYER, DTO]) }
    // An older runtime: the bee draft comes home, the dependency draft waits.
    const old = home({ extra })
    await replicate(old.s, SITE, WHERE)
    expect(old.restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
    expect((await readReceipt(old.s.store, 'business-card'))?.drafts).toEqual([ROOT])
    // Once the runtime can, the same card brings it home on its next load.
    ;(old.s.drafts as { restoresDependencies?: true }).restoresDependencies = true
    expect(await reconcile(old.s, SITE, WHERE)).toEqual({ kind: 'current', drafts: { home: 1, otherBuild: 0 } })
    expect(old.restored.at(-1)).toEqual({ drafts: [{ root: DROOT, layer: LAYER }], lineage: 'business-card' })
    expect((await readReceipt(old.s.store, 'business-card'))?.drafts).toEqual([ROOT, DROOT])
    // A runtime that can takes both at once, bee drafts first.
    const next = home({ extra })
    ;(next.s.drafts as { restoresDependencies?: true }).restoresDependencies = true
    await replicate(next.s, SITE, WHERE)
    expect(next.restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }, { root: DROOT, layer: LAYER }], lineage: 'business-card' }])
    // A dependency entry its refs do not list makes that record unreadable, as a bee entry does; the bee record still comes home.
    const torn = home({ extra: { [DDREC]: dependencyRecord, [LISTING]: listingOf([LAYER, DTO]) } })
    ;(torn.s.drafts as { restoresDependencies?: true }).restoresDependencies = true
    await replicate(torn.s, SITE, WHERE)
    expect(torn.restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
    // A dependency entry in the bee record is not one: it is read as a bee draft, as an older reader reads it.
    const inside = home({ record: { ...carried, payload: { ...carried.payload, dependencies: [{ root: DROOT, layer: LAYER }] }, refs: [ROOT, LAYER, TO, DROOT, DTO] } })
    ;(inside.s.drafts as { restoresDependencies?: true }).restoresDependencies = true
    await replicate(inside.s, SITE, WHERE)
    expect(inside.restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
  })

  it('runs after an adopt that found the card already here, and never after one that did not land', async () => {
    const exists = home({ status: 'exists' })
    await replicate(exists.s, SITE, WHERE)
    expect(exists.restored).toHaveLength(1)
    const cold = home({ status: 'unavailable' })
    await replicate(cold.s, SITE, WHERE)
    expect(cold.restored).toEqual([])
    expect(cold.fetched).toEqual([])
  })

  it('a deferred adopt that lands later brings them home too, once the card is here', async () => {
    const { s, restored, heads } = home({ status: 'unavailable' })
    expect(await replicate(s, SITE, WHERE)).toMatchObject({ kind: 'refused', pending: true })
    expect(restored).toEqual([])
    // The adopt's retry lands the tile; the managed page pays the receipt it owed.
    heads.set('loc:/business-card', { marker: '1', sig: sig('9'), layer: { name: 'business-card', decorations: [DREC] } })
    const late = await landed(s, SITE, sig('9'))
    expect(late).toMatchObject({ receipt: { published: HEAD, local: sig('9') }, drafts: { home: 1, otherBuild: 0 } })
    expect(restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
    expect((await readReceipt(s.store, 'business-card'))?.drafts).toEqual([ROOT])
  })

  it('never on a page that is not the owner\'s, a sandbox door, the visitor shell, a read-only page, or with no owner check', async () => {
    const setUps = [
      () => home({ owns: false }),
      () => home({ owns: 'absent' }),
      () => { door.sandbox = true; return home() },
      () => { document.documentElement.dataset['hypercombMode'] = 'visitor'; return home() },
      () => { (globalThis as { __HC_READONLY__?: unknown }).__HC_READONLY__ = true; return home() },
    ]
    for (const setUp of setUps) {
      const { s, restored } = setUp()
      const done = await replicate(s, SITE, WHERE)
      expect(done.kind).toBe('replicated') // the card itself still comes in
      expect(restored).toEqual([])
      expect((await readReceipt(s.store, 'business-card'))?.drafts).toBeUndefined()
      clearPage()
    }
  })

  it('never puts back a draft this device already settled: one dropped here stays dropped', async () => {
    const { s, restored } = home()
    await replicate(s, SITE, WHERE)
    restored.length = 0
    await replicate(s, SITE, WHERE)
    expect(restored).toEqual([])
  })

  it('tries again next time when the pick was refused, the path is busy, the build differs or the hold failed', async () => {
    for (const outcome of ['gate', 'other-build', 'path-busy', 'unheld']) {
      const { s, restored } = home({ outcome })
      const first = await replicate(s, SITE, WHERE)
      expect((await readReceipt(s.store, 'business-card'))?.drafts).toBeUndefined()
      if (outcome === 'other-build') expect(first).toMatchObject({ drafts: { home: 0, otherBuild: 1 } })
      await replicate(s, SITE, WHERE)
      expect(restored).toHaveLength(2)
    }
  })

  it('settles a draft that failed the checks here: said once, never fetched or owner-checked again', async () => {
    let asked = 0
    const base = home({ outcome: 'tampered' })
    const s: ReplicaServices = { ...base.s, publish: { ownsThisCard: async () => { asked++; return true } } }
    const first = await replicate(s, SITE, WHERE)
    expect(first).toMatchObject({ kind: 'replicated', drafts: { home: 0, otherBuild: 0, tampered: 1 } })
    expect((await readReceipt(s.store, 'business-card'))?.drafts).toEqual([ROOT])
    expect(asked).toBe(1)
    // A later load of the same card owes nothing: no owner check, no restore, nothing said.
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current' })
    expect(asked).toBe(1)
    expect(base.restored).toHaveLength(1)
  })

  it('tries again on a later load of the same card, not only when a newer card arrives', async () => {
    // Over another build here first; then Update all levels the trunks and the card is opened again.
    let outcome = 'other-build'
    const { s, restored } = home()
    s.drafts!.restore = async record => {
      restored.push({ drafts: record.drafts, lineage: '' })
      return record.drafts.map(d => ({ root: d.root, outcome: outcome as never }))
    }
    expect(await reconcile(s, SITE, WHERE)).toMatchObject({ kind: 'replicated', drafts: { home: 0, otherBuild: 1 } })
    outcome = 'applied'
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current', drafts: { home: 1, otherBuild: 0 } })
    expect((await readReceipt(s.store, 'business-card'))?.drafts).toEqual([ROOT])
    // Settled now: the next load asks nothing at all.
    restored.length = 0
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current' })
    expect(restored).toEqual([])
  })

  it('asks whether the card is the owner\'s only once a draft is owed', async () => {
    let asked = 0
    const s: ReplicaServices = { ...home().s, publish: { ownsThisCard: async () => { asked++; return true } } }
    await replicate(s, SITE, WHERE)
    expect(asked).toBe(1)
    await reconcile(s, SITE, WHERE)
    expect(asked).toBe(1)
  })

  it('reads nothing from a record that does not hold together', async () => {
    const broken = [
      { ...carried, refs: [ROOT, TO] }, // the layer is not a declared part
      { ...carried, refs: [ROOT, LAYER, 'not-a-sig'] },
      { ...carried, payload: { drafts: Array.from({ length: 65 }, () => ({ root: ROOT, layer: LAYER })) } },
    ]
    for (const record of broken) {
      const { s, restored } = home({ record })
      await replicate(s, SITE, WHERE)
      expect(restored).toEqual([])
    }
  })

  it("fetches none of the card's decorations on a page that may never hold drafts", async () => {
    const setUps = [
      () => home({ owns: 'absent' }),
      () => { door.sandbox = true; return home() },
      () => { (globalThis as { __HC_READONLY__?: unknown }).__HC_READONLY__ = true; return home() },
    ]
    for (const setUp of setUps) {
      const { s, fetched } = setUp()
      expect((await replicate(s, SITE, WHERE)).kind).toBe('replicated')
      expect(fetched).toEqual([])
      clearPage()
    }
  })

  it('looks for the drafts record a few decorations at a time, never one round trip per decoration', async () => {
    // Twenty decorations and no drafts record: every existing card.
    const many = Array.from({ length: 20 }, (_, i) => (i + 16).toString(16).padStart(2, '0').repeat(32))
    const { s, fetched } = home({ decorations: many })
    let open = 0, most = 0
    s.broker!.fetchBySig = async (k: string) => {
      fetched.push(k)
      open++; most = Math.max(most, open)
      await new Promise(resolve => setTimeout(resolve, 1))
      open--
      return encode({ kind: 'visual:website:page', payload: {} })
    }
    const done = await replicate(s, SITE, WHERE)
    expect(done).toEqual({ kind: 'replicated', receipt: expect.anything() })
    expect(new Set(fetched)).toEqual(new Set(many))
    expect(most).toBeGreaterThan(1)
    expect(most).toBeLessThanOrEqual(8)
  })

  it('once the bee drafts record is found, the rest of the root is read from this device only', async () => {
    // A card with bee drafts and no dependency drafts (every card today): the
    // scan for the second kind never fetches the whole root over the network.
    const many = Array.from({ length: 20 }, (_, i) => (i + 16).toString(16).padStart(2, '0').repeat(32))
    const { s, fetched, restored } = home({ decorations: [...many, DREC] })
    ;(s.drafts as { restoresDependencies?: true }).restoresDependencies = true
    await replicate(s, SITE, WHERE)
    expect(restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
    expect(fetched.length).toBeLessThanOrEqual(8)
    expect(fetched).toContain(DREC)
    // A dependency drafts record further down that is here is still read.
    const DROOT = sig('d'), DDREC = sig('6'), LISTING = sig('7')
    const dependencyRecord = { kind: DEPENDENCY_DRAFTS_KIND, appliesTo: ['business-card'], payload: { listing: LISTING }, refs: [LISTING] }
    const listing = dependencyDraftsListingBytes({ drafts: [{ root: DROOT, layer: LAYER }], refs: [DROOT, LAYER, sig('e')] })
    const local: Record<string, Uint8Array> = { [DDREC]: encode(dependencyRecord), [LISTING]: listing }
    const deep = home({ decorations: [DDREC, ...many, DREC] })
    ;(deep.s.drafts as { restoresDependencies?: true }).restoresDependencies = true
    ;(deep.s.store as { getResourceLocal?: (k: string) => Promise<Blob | null> }).getResourceLocal = async (k: string) =>
      (local[k] ? new NodeBlob([local[k]]) as unknown as Blob : null)
    await replicate(deep.s, SITE, WHERE)
    expect(deep.restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }, { root: DROOT, layer: LAYER }], lineage: 'business-card' }])
    expect(deep.fetched).not.toContain(DDREC)
    expect(deep.fetched.length).toBeLessThanOrEqual(8)
  })

  it('reads the newest drafts record when several wear the root in one round', async () => {
    const OLDER = sig('6')
    const older = { ...carried, payload: { drafts: [{ root: TO, layer: LAYER }] }, refs: [TO, LAYER] }
    const { s, restored } = home({ decorations: [OLDER, sig('4'), DREC] })
    const plain = s.broker!.fetchBySig!
    s.broker!.fetchBySig = async (k: string, kind?: string) => k === OLDER ? encode(older) : plain(k, kind as never)
    await replicate(s, SITE, WHERE)
    expect(restored).toEqual([{ drafts: [{ root: ROOT, layer: LAYER }], lineage: 'business-card' }])
  })

  it('puts them back after a newer card is taken', async () => {
    const { s, restored, heads } = home()
    heads.set('loc:/business-card', { marker: 'A', sig: sig('9'), layer: { name: 'business-card' } })
    const taken = await takePublished(s, { lineage: 'business-card', head: NEWER }, WHERE, { marker: 'A' })
    expect(taken).toMatchObject({ ok: true, drafts: { home: 1, otherBuild: 0 } })
    expect(restored).toHaveLength(1)
    expect(await readReceipt(s.store, 'business-card')).toMatchObject({ published: NEWER, drafts: [ROOT] })
  })

  it('settles the drafts its own Publish carried: dropped here after it, one never comes back on a reload', async () => {
    const { s, restored } = home()
    await replicate(s, SITE, WHERE)
    await writeReceiptFresh(s)
    restored.length = 0
    // This device wrote the draft and published the card with it.
    await notePublished(s.store, SITE, HEAD, sig('e'), [ROOT])
    expect((await readReceipt(s.store, 'business-card'))?.drafts).toEqual([ROOT])
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current' })
    expect(restored).toEqual([])
  })

  it('reads the decorations of a current card from this device only: a load never waits on the network for them', async () => {
    const { s, restored, fetched } = home()
    await replicate(s, SITE, WHERE)
    await writeReceiptFresh(s)
    fetched.length = 0
    restored.length = 0
    const local: ReplicaServices = { ...s, store: { ...s.store, getResourceLocal: async () => null } }
    expect(await reconcile(local, SITE, WHERE)).toEqual({ kind: 'current' })
    expect(fetched).toEqual([])
    expect(restored).toEqual([])
    // Held here: read, and owed drafts are tried.
    const blob = (value: unknown): Blob => new NodeBlob([JSON.stringify(value)]) as unknown as Blob
    const held: ReplicaServices = { ...s, store: { ...s.store, getResourceLocal: async (k: string) => (k === DREC ? blob(carried) : null) } }
    expect(await reconcile(held, SITE, WHERE)).toMatchObject({ kind: 'current', drafts: { home: 1 } })
    expect(fetched.includes(DREC)).toBe(false)
  })

  it('a draft over a build held here but not run is said once, never counted as settled, and still tried again', async () => {
    let outcome = 'older-build'
    const { s, restored } = home()
    s.drafts!.restore = async record => {
      restored.push({ drafts: record.drafts, lineage: '' })
      return record.drafts.map(d => ({ root: d.root, outcome: outcome as never }))
    }
    expect(await replicate(s, SITE, WHERE)).toMatchObject({ drafts: { home: 0, otherBuild: 0, olderBuild: 1 } })
    const written = await readReceipt(s.store, 'business-card')
    expect(written?.behind).toEqual([ROOT])
    expect(written?.drafts).toBeUndefined()
    // Tried on the next load, and not said again; the receipt is not rewritten.
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current', drafts: { home: 0, otherBuild: 0 } })
    expect(restored).toHaveLength(2)
    expect(await readReceipt(s.store, 'business-card')).toEqual(written)
    // Kept across the receipt written for a publish.
    await notePublished(s.store, SITE, HEAD, sig('e'))
    expect((await readReceipt(s.store, 'business-card'))?.behind).toEqual([ROOT])
    // The build it was held as behind on activates here (an Update the shell's
    // core first refused): it comes home and leaves `behind`.
    outcome = 'applied'
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current', drafts: { home: 1, otherBuild: 0 } })
    const after = await readReceipt(s.store, 'business-card')
    expect(after?.drafts).toEqual([ROOT])
    expect(after?.behind).toBeUndefined()
  })

  it('settling a draft on a current card keeps the receipt\'s time: a re-publish of a head moved past is still taken', async () => {
    let outcome = 'other-build'
    const { s } = home()
    s.drafts!.restore = async record => record.drafts.map(d => ({ root: d.root, outcome: outcome as never }))
    await replicate(s, SITE, WHERE)
    // Moved past an older head a day ago.
    const OLDER = sig('3')
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const prior = await readReceipt(s.store, 'business-card')
    await s.store.putPoolDoc!({} as FileSystemDirectoryHandle, new TextEncoder().encode(JSON.stringify({ ...prior!, past: [OLDER], at: dayAgo })).buffer as ArrayBuffer, 'business-card')
    outcome = 'applied'
    expect(await reconcile(s, SITE, WHERE)).toEqual({ kind: 'current', drafts: { home: 1, otherBuild: 0 } })
    const settled = await readReceipt(s.store, 'business-card')
    expect(settled).toMatchObject({ drafts: [ROOT], past: [OLDER], at: dayAgo })
    expect(lagging(settled, OLDER)).toBe(false)
  })

  it('finds the record on a card root wearing more than 64 decorations: it is the last one written', async () => {
    const pages = Array.from({ length: 70 }, (_, i) => 'f' + i.toString(16).padStart(63, '0'))
    const { s, restored } = home({ decorations: [...pages, DREC] })
    expect(await replicate(s, SITE, WHERE)).toMatchObject({ kind: 'replicated', drafts: { home: 1 } })
    expect(restored).toHaveLength(1)
    expect((await readReceipt(s.store, 'business-card'))?.drafts).toEqual([ROOT])
  })

  it('a Publish that lands while drafts come home is never put back: only the drafts settle over it', async () => {
    const { s } = home()
    const H2 = sig('d'), L2 = sig('e')
    const restore = s.drafts!.restore!
    // The owner taps Publish while the drafts are still being fetched.
    s.drafts!.restore = async (record, bytes, lineage) => {
      await notePublished(s.store, SITE, H2, L2)
      return restore(record, bytes, lineage)
    }
    await replicate(s, SITE, WHERE)
    const after = await readReceipt(s.store, 'business-card')
    expect(after).toMatchObject({ published: H2, local: L2, drafts: [ROOT] })
    expect(after!.past).toContain(HEAD)
  })

  it('keeps what was settled when the receipt is written again for a publish', async () => {
    const { s } = home()
    await replicate(s, SITE, WHERE)
    await notePublished(s.store, SITE, sig('d'), sig('e'))
    expect(await readReceipt(s.store, 'business-card')).toMatchObject({ published: sig('d'), drafts: [ROOT] })
  })
})

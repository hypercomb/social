// hive-take.spec.ts — HOME, HELD ON THE HIVE (jwize, 2026-11-20): a card
// published from its own page is taken into the hive only when the hive's own
// signed index, read now, names that head; never a head the hive published
// itself; never with a layer missing; and its drafts come home held through
// the same take a card's page makes.

import { describe, expect, it, vi } from 'vitest'
import { DRAFTS_RETRY_FIRST_MS, DRAFTS_RETRY_LONGEST_MS, draftsRetryPace, hiveIndexNames, retryTakenDrafts, takeFromElsewhere, type HiveTakeDeps, type HiveTakeRow } from './hive-take'
import { DRAFTS_KIND, readReceipt, type ReplicaServices } from './site-replica'
import type { HiveIndexResult } from './hive-pointer'

vi.mock('@hypercomb/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@hypercomb/core')>()),
  isSandboxDoor: () => false,
}))

const { Blob: NodeBlob } = await import('node:buffer')
const sig = (ch: string): string => ch.repeat(64)
const PUB = sig('e'), LIVE = sig('7'), DREC = sig('5'), ROOT = sig('a'), LAYER = sig('b'), TO = sig('c')
const KEY = 'business-card'

const indexNaming = (roots: Record<string, string>): HiveIndexResult =>
  ({ ok: true, manifest: { roots } as never })

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

function hive(over: {
  index?: HiveIndexResult | 'throws'
  ownHeads?: string[]
  confirm?: boolean
  walked?: { failed: number; truncated: number } | null
  marker?: string
  draftOutcome?: 'applied' | 'incomplete' | 'unheld' | 'gate' | 'path-busy'
} = {}) {
  const log: string[] = []
  const draftOutcome = { value: over.draftOutcome ?? 'applied' }
  const layers: Record<string, unknown> = { [LIVE]: { name: 'business-card', decorations: [DREC] } }
  const heads = new Map<string, { marker: string; sig: string; layer: unknown }>()
  heads.set('loc:/business-card', { marker: over.marker ?? 'A', sig: sig('9'), layer: { name: 'business-card', notes: ['old'] } })
  const pool = new Map<string, unknown>()
  const blob = (value: unknown): Blob => new NodeBlob([JSON.stringify(value)]) as unknown as Blob
  const restored: unknown[] = []
  const services: Omit<ReplicaServices, 'publish'> = {
    history: {
      sign: async (l: { explorerSegments: () => string[] }) => `loc:/${l.explorerSegments().join('/')}`,
      currentLayerAt: async (loc: string) => (heads.get(loc)?.layer as never) ?? null,
      headMarkerOf: (loc: string) => heads.get(loc)?.marker ?? null,
      warmHeadSigFor: (loc: string) => heads.get(loc)?.sig ?? null,
      commitLayer: async (loc: string, layer: unknown) => {
        log.push(`commit ${loc}`)
        heads.set(loc, { marker: 'B', sig: sig('8'), layer })
        return sig('8')
      },
    } as never,
    store: {
      getResource: async (s: string) => (layers[s] ? blob(layers[s]) : null),
      getPool: async () => ({}) as never,
      openPool: async () => ({}) as never,
      putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer, name?: string) => { pool.set(String(name), JSON.parse(new TextDecoder().decode(bytes))); return 'x' },
      getPoolDoc: async (_pool: unknown, name?: string) => (pool.has(String(name)) ? encode(pool.get(String(name))).buffer as ArrayBuffer : null),
    } as never,
    broker: {
      noteDomainsForSig: (s: string, domains: string[]) => { log.push(`domains ${s === LIVE} ${domains.join(',')}`) },
      adopt: async (s: string, opts?: { layersOnly?: boolean }) => {
        log.push(`adopt ${s === LIVE} layersOnly=${opts?.layersOnly === true}`)
        return over.walked === null ? undefined : (over.walked ?? { failed: 0, truncated: 0 })
      },
      fetchBySig: async (s: string) => (s === DREC
        ? encode({ kind: DRAFTS_KIND, appliesTo: ['business-card'], payload: { drafts: [{ root: ROOT, layer: LAYER }] }, refs: [ROOT, LAYER, TO] })
        : encode({ any: s })),
    },
    drafts: {
      restore: async (carried, _bytes, lineage) => {
        restored.push({ carried, lineage })
        return carried.drafts.map(d => ({ root: d.root, outcome: draftOutcome.value }))
      },
    },
  }
  const deps: HiveTakeDeps = {
    services,
    pubkey: PUB,
    fetchIndex: async () => {
      log.push('index')
      if (over.index === 'throws') throw new Error('offline')
      return over.index ?? indexNaming({ [KEY]: LIVE })
    },
    ownHeads: async () => new Set(over.ownHeads ?? [sig('3')]),
    confirm: async () => { log.push('confirm'); return over.confirm ?? true },
  }
  const row: HiveTakeRow = { key: KEY, segments: ['business-card'], live: LIVE, door: 'jwize.com', zones: ['jwize.com'] }
  return { deps, row, log, restored, services, heads, draftOutcome }
}

describe('the owner check is the hive’s own signed index', () => {
  it('holds only when the index read now names that head for that key', async () => {
    const { deps } = hive()
    expect(await hiveIndexNames(deps.fetchIndex, 'jwize.com', PUB, KEY, LIVE)).toBe(true)
    expect(await hiveIndexNames(async () => indexNaming({ [KEY]: sig('6') }), 'jwize.com', PUB, KEY, LIVE)).toBe(false)
    expect(await hiveIndexNames(async () => ({ ok: false, reason: 'forged' }), 'jwize.com', PUB, KEY, LIVE)).toBe(false)
    expect(await hiveIndexNames(async () => { throw new Error('x') }, 'jwize.com', PUB, KEY, LIVE)).toBe(false)
    expect(await hiveIndexNames(deps.fetchIndex, '', PUB, KEY, LIVE)).toBe(false)
    expect(await hiveIndexNames(deps.fetchIndex, 'jwize.com', 'not-a-key', KEY, LIVE)).toBe(false)
  })

  it('takes nothing, asks nothing, when the index does not name the head (moved on, forged, unread)', async () => {
    for (const index of [indexNaming({ [KEY]: sig('6') }), { ok: false, reason: 'forged' } as HiveIndexResult, 'throws' as const]) {
      const { deps, row, log, restored } = hive({ index })
      expect(await takeFromElsewhere(deps, row)).toEqual({ kind: 'not-yours' })
      expect(log).toEqual(['index'])
      expect(restored).toEqual([])
    }
  })

  it('never takes a head this hive published itself — it is behind here', async () => {
    const { deps, row, log } = hive({ ownHeads: [LIVE] })
    expect(await takeFromElsewhere(deps, row)).toEqual({ kind: 'ours' })
    expect(log).toEqual([])
  })

  it('never takes again a head this hive took before, whatever its ledger says', async () => {
    const { deps, row, log, services } = hive()
    const { writeReceipt } = await import('./site-replica')
    await writeReceipt(services.store, 'business-card', LIVE, sig('7'))
    expect(await takeFromElsewhere(deps, row)).toEqual({ kind: 'ours' })
    expect(log).toEqual([])
  })

  it('refuses a row with no route here', async () => {
    const { deps, row, log } = hive()
    expect(await takeFromElsewhere(deps, { ...row, segments: [] })).toEqual({ kind: 'not-yours' })
    expect(await takeFromElsewhere(deps, { ...row, live: null })).toEqual({ kind: 'not-yours' })
    expect(log).toEqual([])
  })
})

describe('take it', () => {
  it('asks first, after the owner check, and a no fetches nothing', async () => {
    const { deps, row, log } = hive({ confirm: false })
    expect(await takeFromElsewhere(deps, row)).toEqual({ kind: 'declined' })
    expect(log).toEqual(['index', 'confirm'])
  })

  it('takes nothing when a layer of the head could not be fetched', async () => {
    for (const walked of [{ failed: 1, truncated: 0 }, { failed: 0, truncated: 2 }, null]) {
      const { deps, row, log, restored } = hive({ walked })
      expect(await takeFromElsewhere(deps, row)).toEqual({ kind: 'cold' })
      expect(log.some(l => l.startsWith('commit'))).toBe(false)
      expect(restored).toEqual([])
    }
  })

  it('takes the head at the row’s route, then brings its drafts home held', async () => {
    const { deps, row, log, restored, services, heads } = hive()
    const outcome = await takeFromElsewhere(deps, row)
    expect(outcome).toEqual({ kind: 'taken', drafts: { home: 1, otherBuild: 0 } })
    expect(log).toEqual(['index', 'confirm', 'domains true jwize.com', 'adopt true layersOnly=true', 'domains true jwize.com', 'commit loc:/business-card',
      // After the take, the whole closure is held in the background (holdClosure).
      'adopt true layersOnly=false'])
    expect((heads.get('loc:/business-card')?.layer as { decorations?: string[] }).decorations).toEqual([DREC])
    expect(restored).toEqual([{ carried: { refs: [ROOT, LAYER, TO], drafts: [{ root: ROOT, layer: LAYER }] }, lineage: 'business-card' }])
    // The receipt remembers the draft settled here: a second take never restores it again.
    expect((await readReceipt(services.store, 'business-card'))?.drafts).toEqual([ROOT])
  })

  it('never lands over an edit made here while the head was fetched', async () => {
    const h = hive()
    const adopt = h.services.broker!.adopt!
    h.services.broker!.adopt = async (s, opts) => {
      const done = await adopt(s, opts)
      const at = h.heads.get('loc:/business-card')!
      h.heads.set('loc:/business-card', { ...at, marker: 'edited-meanwhile' })
      return done
    }
    expect(await takeFromElsewhere(h.deps, h.row)).toEqual({ kind: 'edited' })
    expect(h.log.some(l => l.startsWith('commit'))).toBe(false)
    expect(h.restored).toEqual([])
  })
})

describe('a draft the take did not bring home', () => {
  it('is counted as waiting, left off the receipt, and tried again on the hive until it comes home', async () => {
    for (const outcome of ['incomplete', 'unheld', 'gate', 'path-busy'] as const) {
      const h = hive({ draftOutcome: outcome })
      expect(await takeFromElsewhere(h.deps, h.row)).toEqual({ kind: 'taken', drafts: { home: 0, otherBuild: 0, waiting: 1 } })
      expect((await readReceipt(h.services.store, 'business-card'))?.drafts ?? []).toEqual([])
      // Taken, the row is no longer drift and Take is not offered again: the retry is the way home.
      expect(await takeFromElsewhere(h.deps, h.row)).toEqual({ kind: 'ours' })
      h.log.length = 0
      expect(await retryTakenDrafts(h.deps, h.row)).toEqual({ home: 0, otherBuild: 0, waiting: 1 })
      // The owner check is made again, fresh, for that very head.
      expect(h.log).toEqual(['index'])
      h.draftOutcome.value = 'applied'
      expect(await retryTakenDrafts(h.deps, h.row)).toEqual({ home: 1, otherBuild: 0 })
      expect((await readReceipt(h.services.store, 'business-card'))?.drafts).toEqual([ROOT])
      // Settled: nothing more is tried, and the index is not read again.
      h.log.length = 0
      expect(await retryTakenDrafts(h.deps, h.row)).toBeUndefined()
      expect(h.log).toEqual([])
      expect(h.restored).toHaveLength(3)
    }
  })

  it('is never tried for a head this hive did not take, nor once the index names another', async () => {
    const h = hive({ draftOutcome: 'incomplete' })
    expect(await retryTakenDrafts(h.deps, h.row)).toBeUndefined()
    expect(h.restored).toEqual([])
    await takeFromElsewhere(h.deps, h.row)
    const tried = h.restored.length
    // The row now names a newer head: that is a new Take, not this retry.
    expect(await retryTakenDrafts(h.deps, { ...h.row, live: sig('6') })).toBeUndefined()
    // The index read now no longer names the taken head: fail closed, nothing restored.
    const moved = { ...h.deps, fetchIndex: async () => indexNaming({ [KEY]: sig('6') }) }
    expect(await retryTakenDrafts(moved, h.row)).toBeUndefined()
    expect(h.restored).toHaveLength(tried)
  })
})

describe("how often the hive tries a taken card's drafts again", () => {
  it('tries a head at once, then waits longer after every try of it, and starts over on a new head', () => {
    let clock = 0
    const pace = draftsRetryPace(() => clock)
    expect(pace.due(KEY, LIVE)).toBe(true)
    pace.tried(KEY, LIVE)
    // Every look at the window in between asks nothing.
    expect(pace.due(KEY, LIVE)).toBe(false)
    clock += DRAFTS_RETRY_FIRST_MS - 1
    expect(pace.due(KEY, LIVE)).toBe(false)
    clock += 1
    expect(pace.due(KEY, LIVE)).toBe(true)
    pace.tried(KEY, LIVE)
    clock += DRAFTS_RETRY_FIRST_MS
    expect(pace.due(KEY, LIVE)).toBe(false)
    clock += DRAFTS_RETRY_FIRST_MS
    expect(pace.due(KEY, LIVE)).toBe(true)
    // The wait stops growing at the longest.
    for (let i = 0; i < 20; i++) pace.tried(KEY, LIVE)
    clock += DRAFTS_RETRY_LONGEST_MS - 1
    expect(pace.due(KEY, LIVE)).toBe(false)
    clock += 1
    expect(pace.due(KEY, LIVE)).toBe(true)
    // Another head on the row, or another row, is due at once.
    pace.tried(KEY, LIVE)
    expect(pace.due(KEY, sig('6'))).toBe(true)
    expect(pace.due('other-card', LIVE)).toBe(true)
  })

  it('the Publish window asks the pace before it retries, so a refresh retries nothing that is not due', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const drone = readFileSync(resolve(process.cwd(), 'hypercomb-essentials/src/sharing/publish-status.drone.ts'), 'utf8')
    const retry = drone.slice(drone.indexOf('async #retryTakenDrafts('), drone.indexOf('/** A write with no host named'))
    const due = retry.indexOf('if (!pace.due(key, head)) return')
    expect(due).toBeGreaterThan(0)
    expect(retry.indexOf('pace.tried(key, head)')).toBeGreaterThan(due)
    expect(retry.indexOf('await retryTakenDrafts(')).toBeGreaterThan(due)
  })
})

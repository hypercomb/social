// site-replica.spec.ts — the replica's own rules, outside the view: a nested
// site stands at every segment of its route; "lagging" means moments ago, not
// forever; a take never lands over an edit made since it was decided; and a
// take replaces the whole tree in one queued step, the way the adopt placed it.

import { describe, expect, it, vi } from 'vitest'
import {
  LAG_WINDOW_MS, lagging, replicaRoute, replicate, takePublished,
  type ReplicaReceipt, type ReplicaServices,
} from './site-replica'

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

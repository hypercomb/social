// module-commit.spec.ts — A DRAFT COMMITS FROM INSIDE THE HIVE: the chain
// from the trunk root to the draft's parent is re-minted, the new root is
// appended to this host's host:packages pool, and the selection runs on the
// new root with the pick gone. Nothing old is touched.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { commitDraft, draftModule, type ModuleDraftDeps, type PackagePool } from './module-drafts'
import { formatMember } from './host-pool'
import type { Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const BEE = ['// src/games/solomon/labyrinth.ts', 'var rooms = "remembered";', '// src/games/solomon/solomon.drone.ts', 'export {};'].join('\n')

const world = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE))
  bees.set(beeSig, encode(BEE))
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [] }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [], dependencies: [] }))
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: ['d'.repeat(64)], criticalBees: [] }))
  const io: ReplicationIo = { read: async sig => heap.get(sig) ?? null, fetch: async () => null, write: async (sig, bytes) => { heap.set(sig, bytes) } }
  let picks: Picks = {}
  let installed = trunk
  const applied: { trunk: string; admitted: readonly string[]; picks: Picks }[] = []
  const entries = new Map<string, string>([['00000000', formatMember(trunk, 'main')]])
  const pool: PackagePool = { names: async () => [...entries.keys()], write: async (name, text) => { entries.set(name, text) } }
  const deps: ModuleDraftDeps = {
    trunk: () => installed,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { bees.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (t, admitted, next) => { applied.push({ trunk: t, admitted, picks: next }); picks = next; installed = t; return { ok: true } },
    now: () => 1_700_000_000_000,
    pool: async () => pool,
  }
  return { heap, beeSig, solomon, games, trunk, deps, applied, entries, read: (sig: string) => JSON.parse(decode(heap.get(sig)!)) as Record<string, unknown> }
}

describe('commitDraft', () => {
  it('re-mints the chain, appends the new root to the pool under the label, and makes it the trunk with the pick gone', async () => {
    const w = await world()
    const draft = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const outcome = await commitDraft('games/solomon', 'essentials', w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.index).toBe(1)
    expect(w.entries.get('00000001')).toBe(formatMember(outcome.rootSig, 'essentials'))
    // The new root keeps everything the trunk carried and names a new games layer, which names the draft's layer.
    const root = w.read(outcome.rootSig)
    expect(root['dependencies']).toEqual(['d'.repeat(64)])
    expect(root['criticalBees']).toEqual([])
    const gamesSig = (root['cells'] as string[])[0]!
    expect(gamesSig).not.toBe(w.games)
    expect((w.read(gamesSig)['cells'] as string[])[0]).toBe(draft.layerSig)
    // Live on the new trunk, the draft pick gone; the old root and chain untouched.
    const last = w.applied[w.applied.length - 1]!
    expect(last.trunk).toBe(outcome.rootSig)
    expect(last.picks).toEqual({})
    expect(last.admitted).toContain(outcome.rootSig)
    expect(w.read(w.trunk)['cells']).toEqual([w.games])
  })

  it('commits only a draft, and only one that is picked', async () => {
    const w = await world()
    expect(await commitDraft('games/solomon', 'essentials', w.deps)).toEqual({ ok: false, error: 'no draft is picked at games/solomon' })
    const foreign = await sigOf(encode(JSON.stringify({ name: 'root', cells: [], dependencies: [] })))
    w.heap.set(foreign, encode(JSON.stringify({ name: 'root', cells: [], dependencies: [] })))
    const picked = { ...w.deps, picks: () => ({ 'games/solomon': { layer: w.solomon, root: foreign, hides: false, at: 1 } }) }
    const outcome = await commitDraft('games/solomon', 'essentials', picked)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain("a publisher's revision, not a draft")
  })

  it('publishes nothing when the selection does not compose', async () => {
    const w = await world()
    await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    const refused = { ...w.deps, apply: async () => ({ ok: false as const, error: 'not held here' }) }
    expect(await commitDraft('games/solomon', 'essentials', refused)).toEqual({ ok: false, error: 'not held here' })
    expect([...w.entries.keys()]).toEqual(['00000000'])
  })
})

// module-drafts.spec.ts — one section of one bee written back becomes a new
// bee, a new layer naming it, and a pick over the trunk; nothing old is touched.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { draftModule, listDrafts, type ModuleDraftDeps } from './module-drafts'
import type { Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const BEE = [
  'import { Drone } from "@hypercomb/core";',
  '// src/games/solomon/labyrinth.ts',
  'var rooms = "remembered";',
  '// src/games/solomon/solomon.drone.ts',
  'export var SolomonDrone = class extends Drone {};',
].join('\n')

const world = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE))
  bees.set(beeSig, encode(BEE))
  const otherBee = 'b'.repeat(64)
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [], docs: { bees: { [beeSig]: { className: 'SolomonDrone' } } } }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [`${otherBee}.js`], dependencies: [] }))
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: ['d'.repeat(64)] }))
  const io: ReplicationIo = {
    read: async sig => heap.get(sig) ?? null,
    fetch: async () => null,
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  let picks: Picks = {}
  const applied: { trunk: string; admitted: readonly string[]; picks: Picks }[] = []
  const deps: ModuleDraftDeps = {
    trunk: () => trunk,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { bees.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (t, admitted, next) => { applied.push({ trunk: t, admitted, picks: next }); picks = next; return { ok: true } },
    now: () => 1_700_000_000_000,
  }
  return { heap, bees, beeSig, solomon, games, trunk, deps, applied, picksNow: () => picks }
}

describe('draftModule', () => {
  it('writes the section back as a new bee, a new layer naming it, and a pick at the package path', async () => {
    const w = await world()
    const outcome = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.path).toBe('games/solomon')
    expect(outcome.reload).toBe(true)
    // The new bee: the section replaced, every other line untouched, hashed to its name.
    const nextBee = decode(w.bees.get(outcome.beeSig)!)
    expect(nextBee).toBe(BEE.replace('var rooms = "remembered";', 'var rooms = "fresh";'))
    expect(await sigOf(encode(nextBee))).toBe(outcome.beeSig)
    // The new layer names the new bee in the list and in its docs, and nothing else moved.
    const layer = JSON.parse(decode(w.heap.get(outcome.layerSig)!)) as { name: string; bees: string[]; docs: { bees: Record<string, unknown> } }
    expect(layer.name).toBe('solomon')
    expect(layer.bees).toEqual([`${outcome.beeSig}.js`])
    expect(Object.keys(layer.docs.bees)).toEqual([outcome.beeSig])
    // The draft root says what it is and carries the trunk's dependencies.
    const root = JSON.parse(decode(w.heap.get(outcome.rootSig)!)) as { draft: { of: string; path: string; from: string }; dependencies: string[] }
    expect(root.draft).toMatchObject({ of: w.trunk, path: 'games/solomon', from: w.beeSig })
    expect(root.dependencies).toEqual(['d'.repeat(64)])
    // Made live as a pick over the trunk; the old atoms are all still there.
    expect(w.applied).toHaveLength(1)
    expect(w.applied[0].picks).toEqual({ 'games/solomon': { layer: outcome.layerSig, root: outcome.rootSig, hides: false, at: 1_700_000_000_000 } })
    expect(w.applied[0].admitted).toEqual([outcome.beeSig, outcome.layerSig, outcome.rootSig])
    expect(w.bees.has(w.beeSig)).toBe(true)
    expect(w.heap.has(w.solomon)).toBe(true)
    // Listed as a draft.
    expect(await listDrafts(w.deps)).toEqual([
      { path: 'games/solomon', layerSig: outcome.layerSig, rootSig: outcome.rootSig, section: 'src/games/solomon/labyrinth.ts', from: w.beeSig, at: 1_700_000_000_000 },
    ])
  })

  it('drafts on top of an earlier draft of the same module', async () => {
    const w = await world()
    const first = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    if (!first.ok) throw new Error(first.error)
    const second = await draftModule({ beeSig: first.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresher";' }, w.deps)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.path).toBe('games/solomon')
    expect(decode(w.bees.get(second.beeSig)!)).toContain('"fresher"')
    expect(w.picksNow()['games/solomon'].layer).toBe(second.layerSig)
  })

  it('refuses what it cannot draft, and changes nothing', async () => {
    const w = await world()
    const at = (r: Awaited<ReturnType<typeof draftModule>>): string => r.ok ? 'ok' : r.error
    expect(at(await draftModule({ beeSig: 'nope', section: 'src/x.ts', body: '' }, w.deps))).toMatch(/64-character signature/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'games/x.ts', body: '' }, w.deps))).toMatch(/one source section/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/nowhere.ts', body: 'x' }, w.deps))).toMatch(/no section src\/nowhere\.ts/)
    expect(at(await draftModule({ beeSig: 'c'.repeat(64), section: 'src/x.ts', body: 'x' }, w.deps))).toMatch(/not a module of the installed package/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "remembered";' }, w.deps))).toMatch(/byte-identical/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/x.ts', body: 'x' }, { ...w.deps, trunk: () => null }))).toMatch(/nothing is installed here/)
    expect(w.applied).toHaveLength(0)
    expect(w.bees.size).toBe(1)
  })

  it('reports the selection gate\'s refusal and leaves the pick untouched', async () => {
    const w = await world()
    const deps: ModuleDraftDeps = { ...w.deps, apply: async () => ({ ok: false, error: 'selection needs core 9' }) }
    const outcome = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, deps)
    expect(outcome).toEqual({ ok: false, error: 'selection needs core 9' })
    expect(w.picksNow()).toEqual({})
  })
})

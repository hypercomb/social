// module-drafts.atoms.spec.ts — a dependency atom is drafted where its
// namespace lives (atomic-modules-plan.md, step 5): the pick at its directory
// keeps the layer as it runs and swaps the atom in its root's dependencies,
// drafts at one path stack, and a commit publishes the new atom.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { commitSelection, draftModule, type ModuleDraftDeps } from './module-drafts'
import type { Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const ATOM = [
  '// @hypercomb/essentials/games/solomon/labyrinth',
  '// lazy — an atom: it loads through the import map when something imports it',
  '// src/games/solomon/labyrinth.ts',
  'export var rooms = "remembered";',
].join('\n')
const OTHER_ATOM = [
  '// @hypercomb/essentials/games/juice',
  '// lazy — an atom: it loads through the import map when something imports it',
  '// src/games/juice.ts',
  'export var shake = 1;',
].join('\n')
const BEE = [
  'import { rooms } from "@hypercomb/essentials/games/solomon/labyrinth";',
  '// src/games/solomon/solomon.drone.ts',
  'export var SolomonDrone = class {};',
].join('\n')

const world = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const dependencies = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE)); bees.set(beeSig, encode(BEE))
  const atomSig = await sigOf(encode(ATOM)); dependencies.set(atomSig, encode(ATOM))
  const juiceSig = await sigOf(encode(OTHER_ATOM)); dependencies.set(juiceSig, encode(OTHER_ATOM))
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [] }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [], dependencies: [] }))
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: [`${atomSig}.js`, `${juiceSig}.js`] }))
  const io: ReplicationIo = {
    read: async sig => heap.get(sig) ?? null,
    fetch: async () => null,
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  let picks: Picks = {}
  let installed = trunk
  const published: string[] = []
  const deps: ModuleDraftDeps = {
    trunk: () => installed,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      getDependencyBytes: async sig => dependencies.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { bees.set(sig, bytes) },
      writeDependencyBytes: async (sig, bytes) => { dependencies.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (t, _admitted, next) => { installed = t; picks = next; return { ok: true } },
    now: () => 1_700_000_000_000,
    pool: async () => ({ names: async () => [], write: async (_name, text) => { published.push(text) } }),
    off: () => new Set<string>(),
    setOff: () => {},
  }
  const rootOf = (sig: string) => JSON.parse(decode(heap.get(sig)!)) as { dependencies: string[]; draft?: Record<string, unknown>; cells?: string[] }
  return { heap, dependencies, beeSig, atomSig, juiceSig, solomon, trunk, deps, rootOf, picksNow: () => picks, published, installedNow: () => installed }
}

describe('draftModule — a dependency atom', () => {
  it('picks at the atom\'s directory, keeps the layer, and swaps only that atom', async () => {
    const w = await world()
    const outcome = await draftModule({ beeSig: w.atomSig, section: 'src/games/solomon/labyrinth.ts', body: 'export var rooms = "fresh";' }, w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.of).toBe('dependency')
    expect(outcome.path).toBe('games/solomon')
    expect(outcome.layerSig).toBe(w.solomon)
    // Lines 1 and 2 — the alias and the lazy marker — are kept exactly.
    expect(decode(w.dependencies.get(outcome.beeSig)!)).toBe(`${ATOM.replace('"remembered"', '"fresh"')}\n`)
    const root = w.rootOf(outcome.rootSig)
    expect(root.draft).toMatchObject({ kind: 'dependency', path: 'games/solomon', from: w.atomSig, to: outcome.beeSig })
    expect(root.dependencies).toEqual([outcome.beeSig, w.juiceSig])
    expect(w.picksNow()['games/solomon']).toMatchObject({ layer: w.solomon, root: outcome.rootSig })
    // Nothing old is touched.
    expect(w.dependencies.has(w.atomSig)).toBe(true)
  })

  it('an atom at the games root picks at games', async () => {
    const w = await world()
    const outcome = await draftModule({ beeSig: w.juiceSig, section: 'src/games/juice.ts', body: 'export var shake = 2;' }, w.deps)
    expect(outcome.ok && outcome.path).toBe('games')
  })

  it('a bee draft and an atom draft at one path stack', async () => {
    const w = await world()
    const bee = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/solomon.drone.ts', body: 'export var SolomonDrone = class { x = 1 };' }, w.deps)
    expect(bee.ok).toBe(true)
    const atom = await draftModule({ beeSig: w.atomSig, section: 'src/games/solomon/labyrinth.ts', body: 'export var rooms = "fresh";' }, w.deps)
    expect(atom.ok).toBe(true)
    if (!bee.ok || !atom.ok) return
    // The atom draft keeps the bee draft's layer.
    expect(w.picksNow()['games/solomon']).toMatchObject({ layer: bee.layerSig, root: atom.rootSig })
    // And a later bee draft keeps the atom draft's dependencies.
    const again = await draftModule({ beeSig: bee.beeSig, section: 'src/games/solomon/solomon.drone.ts', body: 'export var SolomonDrone = class { x = 2 };' }, w.deps)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(w.rootOf(again.rootSig).dependencies).toContain(atom.beeSig)
  })
})

describe('commitSelection — an atom draft', () => {
  it('publishes a root whose dependencies carry the new atom', async () => {
    const w = await world()
    const draft = await draftModule({ beeSig: w.atomSig, section: 'src/games/solomon/labyrinth.ts', body: 'export var rooms = "fresh";' }, w.deps)
    if (!draft.ok) throw new Error(draft.error)
    const committed = await commitSelection('atoms', w.deps)
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const root = w.rootOf(committed.rootSig)
    expect(root.dependencies.sort()).toEqual([`${draft.beeSig}.js`, `${w.juiceSig}.js`].sort())
    // The committed draft is part of the trunk now, not a pick.
    expect(w.picksNow()['games/solomon']).toBeUndefined()
    expect(committed.changes).toEqual([{ path: 'games/solomon', section: 'src/games/solomon/labyrinth.ts', from: w.atomSig, to: draft.beeSig }])
    expect(committed.atoms).toContain(draft.beeSig)
  })
})

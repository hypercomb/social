// module-commit.spec.ts — WHAT RUNS HERE BECOMES THE PACKAGE, from inside the
// hive: every draft takes its path, every path turned off is left out of the
// new root (unreachable, never deleted), only the layers above a change are
// re-minted, the new root is appended to this host's host:packages pool, and
// the selection runs on it. Nothing old is touched.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { commitSelection, draftModule, type ModuleDraftDeps, type PackagePool } from './module-drafts'
import { formatMember } from './host-pool'
import type { Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const BEE = ['// src/games/solomon/labyrinth.ts', 'var rooms = "remembered";', '// src/games/solomon/solomon.drone.ts', 'export {};'].join('\n')
const ARKANOID = '// src/games/arkanoid/arkanoid.drone.ts\nexport {};'

const world = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE))
  const arkanoidBee = await sigOf(encode(ARKANOID))
  bees.set(beeSig, encode(BEE))
  bees.set(arkanoidBee, encode(ARKANOID))
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [] }))
  const arkanoid = await put(JSON.stringify({ name: 'arkanoid', cells: [], bees: [`${arkanoidBee}.js`], dependencies: [] }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon, arkanoid], bees: [], dependencies: [] }))
  const notes = await put(JSON.stringify({ name: 'notes', cells: [], bees: [], dependencies: [] }))
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games, notes], bees: [], dependencies: ['d'.repeat(64)], criticalBees: [`${beeSig}.js`, `${arkanoidBee}.js`] }))
  const io: ReplicationIo = { read: async sig => heap.get(sig) ?? null, fetch: async () => null, write: async (sig, bytes) => { heap.set(sig, bytes) } }
  let picks: Picks = {}
  let installed = trunk
  let off = new Set<string>()
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
    off: () => off,
    setOff: paths => { off = new Set(paths) },
  }
  return {
    heap, beeSig, arkanoidBee, solomon, arkanoid, games, notes, trunk, deps, applied, entries,
    turnOff: (...paths: string[]) => { off = new Set([...off, ...paths]) }, offNow: () => off,
    read: (sig: string) => JSON.parse(decode(heap.get(sig)!)) as Record<string, unknown>,
  }
}

const draftLabyrinth = async (w: Awaited<ReturnType<typeof world>>) => {
  const draft = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
  if (!draft.ok) throw new Error(draft.error)
  return draft
}

describe('commitSelection', () => {
  it('commits a draft: re-mints only the layers above it, appends the root under the label, and runs it', async () => {
    const w = await world()
    const draft = await draftLabyrinth(w)
    const outcome = await commitSelection('essentials', w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome).toMatchObject({ index: 1, drafts: ['games/solomon'], off: [] })
    expect(w.entries.get('00000001')).toBe(formatMember(outcome.rootSig, 'essentials'))
    const root = w.read(outcome.rootSig)
    expect(root['dependencies']).toEqual(['d'.repeat(64)])
    // The render-priority hint follows the module the draft renamed.
    expect(root['criticalBees']).toEqual([`${draft.beeSig}.js`, `${w.arkanoidBee}.js`])
    const [gamesSig, notesSig] = root['cells'] as string[]
    // An untouched branch keeps its signature; the changed one is re-minted.
    expect(notesSig).toBe(w.notes)
    expect(w.read(gamesSig!)['cells']).toEqual([draft.layerSig, w.arkanoid])
    // The files a host must serve before followers are pointed at the root.
    expect(outcome.atoms).toEqual([outcome.rootSig, gamesSig!, draft.layerSig, draft.beeSig].sort())
    const last = w.applied[w.applied.length - 1]!
    expect(last).toMatchObject({ trunk: outcome.rootSig, picks: {} })
    expect(w.read(w.trunk)['cells']).toEqual([w.games, w.notes])
  })

  it('leaves a turned-off path out of the new root — unreachable, not deleted — and takes it off the off list', async () => {
    const w = await world()
    w.turnOff('games/arkanoid')
    const outcome = await commitSelection('essentials', w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome).toMatchObject({ drafts: [], off: ['games/arkanoid'] })
    const root = w.read(outcome.rootSig)
    const gamesSig = (root['cells'] as string[])[0]!
    expect(w.read(gamesSig)['cells']).toEqual([w.solomon])
    // The hint no longer names a module the root does not reach.
    expect(root['criticalBees']).toEqual([`${w.beeSig}.js`])
    // Only the two re-minted layers are new; the turned-off layer and its module are still held.
    expect(outcome.atoms).toEqual([outcome.rootSig, gamesSig].sort())
    expect(w.heap.has(w.arkanoid)).toBe(true)
    expect([...w.offNow()]).toEqual([])
  })

  it('commits drafts and turned-off paths together', async () => {
    const w = await world()
    const draft = await draftLabyrinth(w)
    w.turnOff('notes')
    const outcome = await commitSelection('essentials', w.deps)
    expect(outcome).toMatchObject({ ok: true, drafts: ['games/solomon'], off: ['notes'] })
    if (!outcome.ok) return
    const cells = w.read(outcome.rootSig)['cells'] as string[]
    expect(cells).toHaveLength(1)
    expect((w.read(cells[0]!)['cells'] as string[])[0]).toBe(draft.layerSig)
  })

  it('has nothing to commit when nothing would change', async () => {
    const w = await world()
    expect(await commitSelection('essentials', w.deps)).toEqual({ ok: false, error: 'nothing to commit: no draft is picked and nothing is turned off' })
    // A pick of the very layer the trunk already runs folds into nothing new.
    const foreign = await sigOf(encode(JSON.stringify({ name: 'root', cells: [], dependencies: [] })))
    w.heap.set(foreign, encode(JSON.stringify({ name: 'root', cells: [], dependencies: [] })))
    const picked = { ...w.deps, picks: () => ({ 'games/solomon': { layer: w.solomon, root: foreign, hides: false, at: 1 } }) }
    expect(await commitSelection('essentials', picked)).toEqual({ ok: false, error: 'nothing to commit: what runs here is already the package' })
  })

  // A BUILD FOR EVERYBODY: somebody else's change, taken at one path and
  // accepted here, is folded into the commit with the bundles it brought.
  const takenTrial = async (w: Awaited<ReturnType<typeof world>>) => {
    const theirBee = 'var rooms = "theirs";'
    const theirBeeSig = await sigOf(encode(theirBee))
    const bundle = '// @hypercomb/essentials/games/solomon\nexport const rooms = 2;'
    const bundleSig = await sigOf(encode(bundle))
    const layer = await sigOf(encode(JSON.stringify({ name: 'solomon', cells: [], bees: [`${theirBeeSig}.js`], dependencies: [] })))
    w.heap.set(layer, encode(JSON.stringify({ name: 'solomon', cells: [], bees: [`${theirBeeSig}.js`], dependencies: [] })))
    const rootBody = JSON.stringify({ name: 'root', cells: [], dependencies: [`${bundleSig}.js`, 'e'.repeat(64)] })
    const root = await sigOf(encode(rootBody))
    w.heap.set(root, encode(rootBody))
    const bundles = new Map([[bundleSig, encode(bundle)], ['d'.repeat(64), encode('// @hypercomb/essentials/notes\n')], ['e'.repeat(64), encode('// @hypercomb/essentials/notes\n')]])
    let picks = { 'games/solomon': { layer, root, hides: false, at: 1, byHand: true } } as Record<string, { layer: string; root: string; hides: boolean; at: number; byHand?: boolean }>
    const applied: Record<string, unknown>[] = []
    const store = w.deps.store()!
    return {
      layer, root, theirBeeSig, bundleSig,
      deps: (held: ReadonlySet<string> = new Set()): ModuleDraftDeps => ({
        ...w.deps,
        store: () => ({ ...store, getDependencyBytes: async (sig: string) => bundles.get(sig) ?? null }),
        picks: () => picks,
        apply: async (t, admitted, next) => { applied.push(next); picks = next as typeof picks; return w.deps.apply(t, admitted, next) },
        mayRun: async sig => !held.has(sig),
      }),
      picksNow: () => picks,
      applied,
    }
  }

  it('folds a trial taken by hand into the commit at its path, with the bundles it brought', async () => {
    const w = await world()
    const t = await takenTrial(w)
    const outcome = await commitSelection('everybody', t.deps())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome).toMatchObject({ drafts: [], off: [], taken: [{ path: 'games/solomon', root: t.root }], held: [] })
    const root = w.read(outcome.rootSig)
    expect(w.read((root['cells'] as string[])[0]!)['cells']).toEqual([t.layer, w.arkanoid])
    // The taken path's namespace bundle comes with it; the rest of the trunk's stay.
    expect(root['dependencies']).toEqual([t.bundleSig, 'd'.repeat(64)].sort())
    // The render hint follows the module the take replaced.
    expect(root['criticalBees']).toEqual([`${t.theirBeeSig}.js`, `${w.arkanoidBee}.js`])
    // Part of the trunk now: no longer a pick.
    expect(t.picksNow()).toEqual({})
  })

  it('never folds code that still waits in the brood: it stays a pick, and the commit says so', async () => {
    const w = await world()
    const t = await takenTrial(w)
    expect(await commitSelection('everybody', t.deps(new Set([t.theirBeeSig])))).toEqual({
      ok: false, error: 'nothing to commit: what you took at games/solomon still waits in the brood — accept it there first',
    })
    // A held bundle holds it back as surely as a held module.
    w.turnOff('notes')
    const outcome = await commitSelection('everybody', t.deps(new Set([t.bundleSig])))
    expect(outcome).toMatchObject({ ok: true, taken: [], held: ['games/solomon'], off: ['notes'] })
    if (!outcome.ok) return
    const root = w.read(outcome.rootSig)
    expect(w.read((root['cells'] as string[])[0]!)['cells']).toEqual([w.solomon, w.arkanoid])
    expect(Object.keys(t.picksNow())).toEqual(['games/solomon'])
  })

  it('refuses a turned-off path the package does not have, and publishes nothing when the selection does not compose', async () => {
    const w = await world()
    w.turnOff('games/pong')
    expect(await commitSelection('essentials', w.deps)).toEqual({ ok: false, error: 'the installed package has no games/pong' })
    const v = await world()
    await draftLabyrinth(v)
    const refused = { ...v.deps, apply: async () => ({ ok: false as const, error: 'not held here' }) }
    expect(await commitSelection('essentials', refused)).toEqual({ ok: false, error: 'not held here' })
    expect([...v.entries.keys()]).toEqual(['00000000'])
  })
})

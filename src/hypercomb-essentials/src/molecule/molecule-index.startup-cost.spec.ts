// molecule/molecule-index.startup-cost.spec.ts
//
// ADVERSARIAL — the FIRST-RENDER lens, and expected to fail as written.
//
// The drone's own header says:
//
//     "NO BACKFILL PASS over pre-existing content, deliberately. The phase runs
//      only from `hypercomb.act()`'s finally, so a full walk here would fire on
//      every act() burst and re-create the 'navigation funds a whole-hive walk'
//      regression the tree epoch was built to kill."
//
// `#warmRoot` is that walk. It is unconditional — `optimize()` has no
// `if (this.#pending.size === 0) return` early-out (compare
// history/manifest-optimizer.drone.ts, which does) — so the FIRST idle pass
// after the FIRST act(), on a hive whose derived pool is cold, derives the root
// from scratch: up to ROOT_NODES_PER_PASS manifest reads, plus a pool write per
// node visited, contending with the first tile paint for the same OPFS.
//
// The processor's optimize loop (`hypercomb.ts#scheduleOptimize`) awaits every
// bee's `optimize()` serially and honours no idle deadline, and the idle
// callback carries `{ timeout: 2000 }` — so it fires during boot whether the
// browser is idle or not.

import { beforeEach, describe, expect, it } from 'vitest'
import { MOLECULE_INDEX_MEANING } from './molecule-index.js'
import { MoleculeIndexService, MOLECULE_INDEX_SERVICE_KEY } from './molecule-index.service.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

// A modest hive: one root, 20 branches, 20 leaves each = 420 nodes.
const ROOT = sig(1)
const TREE: Record<string, Array<{ sig: string; name: string }>> = { [ROOT]: [] }
for (let b = 0; b < 20; b++) {
  const branchSig = sig(1000 + b)
  TREE[ROOT].push({ sig: branchSig, name: `branch-${b}` })
  TREE[branchSig] = []
  for (let l = 0; l < 20; l++) {
    const leafSig = sig(10_000 + b * 100 + l)
    TREE[branchSig].push({ sig: leafSig, name: `leaf-${b}-${l}` })
    TREE[leafSig] = []
  }
}

class MemFile {
  constructor(public data: string) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    const held = this.data
    return { text: async () => held }
  }
  async createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> {
    return { write: async (t: string) => { this.data = t }, close: async () => {} }
  }
}

class MemDir {
  files = new Map<string, MemFile>()
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    const held = this.files.get(name)
    if (held) return held
    if (!opts?.create) throw new Error('NotFoundError')
    const made = new MemFile('')
    this.files.set(name, made)
    return made
  }
  async removeEntry(name: string): Promise<void> { this.files.delete(name) }
}

const pools = new Map<string, MemDir>()

/** Every manifest read the pass performs — the OPFS traffic first paint is
 *  competing with. */
let manifestReads = 0

const store = {
  getPool: async (meaning: string): Promise<MemDir> => {
    const held = pools.get(meaning)
    if (held) return held
    const made = new MemDir()
    pools.set(meaning, made)
    return made
  },
  readChildrenManifest: async (parentLayerSig: string) => {
    manifestReads++
    return (TREE[parentLayerSig] ?? []).map(c => ({ sig: c.sig, layer: { name: c.name } }))
  },
}

const history = {
  sign: async (): Promise<string> => 'root-location',
  headLayer: async (): Promise<{ layerSig: string }> => ({ layerSig: ROOT }),
  getLayerBySig: async (s: string) => (TREE[s] ? { name: s } : null),
  childrenManifestFor: async (layer: { name?: string }) =>
    (TREE[String(layer?.name ?? '')] ?? []).map(c => ({ sig: c.sig, layer: { name: c.name } })),
}

const iocValues = new Map<string, unknown>()

beforeEach(() => {
  pools.clear()
  iocValues.clear()
  manifestReads = 0
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: <T>(key: string): T | undefined => iocValues.get(key) as T | undefined,
    register: (key: string, value: unknown): void => { iocValues.set(key, value) },
    list: (): unknown[] => [...iocValues.values()],
  }
  iocValues.set('@hypercomb.social/Store', store)
  iocValues.set('@diamondcoreprocessor.com/HistoryService', history)
  iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
})

describe('the optimize pass must stay cheap while first paint is competing for OPFS', () => {

  it('a pass with NOTHING committed does not fund a whole-hive walk', async () => {
    const { MoleculeIndexDrone } = await import('./molecule-index.drone.js')
    const drone = new MoleculeIndexDrone()

    // No 'content:wrote' has been observed: the participant has committed
    // nothing, they have only just booted. The first act() (bootstrap
    // navigation) schedules this pass with a 2s idle timeout, so it runs
    // whether or not the browser is actually idle.
    await drone.optimize()

    expect(
      manifestReads,
      'the first idle pass after boot walked the hive with nothing committed',
    ).toBeLessThan(10)
  })

  it('does not write a record for every node it happened to walk past', async () => {
    const { MoleculeIndexDrone } = await import('./molecule-index.drone.js')
    await new MoleculeIndexDrone().optimize()
    const pool = pools.get(MOLECULE_INDEX_MEANING)
    expect(
      pool?.files.size ?? 0,
      'one boot pass minted a record per node visited, each its own OPFS write',
    ).toBeLessThan(10)
  })

  it('a second pass with still nothing committed is free', async () => {
    const { MoleculeIndexDrone } = await import('./molecule-index.drone.js')
    const drone = new MoleculeIndexDrone()
    await drone.optimize()
    manifestReads = 0
    await drone.optimize()
    // Every act() schedules a pass. A settled hive must not pay per act().
    expect(manifestReads, 'an idle pass on a settled hive still reads').toBe(0)
  })
})

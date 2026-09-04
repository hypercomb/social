// molecule/molecule-index.load-bearing.spec.ts
//
// ADVERSARIAL. The claim under test is the one the whole direction rests on:
//
//   "A cold client with the index wiped must produce IDENTICAL results, only
//    slower."
//
// `molecule-index.cold-path.spec.ts` proves that for a hive that fits inside
// one derivation budget, with a search stub that walks the tree itself. This
// file asks what happens OUTSIDE those two conditions — a budget that runs
// out, a depth cap that trips, a manifest read that blinks, and the real
// search reader rather than a stub. Every divergence found here is an answer
// that CHANGES, not an answer that arrives more slowly.

import { beforeEach, describe, expect, it } from 'vitest'
import { MOLECULE_INDEX_MEANING, readableRecord, type MoleculeRecord } from './molecule-index.js'
import { MoleculeIndexService, MOLECULE_INDEX_SERVICE_KEY } from './molecule-index.service.js'
import { moleculeAddress } from '@hypercomb/core'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

// ── an in-memory pool, identical in shape to the cold-path fixture ─────────

class MemFile {
  constructor(public data: string) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    const held = this.data
    return { text: async () => held }
  }
  async createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> {
    return { write: async (text: string) => { this.data = text }, close: async () => {} }
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

let pools = new Map<string, MemDir>()
let TREE: Record<string, Array<{ sig: string; name: string }>> = {}
let ROOT = sig(1)
/** Sigs whose manifest read fails this pass — a transient IO blink. */
let blind = new Set<string>()

const store = {
  getPool: async (meaning: string): Promise<MemDir> => {
    const held = pools.get(meaning)
    if (held) return held
    const made = new MemDir()
    pools.set(meaning, made)
    return made
  },
  readChildrenManifest: async (parentLayerSig: string) => {
    if (blind.has(parentLayerSig)) return null
    return (TREE[parentLayerSig] ?? []).map(c => ({ sig: c.sig, layer: { name: c.name } }))
  },
  // The LOCAL layer read — OPFS alone, never a host. `blind` models a layer
  // that is not here, exactly as it does for `getLayerBySig`.
  getLayerLocalBytes: async (s: string): Promise<Uint8Array | null> =>
    TREE[s] && !blind.has(s) ? new TextEncoder().encode(JSON.stringify({ name: s })) : null,
}

const history = {
  sign: async (): Promise<string> => 'root-location',
  headLayer: async (): Promise<{ layerSig: string }> => ({ layerSig: ROOT }),
  getLayerBySig: async (s: string) => (TREE[s] && !blind.has(s) ? { name: s } : null),
  childrenManifestFor: async (layer: { name?: string }) => {
    const key = String(layer?.name ?? '')
    if (blind.has(key)) return null
    return (TREE[key] ?? []).map(c => ({ sig: c.sig, layer: { name: c.name } }))
  },
}

/** The cold path's source, stubbed the way the passing spec stubs it: it walks
 *  the tree itself, so it is always complete. (Whether the REAL one behaves
 *  this way is the subject of the last describe block.) */
const search = {
  vocabulary: async (): Promise<ReadonlyMap<string, { name: string; path: readonly string[] }>> => {
    const rows = new Map<string, { name: string; path: readonly string[] }>()
    const walk = (parent: string, path: readonly string[], depth: number): void => {
      if (depth > 64) return
      for (const child of TREE[parent] ?? []) {
        const here = [...path, child.name]
        const key = child.name.toLowerCase()
        const held = rows.get(key)
        if (!held || here.length < held.path.length) rows.set(key, { name: child.name, path: here })
        walk(child.sig, here, depth + 1)
      }
    }
    walk(ROOT, [], 0)
    return rows
  },
}

const iocValues = new Map<string, unknown>()
const installIoc = (): void => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: <T>(key: string): T | undefined => iocValues.get(key) as T | undefined,
    register: (key: string, value: unknown): void => { iocValues.set(key, value) },
    list: (): unknown[] => [...iocValues.values()],
  }
}

const service = (): MoleculeIndexService =>
  iocValues.get(MOLECULE_INDEX_SERVICE_KEY) as MoleculeIndexService

const fresh = (): MoleculeIndexService => {
  const made = new MoleculeIndexService()
  iocValues.set(MOLECULE_INDEX_SERVICE_KEY, made)
  return made
}

const indexPool = async (): Promise<MemDir> => await store.getPool(MOLECULE_INDEX_MEANING)

const recordAt = async (layerSig: string): Promise<MoleculeRecord | null> => {
  const file = (await indexPool()).files.get(layerSig)
  if (!file) return null
  return readableRecord(JSON.parse(file.data))
}

/** Every name in the fixture. */
const namesOf = (): string[] => Object.values(TREE).flat().map(c => c.name)

/** Warm the index the way the phase does, with the budget it is given. */
const warm = async (nodes: number): Promise<void> => {
  const index = service()
  const rootSig = await index.rootSig()
  if (!rootSig) throw new Error('no root')
  const record = await index.derive(rootSig, { nodes })
  if (record) await index.writeRecord(rootSig, record)
}

const wipePool = async (): Promise<void> => {
  const pool = await indexPool()
  for (const name of [...pool.files.keys()]) await pool.removeEntry(name)
}

beforeEach(() => {
  pools = new Map()
  blind = new Set()
  iocValues.clear()
  installIoc()
  iocValues.set('@hypercomb.social/Store', store)
  iocValues.set('@diamondcoreprocessor.com/HistoryService', history)
  iocValues.set('@diamondcoreprocessor.com/HiveSearchService', search)
  fresh()
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. A BUDGET THAT RUNS OUT WRITES A PARTIAL RECORD, AND IT IS PERMANENT
// ═══════════════════════════════════════════════════════════════════════════

describe('a derivation cut short by its budget', () => {

  beforeEach(() => {
    ROOT = sig(1)
    TREE = {
      [sig(1)]: [{ sig: sig(2), name: 'Cigars' }, { sig: sig(3), name: 'People' }, { sig: sig(4), name: 'Places' }],
      [sig(2)]: [{ sig: sig(5), name: 'Lounge' }, { sig: sig(6), name: 'Humidor' }],
      [sig(3)]: [{ sig: sig(7), name: 'Alice' }],
      [sig(4)]: [{ sig: sig(8), name: 'Havana' }],
      [sig(5)]: [], [sig(6)]: [], [sig(7)]: [], [sig(8)]: [],
    }
  })

  it('WRITES the partial record to the pool — the contract says complete-or-absent', async () => {
    await warm(2)
    const root = await recordAt(ROOT)
    expect(root, 'a partial derivation was persisted').not.toBeNull()
    expect(root?.truncated).toBe(true)
    expect(root!.words.length).toBeLessThan(new Set(namesOf()).size)
  })

  it('BLOCKER: holds(word) answers FALSE warm and TRUE cold — the index changed the ANSWER', async () => {
    await warm(2)
    const warmAnswer = await service().declaredVocabulary()

    await wipePool()
    fresh()
    const coldAnswer = await service().declaredVocabulary()

    // The whole contract in one line.
    expect([...warmAnswer].sort(), 'warm and cold disagree').toEqual([...coldAnswer].sort())
  })

  it('BLOCKER: a word the hive can say reads as a word it cannot', async () => {
    await warm(2)
    const missing: string[] = []
    for (const name of namesOf()) if (!(await service().holds(name))) missing.push(name)
    expect(missing, 'these words exist in the hive and holds() denies them').toEqual([])
  })

  it('BLOCKER: the truncation is STICKY — a later pass with an unlimited budget never repairs it', async () => {
    await warm(2)
    const truncated = JSON.stringify(await recordAt(ROOT))

    // The drone's own guard: `if (await index.readRecord(sig)) continue`, and
    // `#warmRoot`'s `if (await index.readRecord(rootSig)) return`.
    const { MoleculeIndexDrone } = await import('./molecule-index.drone.js')
    const drone = new MoleculeIndexDrone()
    await drone.optimize()
    await drone.optimize()

    expect(JSON.stringify(await recordAt(ROOT)), 'the record was re-derived').not.toBe(truncated)
  })

  // FIXED 2026-09-03. This case used to assert that a record EXISTS for the
  // cut-short child (`not.toBeNull()`) and then that it is nevertheless
  // complete — a contradiction the implementation resolved by writing the
  // partial one. A child sig never changes and there is no refresh path, so
  // the only safe resolution is COMPLETE-OR-ABSENT: the record is either the
  // whole word set or it was never written, and the walk that finds it absent
  // derives it properly.
  it('a partial CHILD record is never left behind — absent, or complete', async () => {
    await warm(2)
    const child = await recordAt(sig(2))
    const full = new Set(await Promise.all(['Lounge', 'Humidor'].map(moleculeAddress)))
    if (child) {
      expect(child.truncated, 'a truncated child record was persisted').not.toBe(true)
      expect(new Set(child.words.map(w => w.a)), 'the child record is missing words forever').toEqual(full)
    }
    // …and the words it could not reach are still sayable, because the record
    // that would have masked them is not there.
    for (const name of ['Lounge', 'Humidor']) expect(await service().holds(name), name).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE RECORD IS NOT A FUNCTION OF ITS KEY
// ═══════════════════════════════════════════════════════════════════════════
//
// The contract's first line: "pure derivations of sig-addressed inputs, KEYED
// BY THE INPUT SIGNATURE". `derive(sig, budget, depth)` reads two other
// arguments, so the same key yields different records depending on where the
// walk happened to reach it — and the first one written wins forever.

describe('the depth cap makes a record depend on WHERE it was derived, not WHAT it names', () => {

  /** MAX_RECORD_DEPTH is 24; `derive(sig, budget, 24)` returns
   *  `{ words: [], truncated: true }` before reading a manifest, and its
   *  PARENT persists that under the child's own sig. Walking down from the
   *  root, the child handed to `derive` at depth 24 is sig(25). */
  const POISONED = sig(25)

  beforeEach(() => {
    // A 30-deep chain, plus a shortcut from the root straight at the node the
    // depth cap trips on — the SAME content sig reachable at two depths.
    ROOT = sig(1)
    TREE = {}
    for (let i = 1; i <= 30; i++) TREE[sig(i)] = [{ sig: sig(i + 1), name: `Level${i}` }]
    TREE[sig(31)] = []
    TREE[ROOT] = [{ sig: sig(2), name: 'Level1' }, { sig: POISONED, name: 'Shortcut' }]
  })

  it('BLOCKER: writes an EMPTY record for a sig whose subtree is full', async () => {
    await warm(5000)
    const deep = await recordAt(POISONED)
    expect(deep, 'nothing was written for the capped node').not.toBeNull()
    expect(deep?.words.length, 'an empty record was cached for a populated subtree').toBeGreaterThan(0)
  })

  it('BLOCKER: the cached record disagrees with deriving the same sig directly', async () => {
    await warm(5000)
    fresh()
    const cached = await service().readRecord(POISONED)
    const derivedHere = await fresh().derive(POISONED, { nodes: 5000 })
    expect(
      cached?.words.length,
      'a record is supposed to be a pure function of the sig that keys it',
    ).toBe(derivedHere?.words.length)
  })

  it('BLOCKER: the poisoned record is then absorbed WHOLE by the shortcut, gutting the root', async () => {
    await warm(5000)
    // The root reached the same sig a second time as a depth-0 child, found a
    // record for it, and spliced the empty set in without descending.
    expect(await service().holds('Level25'), 'a word below the shortcut vanished from the root record').toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. A MANIFEST READ THAT BLINKS PRODUCES A COMPLETE-LOOKING RECORD
// ═══════════════════════════════════════════════════════════════════════════

describe('a transient manifest miss', () => {

  beforeEach(() => {
    ROOT = sig(1)
    TREE = {
      [sig(1)]: [{ sig: sig(2), name: 'Cigars' }, { sig: sig(3), name: 'People' }],
      [sig(2)]: [{ sig: sig(4), name: 'Lounge' }, { sig: sig(5), name: 'Humidor' }],
      [sig(3)]: [{ sig: sig(6), name: 'Alice' }],
      [sig(4)]: [], [sig(5)]: [], [sig(6)]: [],
    }
  })

  it('BLOCKER: drops a whole subtree and does NOT set truncated', async () => {
    blind = new Set([sig(2)])          // one read blinks
    await warm(5000)
    blind = new Set()                  // and recovers immediately

    const root = await recordAt(ROOT)
    expect(root?.truncated, 'a subtree vanished and the record calls itself complete').toBe(true)
  })

  it('BLOCKER: the dropped words never come back', async () => {
    blind = new Set([sig(2)])
    await warm(5000)
    blind = new Set()

    const { MoleculeIndexDrone } = await import('./molecule-index.drone.js')
    await new MoleculeIndexDrone().optimize()

    expect(await service().holds('Humidor'), 'the word is gone for the life of this root sig').toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. `truncated` IS WRITTEN AND NEVER READ
// ═══════════════════════════════════════════════════════════════════════════

describe('the truncated flag', () => {

  beforeEach(() => {
    ROOT = sig(1)
    TREE = {
      [sig(1)]: [{ sig: sig(2), name: 'Cigars' }, { sig: sig(3), name: 'People' }],
      [sig(2)]: [], [sig(3)]: [],
    }
  })

  it('BLOCKER: a record that says it is incomplete still suppresses the cold path', async () => {
    const pool = await indexPool()
    // A record admitting it is a fragment: one word out of two.
    const one = await moleculeAddress('Cigars')
    pool.files.set(ROOT, new MemFile(JSON.stringify({
      v: 1, truncated: true, words: [{ a: one, n: 'Cigars', c: 1 }],
    })))
    fresh()

    // `declaredVocabulary()` short-circuits on `indexed.size > 0` without ever
    // looking at `truncated`, so the fallback that would have supplied the
    // missing word is never consulted.
    expect(await service().holds('People'), 'an admittedly-partial record was trusted as whole').toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE "COLD PATH" IS A SECOND DERIVED CACHE
// ═══════════════════════════════════════════════════════════════════════════
//
// `fallbackVocabulary()` USED TO fold `HiveSearchService.vocabulary()`. The
// passing spec stubbed that with a walker over the fixture tree, so it was
// always complete. The REAL one reads a record out of `sign('search:index')`
// and returns an EMPTY map on a miss — it never derives. Both pools are
// declared `index` kind: recomputable, wipe-safe, GC-able. Wipe both, which is
// exactly what that licenses, and the answer was not slower — it was empty.
//
// FIXED 2026-09-03: the cold path walks children manifests from the head layer
// itself. These two cases install the REAL search reader — which now answers
// nothing at all for this hive — and prove the vocabulary comes back anyway.

describe('the fallback against the REAL search reader', () => {

  beforeEach(() => {
    ROOT = sig(1)
    TREE = {
      [sig(1)]: [{ sig: sig(2), name: 'Cigars' }, { sig: sig(3), name: 'People' }],
      [sig(2)]: [], [sig(3)]: [],
    }
  })

  it('BLOCKER: with both derived pools empty the hive can say NOTHING', async () => {
    const { HiveSearchService } = await import('../search/hive-search.service.js')
    iocValues.set('@diamondcoreprocessor.com/HiveSearchService', new HiveSearchService())
    fresh()

    // Nothing was ever minted — a fresh client, or a GC pass over two pools
    // whose declared kind is `index`.
    expect((await indexPool()).files.size).toBe(0)

    const declared = await service().declaredVocabulary()
    expect([...declared], 'the cold path answered from an empty second cache').not.toEqual([])
  })

  it('BLOCKER: warm and cold disagree once the molecule pool alone is wiped', async () => {
    const { HiveSearchService } = await import('../search/hive-search.service.js')
    iocValues.set('@diamondcoreprocessor.com/HiveSearchService', new HiveSearchService())
    fresh()

    await warm(5000)
    const warmAnswer = await service().declaredVocabulary()
    expect(warmAnswer.size).toBeGreaterThan(0)

    await wipePool()
    fresh()
    const coldAnswer = await service().declaredVocabulary()

    expect([...coldAnswer].sort(), 'identical, only slower — it is not').toEqual([...warmAnswer].sort())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. A MALFORMED RECORD THROWS RATHER THAN DEGRADING
// ═══════════════════════════════════════════════════════════════════════════
//
// `readableRecord` checks `v` and `Array.isArray(words)` and nothing about the
// entries. `vocabularyOf` then reads `word.a` outside any try/catch, so one
// bad element in a wipe-safe, GC-able pool turns every vocabulary read into an
// exception — the one failure mode a derived cache is never allowed to have.

describe('a corrupt record in the derived pool', () => {

  beforeEach(() => {
    ROOT = sig(1)
    TREE = { [sig(1)]: [{ sig: sig(2), name: 'Cigars' }], [sig(2)]: [] }
  })

  it('BLOCKER: a null entry makes holds() THROW instead of falling back', async () => {
    const pool = await indexPool()
    pool.files.set(ROOT, new MemFile(JSON.stringify({ v: 1, words: [null] })))
    fresh()
    await expect(service().holds('Cigars')).resolves.toBe(true)
  })
})

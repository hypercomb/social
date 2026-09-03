// molecule/molecule-index.cold-path.spec.ts
//
// THE PROOF THE WHOLE DERIVED-CACHE CONTRACT RESTS ON: wipe the pool and get
// IDENTICAL answers, only slower.
//
// There was no such test anywhere in this tree — two specs mention `optimize`
// and neither proves the contract — so this is written from scratch against an
// in-memory fixture. It NEVER touches real OPFS or localStorage, and the wipe
// removes SINGLE NAMED ENTRIES only, never recursively.
//
// It also pins the two properties that make the cache safe to be wrong about:
//   - the READER CANNOT MINT (no handle is ever opened with `create: true`)
//   - a DERIVATION VERSION BUMP turns every prior record into a miss

import { beforeEach, describe, expect, it } from 'vitest'
import {
  MOLECULE_DERIVATION, MOLECULE_INDEX_MEANING, MoleculeWordSet, vocabularyOf,
} from './molecule-index.js'
import { MoleculeIndexService, MOLECULE_INDEX_SERVICE_KEY } from './molecule-index.service.js'
import { moleculeAddress } from '@hypercomb/core'

// ── the fixture hive ───────────────────────────────────────────────────────
//
// Deliberately includes 'People' and 'people' as two different tiles: one
// molecule, two spellings, and the index must not report it twice.

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const ROOT = sig(1)
const TREE: Record<string, Array<{ sig: string; name: string }>> = {
  [ROOT]: [
    { sig: sig(2), name: 'Cigars' },
    { sig: sig(3), name: 'People' },
    { sig: sig(4), name: 'Notes!' },
  ],
  [sig(2)]: [
    { sig: sig(5), name: 'Lounge' },
    { sig: sig(6), name: 'Humidor' },
  ],
  [sig(3)]: [
    { sig: sig(7), name: 'people' },
    { sig: sig(8), name: 'Alice' },
  ],
  [sig(4)]: [],
  [sig(5)]: [],
  [sig(6)]: [],
  [sig(7)]: [],
  [sig(8)]: [],
}

/** Every name in the fixture — the input the cold path folds. */
const NAMES = Object.values(TREE).flat().map(child => child.name)

// ── an in-memory pool ──────────────────────────────────────────────────────

class MemFile {
  constructor(public data: string) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    const held = this.data
    return { text: async () => held }
  }
  async createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> {
    return {
      write: async (text: string) => { this.data = text },
      close: async () => {},
    }
  }
}

/** Records every `create` flag a reader asked for, so "the reader cannot mint"
 *  is asserted rather than assumed. */
const createFlags: boolean[] = []

class MemDir {
  files = new Map<string, MemFile>()
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    createFlags.push(opts?.create === true)
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

const store = {
  getPool: async (meaning: string): Promise<MemDir> => {
    const held = pools.get(meaning)
    if (held) return held
    const made = new MemDir()
    pools.set(meaning, made)
    return made
  },
  readChildrenManifest: async (parentLayerSig: string) =>
    (TREE[parentLayerSig] ?? []).map(child => ({ sig: child.sig, layer: { name: child.name } })),
}

const history = {
  sign: async (): Promise<string> => 'root-location',
  headLayer: async (): Promise<{ layerSig: string }> => ({ layerSig: ROOT }),
  getLayerBySig: async (s: string) => (TREE[s] ? { name: s } : null),
  childrenManifestFor: async (layer: { name?: string }) =>
    (TREE[String(layer?.name ?? '')] ?? []).map(child => ({ sig: child.sig, layer: { name: child.name } })),
}

/** The search reader the cold path folds — the SAME names, so equivalence is a
 *  theorem about one rule applied twice, not two implementations agreeing. */
const search = {
  vocabulary: async (): Promise<ReadonlyMap<string, { name: string; path: readonly string[] }>> => {
    const rows = new Map<string, { name: string; path: readonly string[] }>()
    const walk = (parent: string, path: readonly string[]): void => {
      for (const child of TREE[parent] ?? []) {
        const key = child.name.toLowerCase()
        const here = [...path, child.name]
        const held = rows.get(key)
        if (!held || here.length < held.path.length) rows.set(key, { name: child.name, path: here })
        walk(child.sig, here)
      }
    }
    walk(ROOT, [])
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

const indexPool = async (): Promise<MemDir> => await store.getPool(MOLECULE_INDEX_MEANING)

/** Warm the index the way the phase does: derive the root, write it. */
const warm = async (): Promise<void> => {
  const index = service()
  const rootSig = await index.rootSig()
  if (!rootSig) throw new Error('no root')
  const record = await index.derive(rootSig, { nodes: 1000 })
  if (record) await index.writeRecord(rootSig, record)
}

/** WIPE — single named entries only, never recursively, and only the derived
 *  pool. Nothing else in the fixture is touched. */
const wipePool = async (): Promise<number> => {
  const pool = await indexPool()
  const names = [...pool.files.keys()]
  for (const name of names) await pool.removeEntry(name)
  return names.length
}

beforeEach(() => {
  pools.clear()
  iocValues.clear()
  createFlags.length = 0
  installIoc()
  iocValues.set('@hypercomb.social/Store', store)
  iocValues.set('@diamondcoreprocessor.com/HistoryService', history)
  iocValues.set('@diamondcoreprocessor.com/HiveSearchService', search)
  iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
})

describe('the molecule index derives a hive\'s vocabulary', () => {

  it('folds every name to its molecule address, keyed by the SOURCE layer sig', async () => {
    await warm()
    const pool = await indexPool()
    expect(pool.files.has(ROOT)).toBe(true)
    // Records are keyed by the sig they derive FROM — never by a name, never
    // by a molecule address.
    for (const name of NAMES) {
      const address = await moleculeAddress(name)
      expect(pool.files.has(address), `${name} was used as a KEY`).toBe(false)
    }
  })

  it('is one molecule for two spellings, and counts both', async () => {
    await warm()
    const vocabulary = await service().vocabulary()
    const address = await moleculeAddress('People')
    expect(await moleculeAddress('people')).toBe(address)
    expect(vocabulary.get(address)?.c).toBe(2)
    expect(vocabulary.size).toBe(new Set(await Promise.all(NAMES.map(moleculeAddress))).size)
  })

  it('folds punctuation the same way an address does', async () => {
    await warm()
    const vocabulary = await service().vocabulary()
    expect(vocabulary.has(await moleculeAddress('notes'))).toBe(true)
    expect(vocabulary.has(await moleculeAddress('Notes!'))).toBe(true)
  })

  it('composes: a child that already has a record is spliced in whole', async () => {
    await warm()
    const pool = await indexPool()
    // The spine below the root was written on the way down, so the root's own
    // derivation had every child already recorded.
    expect(pool.files.has(sig(2))).toBe(true)
    expect(pool.files.has(sig(3))).toBe(true)
    const cigars = JSON.parse(pool.files.get(sig(2))!.data) as { words: Array<{ a: string }> }
    expect(cigars.words.map(w => w.a).sort()).toEqual(
      (await Promise.all(['Lounge', 'Humidor'].map(moleculeAddress))).sort(),
    )
  })
})

describe('the index is NEVER load-bearing — wipe the pool, get identical answers', () => {

  it('answers identically with the pool absent, only slower', async () => {
    const index = service()
    await warm()
    const warmDeclared = await index.declaredVocabulary()
    const warmVocabulary = await index.vocabulary()
    expect(warmDeclared.size).toBeGreaterThan(0)

    // A FRESH reader over the WIPED pool: no memo to answer from.
    const removed = await wipePool()
    expect(removed).toBeGreaterThan(0)
    iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
    const cold = service()

    expect((await cold.vocabulary()).size).toBe(0)          // the accelerator is gone
    const coldDeclared = await cold.declaredVocabulary()     // and the answer is not

    expect([...coldDeclared].sort()).toEqual([...warmDeclared].sort())
    const fallback = await cold.fallbackVocabulary()
    for (const address of warmDeclared) {
      expect(fallback.get(address)?.a, address).toBe(address)
    }
    // And every address in either answer is still the address of its own word.
    for (const [address, word] of warmVocabulary) {
      expect(await moleculeAddress(word.n)).toBe(address)
      expect(coldDeclared.has(address), word.n).toBe(true)
    }
  })

  it('agrees on the per-word COUNT too, now the cold path reads layers', async () => {
    // This used to pin a DIVERGENCE: the cold path folded the search reader's
    // vocabulary, and that reader had already collapsed its rows by lowercased
    // name, so a word two tiles spell differently ('People' / 'people') was two
    // occurrences warm and one cold. The cold path now walks the same children
    // manifests the deriver walks, so there is nothing left to diverge — the
    // count agrees as well as the membership.
    await warm()
    const address = await moleculeAddress('People')
    expect((await service().vocabulary()).get(address)?.c).toBe(2)

    await wipePool()
    iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
    const cold = await service().fallbackVocabulary()
    expect(cold.has(address)).toBe(true)
    expect(cold.get(address)?.c).toBe(2)
  })

  it('holds(word) answers TRUE for every word, warm or cold', async () => {
    await warm()
    for (const name of NAMES) expect(await service().holds(name), name).toBe(true)

    await wipePool()
    iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
    for (const name of NAMES) expect(await service().holds(name), `${name} (cold)`).toBe(true)
    expect(await service().holds('a-word-this-hive-never-said')).toBe(false)
  })

  it('re-derives to byte-identical records after a wipe', async () => {
    await warm()
    const pool = await indexPool()
    const before = new Map([...pool.files].map(([name, file]) => [name, file.data]))

    await wipePool()
    iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
    await warm()

    const after = new Map([...(await indexPool()).files].map(([name, file]) => [name, file.data]))
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [name, data] of before) expect(after.get(name), name).toBe(data)
  })

  it('every stored address equals the address derived from the word itself', async () => {
    await warm()
    for (const [address, word] of await service().vocabulary()) {
      expect(await moleculeAddress(word.n)).toBe(address)
    }
  })
})

describe('the reader cannot mint, and a version bump invalidates', () => {

  it('never opens a handle with create:true while reading', async () => {
    await warm()
    createFlags.length = 0
    iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
    await service().readRecord(ROOT)
    await service().vocabulary()
    expect(createFlags.length).toBeGreaterThan(0)
    expect(createFlags.some(Boolean), 'the reader opened a handle for creation').toBe(false)
  })

  it('a DERIVATION VERSION bump turns every prior record into a miss', async () => {
    await warm()
    const pool = await indexPool()
    const stored = JSON.parse(pool.files.get(ROOT)!.data) as { v: number; words: unknown[] }
    expect(stored.v).toBe(MOLECULE_DERIVATION)

    // A record written by a build whose rule was different. Reject-on-read IS
    // the invalidation — no migration, no sweep, the phase re-mints.
    pool.files.get(ROOT)!.data = JSON.stringify({ ...stored, v: MOLECULE_DERIVATION + 1 })
    iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
    expect(await service().readRecord(ROOT)).toBeNull()
    expect((await service().vocabulary()).size).toBe(0)

    // …and the cold path still answers.
    expect((await service().fallbackVocabulary()).size).toBeGreaterThan(0)
  })

  it('rejects a record whose shape is wrong, however plausible', async () => {
    const pool = await indexPool()
    for (const bad of ['{}', '[]', 'null', 'not json', JSON.stringify({ v: MOLECULE_DERIVATION })]) {
      pool.files.set(ROOT, new MemFile(bad))
      iocValues.set(MOLECULE_INDEX_SERVICE_KEY, new MoleculeIndexService())
      expect(await service().readRecord(ROOT), bad).toBeNull()
    }
  })
})

describe('the minting bee', () => {

  it('mints from what was COMMITTED, and a pass with nothing committed is free', async () => {
    const { MoleculeIndexDrone } = await import('./molecule-index.drone.js')
    const { EffectBus } = await import('@hypercomb/core')
    const drone = new MoleculeIndexDrone()

    // A pass with nothing committed does no work at all. There is no backfill:
    // deriving a root record from nothing is a whole-hive walk, and the phase
    // fires on a 2s idle timeout during boot.
    await drone.optimize()
    expect((await indexPool()).files.size, 'an idle pass on a settled hive minted something').toBe(0)

    // A commit is what funds the walk.
    EffectBus.emit('content:wrote', { sig: ROOT, kind: 'layer' })
    await drone.optimize()
    const pool = await indexPool()
    expect(pool.files.has(ROOT), 'the root record is the vocabulary — it is never the thing dropped').toBe(true)

    // A second pass is a no-op: a sig's record can never go stale, so the
    // drone SKIPS rather than refreshes.
    const before = pool.files.get(ROOT)!.data
    await drone.optimize()
    expect(pool.files.get(ROOT)!.data).toBe(before)
  })
})

describe('the word set', () => {

  it('is idempotent and order-independent — the shallowest spelling wins', () => {
    const one = new MoleculeWordSet()
    one.add('x', 'People', 2)
    one.add('x', 'people', 0)
    const two = new MoleculeWordSet()
    two.add('x', 'people', 0)
    two.add('x', 'People', 2)
    expect(JSON.stringify(one.seal())).toBe(JSON.stringify(two.seal()))
    expect(vocabularyOf(one.seal()).get('x')?.n).toBe('people')
    expect(vocabularyOf(one.seal()).get('x')?.c).toBe(2)
  })
})

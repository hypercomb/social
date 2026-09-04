// molecule/molecule-index.truncation.spec.ts
//
// ADVERSARIAL — written by a review pass, and EXPECTED TO FAIL against the
// implementation as it stands. It is the counterexample to the claim the whole
// derived-cache contract rests on: "wipe the pool and get IDENTICAL answers,
// only slower."
//
// The existing cold-path spec only ever derives with `{ nodes: 1000 }` over an
// 8-tile fixture, so the budget is never exhausted and the partial-record path
// is never entered. These cases enter it.
//
// The mechanism under test (molecule-index.service.ts, `derive`):
//
//     if (!cached) await this.writeRecord(entry.sig, child)
//
// `child` may be TRUNCATED — cut short by the node budget, or empty because the
// depth cap was hit. It is persisted anyway, keyed by the child's REAL layer
// sig. Because a sig's record "can never go stale" there is no refresh path:
// every later pass reads the partial record back and splices it in WHOLE. The
// vocabulary is then permanently short, and `holds()` answers FALSE for a word
// the hive genuinely says — wrong, not slower.

import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RECORD_DEPTH, MOLECULE_INDEX_MEANING } from './molecule-index.js'
import { MoleculeIndexService, MOLECULE_INDEX_SERVICE_KEY } from './molecule-index.service.js'
import { moleculeAddress } from '@hypercomb/core'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

// ── a hive wide enough that one pass cannot finish it ──────────────────────
//
// ROOT_ONE is the head before a commit, ROOT_TWO after — a different sig with
// the SAME children, which is exactly what a commit anywhere in the tree
// produces. A and B are unchanged, so their sigs (and their records) survive.

const ROOT_ONE = sig(1)
const ROOT_TWO = sig(99)
const BRANCH_A = sig(2)
const BRANCH_B = sig(3)

const TREE: Record<string, Array<{ sig: string; name: string }>> = {
  [ROOT_ONE]: [
    { sig: BRANCH_A, name: 'Alpha' },
    { sig: BRANCH_B, name: 'Beta' },
  ],
  [ROOT_TWO]: [
    { sig: BRANCH_A, name: 'Alpha' },
    { sig: BRANCH_B, name: 'Beta' },
  ],
  [BRANCH_A]: [
    { sig: sig(10), name: 'alpha-one' },
    { sig: sig(11), name: 'alpha-two' },
    { sig: sig(12), name: 'alpha-three' },
    { sig: sig(13), name: 'alpha-four' },
    { sig: sig(14), name: 'alpha-five' },
  ],
  [BRANCH_B]: [
    { sig: sig(20), name: 'beta-one' },
    { sig: sig(21), name: 'beta-two' },
  ],
}
for (const n of [10, 11, 12, 13, 14, 20, 21]) TREE[sig(n)] = []

/** A chain deeper than the depth cap, to reach the OTHER partial-record path. */
const DEEP_ROOT = sig(200)
const deepSig = (level: number): string => sig(300 + level)
const DEEP_NAMES: string[] = []
{
  const chain: Array<{ sig: string; name: string }> = []
  for (let level = 0; level <= MAX_RECORD_DEPTH + 2; level++) {
    const name = `deep-${level}`
    DEEP_NAMES.push(name)
    chain.push({ sig: deepSig(level), name })
  }
  TREE[DEEP_ROOT] = [chain[0]]
  for (let i = 0; i < chain.length - 1; i++) TREE[chain[i].sig] = [chain[i + 1]]
  TREE[chain[chain.length - 1].sig] = []
}

const namesUnder = (root: string): string[] => {
  const out: string[] = []
  const walk = (parent: string, seen: Set<string>): void => {
    for (const child of TREE[parent] ?? []) {
      if (seen.has(child.sig)) continue
      out.push(child.name)
      walk(child.sig, new Set([...seen, child.sig]))
    }
  }
  walk(root, new Set([root]))
  return out
}

// ── in-memory pool + fixture services (no OPFS, no localStorage) ───────────

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

const store = {
  getPool: async (meaning: string): Promise<MemDir> => {
    const held = pools.get(meaning)
    if (held) return held
    const made = new MemDir()
    pools.set(meaning, made)
    return made
  },
  readChildrenManifest: async (parentLayerSig: string) =>
    (TREE[parentLayerSig] ?? []).map(c => ({ sig: c.sig, layer: { name: c.name } })),
}

/** The head the reader will see. Flipped to simulate a commit. */
let head = ROOT_ONE

const history = {
  sign: async (): Promise<string> => 'root-location',
  headLayer: async (): Promise<{ layerSig: string }> => ({ layerSig: head }),
  getLayerBySig: async (s: string) => (TREE[s] ? { name: s } : null),
  childrenManifestFor: async (layer: { name?: string }) =>
    (TREE[String(layer?.name ?? '')] ?? []).map(c => ({ sig: c.sig, layer: { name: c.name } })),
}

/** The cold path's source — every name under the current head. */
const search = {
  vocabulary: async (): Promise<ReadonlyMap<string, { name: string; path: readonly string[] }>> => {
    const rows = new Map<string, { name: string; path: readonly string[] }>()
    for (const name of namesUnder(head)) {
      rows.set(name.toLowerCase(), { name, path: [name] })
    }
    return rows
  },
}

const iocValues = new Map<string, unknown>()
const service = (): MoleculeIndexService =>
  iocValues.get(MOLECULE_INDEX_SERVICE_KEY) as MoleculeIndexService
const freshService = (): MoleculeIndexService => {
  const made = new MoleculeIndexService()
  iocValues.set(MOLECULE_INDEX_SERVICE_KEY, made)
  return made
}
const indexPool = async (): Promise<MemDir> => await store.getPool(MOLECULE_INDEX_MEANING)

beforeEach(() => {
  pools.clear()
  iocValues.clear()
  head = ROOT_ONE
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: <T>(key: string): T | undefined => iocValues.get(key) as T | undefined,
    register: (key: string, value: unknown): void => { iocValues.set(key, value) },
    list: (): unknown[] => [...iocValues.values()],
  }
  iocValues.set('@hypercomb.social/Store', store)
  iocValues.set('@diamondcoreprocessor.com/HistoryService', history)
  iocValues.set('@diamondcoreprocessor.com/HiveSearchService', search)
  freshService()
})

describe('a budget-cut derivation must not persist a partial record', () => {

  it('never writes a record that says truncated — complete-or-absent', async () => {
    // Four nodes of budget cannot finish Alpha's five children, let alone Beta.
    const record = await service().derive(ROOT_ONE, { nodes: 4 })
    expect(record?.truncated).toBe(true)

    const pool = await indexPool()
    for (const [name, file] of pool.files) {
      const stored = JSON.parse(file.data) as { truncated?: boolean }
      expect(stored.truncated, `a PARTIAL record was persisted under ${name}`).toBeUndefined()
    }
  })

  it('does not permanently mask words when a later pass has budget to spare', async () => {
    // Pass one: starved. Alpha's record is cut short and written anyway.
    const starved = service()
    const first = await starved.derive(ROOT_ONE, { nodes: 4 })
    if (first) await starved.writeRecord(ROOT_ONE, first)

    // A commit lands: a new head sig, the same unchanged children.
    head = ROOT_TWO

    // Pass two, on a fresh reader with a generous budget — the healing pass
    // that is supposed to exist. Alpha's sig is unchanged, so its PARTIAL
    // record is read back and spliced in whole; it is never descended into.
    const rich = freshService()
    const second = await rich.derive(ROOT_TWO, { nodes: 10_000 })
    expect(second).not.toBeNull()
    if (second) await rich.writeRecord(ROOT_TWO, second)

    const vocabulary = await freshService().vocabulary()
    for (const name of namesUnder(ROOT_TWO)) {
      const address = await moleculeAddress(name)
      expect(vocabulary.has(address), `'${name}' is unsayable even after a well-funded pass`).toBe(true)
    }
  })

  it('holds(word) is wrong, not slow, once a partial record is cached', async () => {
    const starved = service()
    const first = await starved.derive(ROOT_ONE, { nodes: 4 })
    if (first) await starved.writeRecord(ROOT_ONE, first)

    // declaredVocabulary() prefers the index whenever it is non-empty, so a
    // SHORT index silently wins over the cold path that has the right answer.
    const warm = freshService()
    const cold = await warm.fallbackVocabulary()

    for (const name of namesUnder(ROOT_ONE)) {
      const address = await moleculeAddress(name)
      expect(cold.has(address), `the cold path lost '${name}'`).toBe(true)
      expect(await warm.holds(name), `holds('${name}') answered FALSE for a word the hive says`).toBe(true)
    }
  })

  it('tells a caller the answer is partial, the way search does', async () => {
    const starved = service()
    const first = await starved.derive(ROOT_ONE, { nodes: 4 })
    if (first) await starved.writeRecord(ROOT_ONE, first)

    // HiveSearchService surfaces `record.truncated` to its caller as `partial`.
    // The molecule reader drops it, so "no" and "I could not finish looking"
    // are the same answer.
    const reader = freshService() as unknown as {
      declaredVocabularyPartial?: () => Promise<boolean>
      vocabularyTruncated?: () => Promise<boolean>
    }
    const surfaced = reader.declaredVocabularyPartial ?? reader.vocabularyTruncated
    expect(typeof surfaced, 'no reader API surfaces `truncated`').toBe('function')
  })
})

describe('the depth cap must not persist an empty record under a real sig', () => {

  it('does not write an empty record for a subtree it merely refused to walk', async () => {
    const index = service()
    const record = await index.derive(DEEP_ROOT, { nodes: 10_000 })
    if (record) await index.writeRecord(DEEP_ROOT, record)

    const pool = await indexPool()
    const empties = [...pool.files.entries()]
      .filter(([, file]) => {
        const stored = JSON.parse(file.data) as { words?: unknown[]; truncated?: boolean }
        return stored.truncated === true && (stored.words?.length ?? 0) === 0
      })
      .map(([name]) => name)

    // An EMPTY record keyed by a real layer sig is the worst shape available:
    // it is a cache hit, so the subtree beneath it is never walked again, from
    // anywhere — including from a shallower parent that had depth to spare.
    expect(empties, 'empty depth-cap records were persisted under real layer sigs').toEqual([])
  })

  it('a subtree reachable shallowly stays sayable after a deep walk cached it empty', async () => {
    // Walk the deep chain first, so the cap fires and (today) writes empties.
    const deep = service()
    const record = await deep.derive(DEEP_ROOT, { nodes: 10_000 })
    if (record) await deep.writeRecord(DEEP_ROOT, record)

    // Now ask for the SAME subtree from one level up: a fresh, well-funded
    // derivation that should see everything.
    const capped = TREE[deepSig(MAX_RECORD_DEPTH - 1)]?.[0]
    expect(capped).toBeDefined()

    const shallow = freshService()
    const near = await shallow.derive(deepSig(MAX_RECORD_DEPTH - 2), { nodes: 10_000 })
    const addresses = new Set((near?.words ?? []).map(w => w.a))
    expect(
      addresses.has(await moleculeAddress(capped!.name)),
      `'${capped!.name}' is invisible from a parent that had depth to spare`,
    ).toBe(true)
  })
})

// diamond-core-processor/src/app/core/home-revision-restore.spec.ts
//
// HOME REVISIONS ARE LOADABLE — proof that a saved install revision can be
// restored by clicking its row, and that the restore actually HOLDS.
//
// The hole these tests close: the hive mounts branches by the participant's
// feature FLAGS (settings sigbag), and every logical recompute reads those
// same flags — but a home save used to freeze only the logical root POINTER.
// Restoring the pointer left the flags stale, so the restore changed nothing
// the hive renders, and the next toggle recomputed the union straight back
// from the unrestored flags. A revision you cannot load is not a revision.
//
// What these tests freeze:
//   1. `saveBranch` freezes the ENABLED SET (refs) alongside the logical root.
//   2. `restoreEnabledSet` flips the flags to exactly the frozen set and
//      recomputes — the union follows the flags.
//   3. The restore SURVIVES the next recompute (the original regression).
//   4. A branch adopted AFTER the save restores to OFF (absent = off).
//   5. A legacy save (no refs) still reads back pointer-only, so the old
//      restore path stays reachable for it.
//   6. Restoring on a COLD instance never clobbers other settings — the
//      settings cache self-warms before the flip persists.
//   7. Two saves of the same union under different flag sets are distinct
//      rows (refs participate in addBranch's idempotence check).
//
// Drives the REAL DcpDomainStorage against an in-memory OPFS.

import { describe, it, expect, beforeEach } from 'vitest'

// ---- in-memory OPFS (the slice DcpDomainStorage touches) ------------

async function toBytes(data: unknown): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return new Uint8Array(data)
  const blobish = data as { arrayBuffer?: () => Promise<ArrayBuffer>; text?: () => Promise<string> }
  if (typeof blobish?.arrayBuffer === 'function') return new Uint8Array(await blobish.arrayBuffer())
  if (typeof blobish?.text === 'function') return new TextEncoder().encode(await blobish.text())
  if (data instanceof Blob) {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(data)
    })
    return new TextEncoder().encode(text)
  }
  return new Uint8Array(0)
}

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; size: number }> {
    const slice = this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer
    return {
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(this.bytes)),
      size: this.bytes.byteLength,
    }
  }
  async createWritable(): Promise<{ write(d: unknown): Promise<void>; close(): Promise<void> }> {
    return {
      write: async (data: unknown) => { this.bytes = await toBytes(data) },
      close: async () => { /* committed on write */ },
    }
  }
}

class MockDir {
  kind = 'directory' as const
  children = new Map<string, MockDir | MockFile>()
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDir> {
    const hit = this.children.get(name)
    if (hit instanceof MockDir) return hit
    if (!opts?.create) throw new Error(`NotFoundError: ${name}`)
    const dir = new MockDir(name)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFile> {
    const hit = this.children.get(name)
    if (hit instanceof MockFile) return hit
    if (!opts?.create) throw new Error(`NotFoundError: ${name}`)
    const file = new MockFile(name)
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string): Promise<void> { this.children.delete(name) }

  async *entries(): AsyncGenerator<[string, MockDir | MockFile]> {
    for (const [k, v] of [...this.children]) yield [k, v]
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<[string, MockDir | MockFile]> {
    for (const [k, v] of [...this.children]) yield [k, v]
  }
}

let opfsRoot: MockDir

// ---- suite ----------------------------------------------------------

import type { DcpDomainStorage } from './dcp-domain-storage.service'

const BRANCH_A = 'a'.repeat(64)
const BRANCH_B = 'b'.repeat(64)
const REF_BASE = '1'.repeat(64)
const REF_A1 = '2'.repeat(64)
const REF_A2 = '3'.repeat(64)
const REF_B1 = '4'.repeat(64)

describe('home revisions are loadable', () => {
  let storage: DcpDomainStorage

  /** A fresh service over the SAME mock OPFS — a reload, not a wipe. */
  async function freshInstance(): Promise<DcpDomainStorage> {
    const mod = await import('./dcp-domain-storage.service')
    return new mod.DcpDomainStorage()
  }

  /** Seed: a base ref (always-in), two adopted branches with refs. */
  async function seed(): Promise<void> {
    await storage.addDefaultBranch(REF_BASE, [], 'baseline', [REF_BASE])
    await storage.addDomain('example.com')
    await storage.addDomainBranch('example.com', BRANCH_A, [], 'alpha', [REF_A1, REF_A2], 'content')
    await storage.addDomainBranch('example.com', BRANCH_B, [], 'beta', [REF_B1], 'content')
  }

  beforeEach(async () => {
    opfsRoot = new MockDir('/')
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { getDirectory: async () => opfsRoot } },
      configurable: true,
      writable: true,
    })
    storage = await freshInstance()
    await seed()
  })

  it('saveBranch freezes the enabled set alongside the logical root', async () => {
    await storage.setFeatureEnabled(BRANCH_A, true)
    await storage.recomputeLogical()
    await storage.saveBranch('point')

    const history = await storage.loadHomeHistory()
    expect(history).toHaveLength(1)
    expect(history[0].name).toBe('point')
    expect(history[0].logicalRootSig).toMatch(/^[a-f0-9]{64}$/)
    expect(history[0].enabledBranchSigs).toEqual([BRANCH_A])
  })

  it('loading a row restores the flags — and the union follows them', async () => {
    await storage.setFeatureEnabled(BRANCH_A, true)
    await storage.recomputeLogical()
    await storage.saveBranch('just-alpha')

    // Move on: beta joins the install.
    await storage.setFeatureEnabled(BRANCH_B, true)
    await storage.recomputeLogical()
    expect((await storage.loadLogical()).sort()).toEqual([REF_BASE, REF_A1, REF_A2, REF_B1].sort())

    // Click the row.
    const saved = (await storage.loadHomeHistory())[0]
    await storage.restoreEnabledSet(new Set(saved.enabledBranchSigs))

    expect(storage.isFeatureEnabled(BRANCH_A)).toBe(true)
    expect(storage.isFeatureEnabled(BRANCH_B)).toBe(false)
    expect((await storage.loadLogical()).sort()).toEqual([REF_BASE, REF_A1, REF_A2].sort())
  })

  it('the restore SURVIVES the next recompute (the original regression)', async () => {
    await storage.setFeatureEnabled(BRANCH_A, true)
    await storage.recomputeLogical()
    await storage.saveBranch('just-alpha')
    await storage.setFeatureEnabled(BRANCH_B, true)
    await storage.recomputeLogical()

    const saved = (await storage.loadHomeHistory())[0]
    await storage.restoreEnabledSet(new Set(saved.enabledBranchSigs))

    // A pointer-only restore died right here: recompute read stale flags
    // and silently brought beta back. The flags ARE restored now.
    await storage.recomputeLogical()
    expect((await storage.loadLogical()).sort()).toEqual([REF_BASE, REF_A1, REF_A2].sort())
  })

  it('a branch adopted after the save restores to OFF', async () => {
    await storage.setFeatureEnabled(BRANCH_A, true)
    await storage.recomputeLogical()
    await storage.saveBranch('before-gamma')

    const BRANCH_C = 'c'.repeat(64)
    const REF_C1 = '5'.repeat(64)
    await storage.addDomainBranch('example.com', BRANCH_C, [], 'gamma', [REF_C1], 'content')
    await storage.setFeatureEnabled(BRANCH_C, true)
    await storage.recomputeLogical()

    const saved = (await storage.loadHomeHistory())[0]
    await storage.restoreEnabledSet(new Set(saved.enabledBranchSigs))

    expect(storage.isFeatureEnabled(BRANCH_C)).toBe(false)
    expect((await storage.loadLogical())).not.toContain(REF_C1)
  })

  it('a legacy save (no refs) reads back pointer-only', async () => {
    await storage.setFeatureEnabled(BRANCH_A, true)
    const { rootSig } = await storage.recomputeLogical()
    // A save from before the enabled set was frozen: entry without refs.
    await storage.addBranch('home', 'home', rootSig!, [], 'old-save')

    const history = await storage.loadHomeHistory()
    expect(history).toHaveLength(1)
    expect(history[0].enabledBranchSigs).toBeUndefined()
  })

  it('restoring on a cold instance never clobbers other settings', async () => {
    await storage.setDomainVisible('example.com', false)
    await storage.setFeatureEnabled(BRANCH_A, true)
    await storage.recomputeLogical()
    await storage.saveBranch('point')

    // A reload: fresh instance, cold settings cache.
    const cold = await freshInstance()
    const saved = (await cold.loadHomeHistory())[0]
    await cold.restoreEnabledSet(new Set(saved.enabledBranchSigs))

    await cold.loadSettingsCache()
    expect(cold.isDomainVisible('example.com')).toBe(false)
    expect(cold.isFeatureEnabled(BRANCH_A)).toBe(true)
  })

  it('save + restore work for a package with NO domains-lineage entry (flag-only)', async () => {
    // Live repro on an aged installer profile: packages installed
    // standalone never enter the domains lineage, so a lineage-walking
    // save froze [] every time — the second adopt's named row deduped
    // against the first ([] === []) and silently never appeared, and a
    // restore had nothing to flip. The flags are the truth; the revision
    // system must ride them alone.
    const PKG = 'd'.repeat(64)     // no addDomainBranch for this one
    await storage.setFeatureEnabled(PKG, true)
    await storage.recomputeLogical()
    await storage.saveBranch('with-pkg')

    const history = await storage.loadHomeHistory()
    expect(history[0].enabledBranchSigs).toEqual([PKG])

    // Turn it off, then load the row — the flag must come back.
    await storage.setFeatureEnabled(PKG, false)
    await storage.restoreEnabledSet(new Set(history[0].enabledBranchSigs))
    expect(storage.isFeatureEnabled(PKG)).toBe(true)

    // And two saves under DIFFERENT flag sets are distinct rows even
    // when the logical union never changes (no refs in play at all).
    await storage.setFeatureEnabled(PKG, false)
    await storage.recomputeLogical()
    await storage.saveBranch('without-pkg')
    expect((await storage.loadHomeHistory()).map(h => h.name).sort())
      .toEqual(['with-pkg', 'without-pkg'])
  })

  it('the FIRST adopt on a pre-logical install still saves its restore point', async () => {
    // An install that predates the logical lineage: domains adopted (the
    // seed), flags set, but NO recompute ever ran — the logical head was
    // never materialized. saveBranch/captureLogicalAsDefault must
    // materialize it rather than fail (live repro: "default restore point
    // was not saved" stopped the first adopt on the installer).
    await storage.setFeatureEnabled(BRANCH_A, true)
    expect(await storage.markerCount('logical')).toBe(0)

    const baseline = await storage.captureLogicalAsDefault()
    const saved = await storage.saveBranch('Default')
    expect(baseline).toMatch(/^[a-f0-9]{64}$/)
    expect(saved).toMatch(/^[a-f0-9]{64}$/)
    expect(await storage.markerCount('logical')).toBeGreaterThan(0)
    expect((await storage.loadHomeHistory())[0].name).toBe('Default')
  })

  it('two saves of the same union under different flag sets are distinct rows', async () => {
    // beta's ref shadowed by... nothing shared here, so build the overlap:
    // gamma's refs are a subset of alpha's — enabling it changes no bytes.
    const BRANCH_C = 'c'.repeat(64)
    await storage.addDomainBranch('example.com', BRANCH_C, [], 'gamma', [REF_A1], 'content')

    await storage.setFeatureEnabled(BRANCH_A, true)
    await storage.recomputeLogical()
    await storage.saveBranch('alpha-only')

    await storage.setFeatureEnabled(BRANCH_C, true)
    await storage.recomputeLogical()   // same union — gamma adds nothing new
    await storage.saveBranch('alpha-and-gamma')

    const history = await storage.loadHomeHistory()
    expect(history.map(h => h.name).sort()).toEqual(['alpha-and-gamma', 'alpha-only'])
    const sets = history.map(h => (h.enabledBranchSigs ?? []).join(','))
    expect(new Set(sets).size).toBe(2)
  })
})

// core/pool-kinds.spec.ts
//
// A HOSTILE KIND RECORD CANNOT WIDEN ANY DELETION.
//
// The kind is a decoration: advisory for reading, never authoritative for a
// delete. That is proved here in three layers, weakest to strongest:
//
//   1. BEHAVIOURAL — every kind × every exported guard, over fixtures each
//      guard refuses, asserting the verdict is BYTE-IDENTICAL to the run with
//      no record declared. Written as equality against the no-record run
//      rather than as expected-veto strings, so it survives any future
//      rewording of directory-safety's messages.
//   2. TYPE-LEVEL — no destruction primitive takes a kind, so a caller
//      physically cannot pass one. Stronger than a runtime refusal: the
//      widening is impossible by construction rather than declined.
//   3. STRUCTURAL — `directory-safety.ts` does not name anything in this
//      module. The guard cannot consult kinds because it does not know they
//      exist, and this fails the moment someone wires the two together.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  documentSweepVeto, documentSweepVetoFor, hardDeleteVeto, hardDeleteVetoFor,
  planNamedRemoval, planNamedRemovalFor, type DirectoryEntry,
} from './directory-safety.js'
import {
  declarePoolKind, isPoolKind, poolKindFacts, poolKindOfAddress, poolKindOfMeaning,
  poolKinds, readClaim, type PoolKind,
} from './pool-kinds.js'
import { registerPoolMeaning } from './pool-registry.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const KINDS: readonly PoolKind[] = ['set', 'index', 'document', 'succession']

/** A directory handle over a fixed entry list. */
const handleOf = (entries: readonly DirectoryEntry[]): {
  entries: () => AsyncIterable<[string, { kind?: string }]>
} => ({
  entries: async function* () {
    for (const entry of entries) {
      yield [entry.name, { kind: entry.isDirectory ? 'directory' : 'file' }] as [string, { kind?: string }]
    }
  },
})

/** Fixtures each guard must refuse. */
const FIXTURES: ReadonlyArray<{ why: string; entries: DirectoryEntry[] }> = [
  { why: 'a marker among members', entries: [{ name: '00000000' }, { name: SIG_A }] },
  { why: 'an author bucket', entries: [{ name: SIG_A, isDirectory: true }] },
  { why: 'a foreign name', entries: [{ name: 'notes.json' }] },
  { why: 'pure members', entries: [{ name: SIG_A }, { name: SIG_B }] },
  { why: 'pure markers', entries: [{ name: '00000000' }, { name: '00000001' }] },
  { why: 'empty', entries: [] },
]

describe('pool kinds — the four kinds and their facts', () => {

  it('answers deletion, wipe-safety and replication in one lookup', () => {
    expect(poolKindFacts('index')).toEqual({ kind: 'index', deletion: 'never-recompute', wipeSafe: true, replicates: false })
    expect(poolKindFacts('set')?.replicates).toBe(true)
    expect(poolKindFacts('document')?.deletion).toBe('replaces-siblings')
    expect(poolKindFacts('succession')?.deletion).toBe('own-bucket')
  })

  it('is keyed by MEANING and reached by ADDRESS, so a kind never re-addresses', async () => {
    const before = await registerPoolMeaning('search:index')
    expect((await poolKindOfAddress(before))?.kind).toBe('index')
    // A pool that has never been declared answers `undefined`, which is the
    // honest answer and not a default.
    expect(poolKindOfMeaning('a-word-nobody-declared')).toBeUndefined()
    // Declaring one does not move the address.
    declarePoolKind('a-word-nobody-declared', 'set')
    expect(await registerPoolMeaning('search:index')).toBe(before)
  })

  it('first declaration wins — nobody re-shapes someone else\'s pool', () => {
    declarePoolKind('molecule:index', 'document')
    expect(poolKindOfMeaning('molecule:index')?.kind).toBe('index')
    expect(poolKinds().get('molecule:index')).toBe('index')
  })

  it('validates a wire claim as DATA, with no side effect', () => {
    expect(readClaim({ address: SIG_A, kind: 'document', by: 'someone' }))
      .toEqual({ address: SIG_A, kind: 'document', by: 'someone' })
    expect(readClaim({ address: 'not-a-sig', kind: 'set' })).toBeNull()
    expect(readClaim({ address: SIG_A, kind: 'wipe-everything' })).toBeNull()
    expect(readClaim(null)).toBeNull()
    expect(isPoolKind('index')).toBe(true)
    expect(isPoolKind('shred')).toBe(false)
  })
})

describe('a hostile kind record cannot widen any deletion', () => {

  it('leaves every synchronous verdict byte-identical, for every kind', () => {
    for (const fixture of FIXTURES) {
      const hardBefore = hardDeleteVeto(fixture.entries)
      const sweepBefore = documentSweepVeto(fixture.entries)
      const planBefore = JSON.stringify(planNamedRemoval(fixture.entries, [SIG_A, SIG_B]))

      for (const kind of KINDS) {
        // Declare the kind by every route a caller could take, including the
        // one whose SANCTIONED behaviour is a sibling sweep.
        declarePoolKind(`hostile:${kind}:${fixture.why}`, kind)
        const claim = readClaim({ address: SIG_A, kind, by: 'a peer' })
        expect(claim?.kind).toBe(kind)

        expect(hardDeleteVeto(fixture.entries), `${kind} / ${fixture.why}`).toBe(hardBefore)
        expect(documentSweepVeto(fixture.entries), `${kind} / ${fixture.why}`).toBe(sweepBefore)
        expect(JSON.stringify(planNamedRemoval(fixture.entries, [SIG_A, SIG_B])), `${kind} / ${fixture.why}`).toBe(planBefore)
      }
    }
  })

  it('leaves every handle-reading verdict byte-identical, for every kind', async () => {
    for (const fixture of FIXTURES) {
      const hardBefore = await hardDeleteVetoFor(handleOf(fixture.entries))
      const sweepBefore = await documentSweepVetoFor(handleOf(fixture.entries))
      const planBefore = JSON.stringify(await planNamedRemovalFor(handleOf(fixture.entries), [SIG_A]))

      for (const kind of KINDS) {
        declarePoolKind(`hostile-handle:${kind}:${fixture.why}`, kind)
        readClaim({ address: SIG_A, kind })
        expect(await hardDeleteVetoFor(handleOf(fixture.entries)), `${kind} / ${fixture.why}`).toBe(hardBefore)
        expect(await documentSweepVetoFor(handleOf(fixture.entries)), `${kind} / ${fixture.why}`).toBe(sweepBefore)
        expect(JSON.stringify(await planNamedRemovalFor(handleOf(fixture.entries), [SIG_A])), `${kind} / ${fixture.why}`).toBe(planBefore)
      }
    }
  })

  it("a 'document' claim on a directory holding markers is still refused, with the MARKER's reason", () => {
    declarePoolKind('hostile:markers-present', 'document')
    const entries: DirectoryEntry[] = [{ name: '00000000' }, { name: SIG_A }]
    expect(documentSweepVeto(entries)).toContain('lineage marker')
    expect(hardDeleteVeto(entries)).toContain('shared')
    expect(planNamedRemoval(entries, [SIG_A]).refused).toContain('lineage marker')
    expect(planNamedRemoval(entries, [SIG_A]).remove).toEqual([])
  })

  it('TYPE LEVEL: no destruction primitive accepts a kind — a caller cannot pass one', () => {
    // Arity is the machine-checkable half of "impossible by construction".
    expect(hardDeleteVeto.length).toBe(1)
    expect(hardDeleteVetoFor.length).toBe(1)
    expect(documentSweepVeto.length).toBe(1)
    expect(documentSweepVetoFor.length).toBe(1)
    expect(planNamedRemoval.length).toBe(2)
    expect(planNamedRemovalFor.length).toBe(2)
  })

  it('STRUCTURAL: directory-safety.ts does not name anything in pool-kinds.ts', () => {
    const guard = readFileSync(join(__dirname, 'directory-safety.ts'), 'utf8')
    for (const token of ['pool-kinds', 'PoolKind', 'poolKindOf', 'PoolKindClaim', 'declarePoolKind', 'readClaim']) {
      expect(guard.includes(token), `directory-safety.ts names ${token} — the guard must not know kinds exist`).toBe(false)
    }
  })

  it('STRUCTURAL: pool-kinds.ts imports no destruction primitive', () => {
    const kinds = readFileSync(join(__dirname, 'pool-kinds.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    expect(kinds.includes("from './directory-safety.js'")).toBe(false)
    expect(kinds.includes('removeEntry')).toBe(false)
  })
})

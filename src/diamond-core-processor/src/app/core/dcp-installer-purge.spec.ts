// diamond-core-processor/src/app/core/dcp-installer-purge.spec.ts

//
// The purge invariant: re-installing a domain removes layers the fresh
// manifest dropped, and NEVER removes patched-cascade layers or anything a
// patched tree still points at. Patched bytes live only in the domain scope
// (dcp-store.patchedLayersDir) — deleting them is unrecoverable.

import { describe, expect, it } from 'vitest'
import {
  layerChildSignatures,
  patchedLayerSignatures,
  reachableLayerSignatures,
  staleEntryNames,
} from './dcp-installer.service'
import type { PatchRecord } from './patch-store'

const sig = (label: string): string => label.repeat(64).slice(0, 64)

const ROOT = sig('a')
const CHILD = sig('b')
const DROPPED = sig('c')
const PATCHED_ROOT = sig('d')
const PATCHED_CHILD = sig('e')

const patch = (over: Partial<PatchRecord> = {}): PatchRecord => ({
  id: 1,
  originalFileSig: sig('1'),
  newFileSig: sig('2'),
  originalRootSig: ROOT,
  newRootSig: PATCHED_ROOT,
  kind: 'bee',
  lineage: 'presentation/tiles',
  timestamp: 0,
  cascadedLayers: [{ oldSig: ROOT, newSig: PATCHED_ROOT }],
  ...over,
})

describe('staleEntryNames', () => {
  it('removes signature files the manifest no longer lists', () => {
    expect(staleEntryNames([ROOT, DROPPED], new Set([ROOT]))).toEqual([DROPPED])
  })

  it('leaves everything that is not signature-named alone', () => {
    expect(staleEntryNames(['manifest.cache.json', 'active.json'], new Set())).toEqual([])
  })

  it('matches a signature through its .json / .js extension', () => {
    expect(staleEntryNames([`${ROOT}.json`, `${DROPPED}.js`], new Set([ROOT])))
      .toEqual([`${DROPPED}.js`])
  })
})

describe('patchedLayerSignatures', () => {
  it('keeps the cascaded rewrites and the new root', () => {
    expect(patchedLayerSignatures([patch()])).toContain(PATCHED_ROOT)
  })

  it('does NOT keep the original signature a cascade replaced', () => {
    const kept = patchedLayerSignatures([
      patch({ cascadedLayers: [{ oldSig: DROPPED, newSig: PATCHED_ROOT }] }),
    ])
    expect(kept).not.toContain(DROPPED)
  })

  it('survives a malformed record without throwing', () => {
    expect(patchedLayerSignatures([{ cascadedLayers: undefined } as unknown as PatchRecord]))
      .toEqual([])
  })
})

describe('layerChildSignatures', () => {
  it('reads cells, then the legacy layers / children names', () => {
    expect(layerChildSignatures({ cells: [CHILD] })).toEqual([CHILD])
    expect(layerChildSignatures({ layers: [CHILD] })).toEqual([CHILD])
    expect(layerChildSignatures({ children: [CHILD] })).toEqual([CHILD])
    expect(layerChildSignatures({ name: 'leaf' })).toEqual([])
  })
})

describe('reachableLayerSignatures', () => {
  const tree: Record<string, unknown> = {
    [PATCHED_ROOT]: { name: 'root', cells: [PATCHED_CHILD, CHILD] },
    [PATCHED_CHILD]: { name: 'patched child', cells: [] },
    [CHILD]: { name: 'untouched original', cells: [] },
  }
  const readLayer = async (s: string) => tree[s] ?? null

  it('walks a patched tree down to the ORIGINAL layers it still references', async () => {
    const reachable = await reachableLayerSignatures([PATCHED_ROOT], readLayer)
    expect([...reachable].sort()).toEqual([PATCHED_ROOT, PATCHED_CHILD, CHILD].sort())
  })

  it('terminates on a cycle', async () => {
    const cyclic: Record<string, unknown> = {
      [ROOT]: { cells: [CHILD] },
      [CHILD]: { cells: [ROOT] },
    }
    const reachable = await reachableLayerSignatures([ROOT], async s => cyclic[s] ?? null)
    expect([...reachable].sort()).toEqual([ROOT, CHILD].sort())
  })

  it('ends the branch when a layer is missing or unreadable', async () => {
    const reachable = await reachableLayerSignatures(
      [PATCHED_ROOT],
      async s => { if (s === PATCHED_CHILD) throw new Error('unreadable'); return tree[s] ?? null },
    )
    expect(reachable.has(PATCHED_ROOT)).toBe(true)
    expect(reachable.has(PATCHED_CHILD)).toBe(true)
  })
})

describe('the purge invariant', () => {
  // The regression: liveSigs used to be manifest.layers ALONE, so every
  // sig-distinct patched layer sharing the domain scope was purged.
  it('never purges a patched cascade, and still purges what the manifest dropped', async () => {
    const scope = [ROOT, CHILD, DROPPED, PATCHED_ROOT, PATCHED_CHILD, 'manifest.cache.json']
    const patchedTree: Record<string, unknown> = {
      [PATCHED_ROOT]: { cells: [PATCHED_CHILD, CHILD] },
      [PATCHED_CHILD]: { cells: [] },
      [CHILD]: { cells: [] },
    }
    const patches = [patch({ cascadedLayers: [
      { oldSig: sig('9'), newSig: PATCHED_CHILD },
      { oldSig: ROOT, newSig: PATCHED_ROOT },
    ] })]

    const manifestOnly = new Set([ROOT, CHILD])   // the fresh manifest
    // What the bug did: the manifest alone marks the patched cascade stale.
    expect(staleEntryNames(scope, manifestOnly)).toContain(PATCHED_ROOT)

    const live = new Set(manifestOnly)
    for (const s of await reachableLayerSignatures(
      patchedLayerSignatures(patches),
      async s => patchedTree[s] ?? null,
    )) live.add(s)

    const stale = staleEntryNames(scope, live)
    expect(stale).not.toContain(PATCHED_ROOT)
    expect(stale).not.toContain(PATCHED_CHILD)
    expect(stale).toEqual([DROPPED])
  })
})

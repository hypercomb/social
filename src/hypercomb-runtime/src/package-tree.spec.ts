// package-tree.spec.ts — a package is a branch at any depth; what runs is the
// trunk with picks laid over it by path; a pick that hides keeps the picks
// beneath it without applying them.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import {
  PICKS_KEY, changedBeneath, composeDependencies, enabledBees, missingNamespaces, movedPaths, namespaceOf,
  orderRevisions, ownerOf, readPicks, walkTree, withAncestors, writePicks, type PackagePick,
} from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const world = () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const origin = new Map<string, Uint8Array<ArrayBuffer>>()
  const io: ReplicationIo = {
    read: async (sig) => heap.get(sig) ?? null,
    fetch: async (sig) => origin.get(sig) ?? null,
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  const layer = async (name: string, cells: string[] = [], bees: string[] = [], extra: object = {}): Promise<string> => {
    const bytes = encode(JSON.stringify({ name, cells, bees, dependencies: [], ...extra }))
    const sig = await sigOf(bytes)
    origin.set(sig, bytes)
    return sig
  }
  const blob = async (text: string): Promise<string> => {
    const bytes = encode(text)
    const sig = await sigOf(bytes)
    origin.set(sig, bytes)
    return sig
  }
  return { heap, origin, io, layer, blob }
}

const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

const pick = (layer: string, root: string, hides = false): PackagePick => ({ layer, root, hides, at: 1 })

/** games { arkanoid { themes }, bubble } · notes — every layer with one bee of its own. */
const trunk = async (w: ReturnType<typeof world>, arkanoidBee = 'ark1') => {
  const bees: Record<string, string> = {}
  for (const name of ['games', arkanoidBee, 'themes', 'bubble', 'notes']) bees[name] = await w.blob(`// bee ${name}`)
  const themes = await w.layer('themes', [], [bees['themes']!])
  const arkanoid = await w.layer('arkanoid', [themes], [bees[arkanoidBee]!], { docs: { description: 'bricks' } })
  const bubble = await w.layer('bubble', [], [bees['bubble']!])
  const games = await w.layer('games', [arkanoid, bubble], [bees['games']!])
  const notes = await w.layer('notes', [], [bees['notes']!])
  const root = await w.layer('root', [games, notes])
  return { root, games, arkanoid, themes, bubble, notes, bees }
}

describe('the package tree', () => {
  it('names every package by its path, at every depth, with only its own bees', async () => {
    const w = world()
    const t = await trunk(w)
    const walk = await walkTree(t.root, w.io)

    expect(walk.complete).toBe(true)
    expect(walk.nodes.map(n => n.path)).toEqual(['games', 'games/arkanoid', 'games/arkanoid/themes', 'games/bubble', 'notes'])
    const arkanoid = walk.nodes.find(n => n.path === 'games/arkanoid')!
    expect(arkanoid).toMatchObject({ name: 'arkanoid', layerSig: t.arkanoid, base: t.arkanoid, bees: [t.bees['ark1']], children: ['games/arkanoid/themes'], description: 'bricks' })
    expect(walk.nodes.find(n => n.path === 'games')!.children).toEqual(['games/arkanoid', 'games/bubble'])
    expect(walk.layers).toHaveLength(6)
    expect(walk.applied).toEqual([])
  })

  it('a pick replaces exactly one branch, deep in the tree, and nothing beside it', async () => {
    const w = world()
    const t = await trunk(w)
    const older = await trunk(w, 'ark0')
    const walk = await walkTree(t.root, w.io, { 'games/arkanoid': pick(older.arkanoid, older.root) })

    const arkanoid = walk.nodes.find(n => n.path === 'games/arkanoid')!
    expect(arkanoid).toMatchObject({ layerSig: older.arkanoid, base: t.arkanoid, bees: [older.bees['ark0']] })
    expect(walk.nodes.find(n => n.path === 'games/bubble')!.layerSig).toBe(t.bubble)
    expect(walk.applied).toEqual(['games/arkanoid'])
    expect(enabledBees(walk, new Set())).toContain(older.bees['ark0'])
    expect(enabledBees(walk, new Set())).not.toContain(t.bees['ark1'])
  })

  it('a package the trunk does not have joins under its parent', async () => {
    const w = world()
    const t = await trunk(w)
    const wheel = await w.layer('wheel', [], [await w.blob('// bee wheel')])
    const walk = await walkTree(t.root, w.io, { 'games/wheel': pick(wheel, 'f'.repeat(64)) })
    expect(walk.nodes.find(n => n.path === 'games')!.children).toEqual(['games/arkanoid', 'games/bubble', 'games/wheel'])
    expect(walk.nodes.find(n => n.path === 'games/wheel')).toMatchObject({ layerSig: wheel, base: '' })
  })

  it('a downgrade that hides keeps the picks beneath it without applying them, until it is dropped', async () => {
    const w = world()
    const t = await trunk(w)
    const older = await trunk(w, 'ark0')
    const newerThemes = await w.layer('themes', [], [await w.blob('// bee themes v2')])
    const picks = {
      'games/arkanoid': pick(older.arkanoid, older.root, true),
      'games/arkanoid/themes': pick(newerThemes, 'e'.repeat(64)),
    }

    const hidden = await walkTree(t.root, w.io, picks)
    expect(hidden.eclipsed).toEqual(['games/arkanoid/themes'])
    expect(hidden.applied).toEqual(['games/arkanoid'])
    expect(hidden.nodes.find(n => n.path === 'games/arkanoid/themes')!.layerSig).toBe(older.themes)

    const back = await walkTree(t.root, w.io, { 'games/arkanoid/themes': picks['games/arkanoid/themes'] })
    expect(back.eclipsed).toEqual([])
    expect(back.nodes.find(n => n.path === 'games/arkanoid/themes')!.layerSig).toBe(newerThemes)

    // A downgrade that does NOT hide leaves the configured parts beneath it on.
    const kept = await walkTree(t.root, w.io, { ...picks, 'games/arkanoid': pick(older.arkanoid, older.root, false) })
    expect(kept.applied).toEqual(['games/arkanoid', 'games/arkanoid/themes'])
  })

  it('a tree with a layer that cannot be read is never complete', async () => {
    const w = world()
    const root = await w.layer('root', ['a'.repeat(64)])
    expect((await walkTree(root, w.io)).complete).toBe(false)
    expect((await walkTree('b'.repeat(64), w.io)).complete).toBe(false)
  })

  it('off is by path: a branch off takes everything beneath it, a leaf off leaves its parent on', async () => {
    const w = world()
    const t = await trunk(w)
    const walk = await walkTree(t.root, w.io)
    const leafOff = enabledBees(walk, new Set(['games/arkanoid']))
    expect(leafOff).toContain(t.bees['games'])
    expect(leafOff).toContain(t.bees['bubble'])
    expect(leafOff).not.toContain(t.bees['ark1'])
    expect(leafOff).not.toContain(t.bees['themes'])
    expect(enabledBees(walk, new Set(['games']))).toEqual([t.bees['notes']])
  })

  it('a namespace dependency runs from the deepest pick above it, else the trunk', async () => {
    const aliases: Record<string, string> = {
      t1: 'games', t2: 'games/arkanoid', t3: 'notes',
      p1: 'games', p2: 'games/arkanoid', p3: 'notes',
      d2: 'games/arkanoid',
    }
    const read = async (sig: string) => aliases[sig] ?? null
    expect(ownerOf('games/arkanoid/themes', ['games', 'games/arkanoid'])).toBe('games/arkanoid')
    expect(ownerOf('notes', ['games'])).toBe('')

    const deps = await composeDependencies(
      ['t1', 't2', 't3'],
      [{ path: 'games', dependencies: ['p1', 'p2', 'p3'] }, { path: 'games/arkanoid', dependencies: ['d2'] }],
      ['games', 'games/arkanoid'],
      read,
    )
    expect(deps).toEqual(['d2', 'p1', 't3'])
    expect(namespaceOf(new TextEncoder().encode('// @hypercomb/essentials/presentation/tiles\nx'))).toBe('presentation/tiles')

    // A picked bundle held in the brood WAITS: it is not composed, and the
    // trunk's bundle for its namespace keeps running until it is accepted.
    const held = new Set(['d2'])
    const waiting = await composeDependencies(
      ['t1', 't2', 't3'],
      [{ path: 'games', dependencies: ['p1', 'p2', 'p3'] }, { path: 'games/arkanoid', dependencies: ['d2'] }],
      ['games', 'games/arkanoid'],
      read,
      async sig => !held.has(sig),
    )
    expect(waiting).toEqual(['p1', 't2', 't3'])
    expect(namespaceOf(new TextEncoder().encode('// @other/thing\nx'))).toBe('')
  })

  it('names the namespaces a module imports that the selection does not run', async () => {
    const files: Record<string, string> = {
      a: 'import { X } from "@hypercomb/essentials/games/arkanoid"; import "@hypercomb/core"',
      b: "const y = await import('@hypercomb/essentials/notes')",
    }
    const read = async (sig: string) => new TextEncoder().encode(files[sig] ?? '')
    expect(await missingNamespaces(['a', 'b'], new Set(['notes']), read)).toEqual(['games/arkanoid'])
    expect(await missingNamespaces(['a', 'b'], new Set(['notes', 'games/arkanoid']), read)).toEqual([])
  })

  it('a revision is a signature: the same layer from two domains is one revision, newest first', () => {
    const revisions = orderRevisions([
      { layer: 'b'.repeat(64), source: { root: 'r2', zone: 'jwize.com', at: '2026-09-12T00:00:00.000Z', rank: 0 } },
      { layer: 'b'.repeat(64), source: { root: 'r2', zone: 'plugin.com', at: '2026-09-11T00:00:00.000Z', rank: 3 } },
      { layer: 'a'.repeat(64), source: { root: 'r1', zone: 'jwize.com', at: '2026-09-01T00:00:00.000Z', rank: 1 } },
      { layer: 'c'.repeat(64), source: { root: 'r3', zone: 'jwize.com', at: '2026-09-13T00:00:00.000Z', rank: 0 } },
    ])
    expect(revisions.map(r => r.layer[0])).toEqual(['c', 'b', 'a'])
    expect(revisions[1]).toMatchObject({ at: '2026-09-12T00:00:00.000Z' })
    expect(revisions[1]!.sources.map(s => s.zone)).toEqual(['jwize.com', 'plugin.com'])
  })

  it('a revision a later build returned to is the newest, not the oldest', () => {
    // Found live 2026-09-13: the head's games/solomon had first appeared a
    // day earlier and listed under four revisions it had since replaced.
    const revisions = orderRevisions([
      { layer: 'a'.repeat(64), source: { root: 'head', zone: 'jwize.com', at: '', rank: 0 } },
      { layer: 'b'.repeat(64), source: { root: 'r1', zone: 'jwize.com', at: '', rank: 1 } },
      { layer: 'a'.repeat(64), source: { root: 'r2', zone: 'jwize.com', at: '', rank: 2 } },
      { layer: 'c'.repeat(64), source: { root: 'held', zone: '', at: '', rank: 0 } },
    ])
    expect(revisions.map(r => r.layer[0])).toEqual(['a', 'b', 'c'])
  })

  it('names what a revision would replace beneath its path, and marks the way down to a change', async () => {
    const w = world()
    const t = await trunk(w)
    const older = await trunk(w, 'ark0')
    const [now, then] = await Promise.all([walkTree(t.root, w.io), walkTree(older.root, w.io)])
    expect(changedBeneath('games', now.nodes, then.nodes)).toEqual(['games/arkanoid'])
    expect([...movedPaths(then.nodes, now.nodes)].sort()).toEqual(['games', 'games/arkanoid'])
    expect([...withAncestors(['games/arkanoid/themes'])].sort()).toEqual(['games', 'games/arkanoid', 'games/arkanoid/themes'])
  })

  it('keeps picks by path, drops anything that is not one', () => {
    const storage = memory()
    writePicks({ 'games/arkanoid': pick('a'.repeat(64), 'b'.repeat(64), true), 'bad path!': pick('a'.repeat(64), 'b'.repeat(64)) }, storage)
    expect(Object.keys(JSON.parse(storage.getItem(PICKS_KEY)!))).toEqual(['games/arkanoid'])
    expect(readPicks(storage)).toEqual({ 'games/arkanoid': { layer: 'a'.repeat(64), root: 'b'.repeat(64), hides: true, at: 1 } })
    writePicks({}, storage)
    expect(storage.getItem(PICKS_KEY)).toBeNull()
    // A pick made by hand remembers it: what it brought waits in the brood.
    writePicks({ games: { ...pick('a'.repeat(64), 'b'.repeat(64)), byHand: true } }, storage)
    expect(readPicks(storage).games?.byHand).toBe(true)
  })
})

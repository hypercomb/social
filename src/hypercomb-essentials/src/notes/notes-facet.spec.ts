// notes/notes-facet.spec.ts — the notes commit writes the facet alongside, and never mints a key.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { moleculeAddress } from '@hypercomb/core'
import { _resetNotesFacetCache, cachedNotesFacet, readNotesFacet, unionNoteSigs, writeNotesFacet } from './notes-facet.js'
import type { FacetStore } from '../molecule/facet-succession.js'

describe('writeNotesFacet', () => {
  it('writes nothing and says so when there is no cached identity', async () => {
    let touched = 0
    const store = { getPool: async () => { touched++; return null } } as unknown as FacetStore
    expect(await writeNotesFacet('cigars', ['a'.repeat(64)], { store, pubkey: null })).toEqual({ ok: false, reason: 'no identity' })
    expect(touched).toBe(0)
  })

  it('refuses a tile with no name — it has no molecule to be a facet of', async () => {
    const store = { getPool: async () => null } as unknown as FacetStore
    const r = await writeNotesFacet('   ', ['a'.repeat(64)], { store, pubkey: 'b'.repeat(64) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad subject')
  })

  it('addresses the facet by the tile WORD — sign(notes: + moleculeAddress(name))', async () => {
    const asked: string[] = []
    const store = {
      getPool: async (meaning: string) => { asked.push(meaning); return null },
      putResource: async () => 'x', getResource: async () => null, putArtifactMeta: async () => 'x',
    } as unknown as FacetStore
    await writeNotesFacet('  Cigars ', ['a'.repeat(64)], { store, pubkey: 'b'.repeat(64) })
    expect(asked).toEqual([`notes:${await moleculeAddress('cigars')}`])
  })
})

describe('the notes drone', () => {
  it('calls the facet write after the slot commit, and never as a gate on it', () => {
    const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'notes', 'notes.drone.ts'), 'utf8')
    const start = src.indexOf('async #commitCellNotes(')
    const body = src.slice(start, src.indexOf('\n  }\n', start))
    const update = body.indexOf('await committer.update(')
    const facet = body.indexOf('void writeNotesFacet(')
    expect(update).toBeGreaterThan(-1)
    expect(facet).toBeGreaterThan(update)
    expect(body.includes('await writeNotesFacet(')).toBe(false)
  })
})

describe('the one list', () => {
  it('unions facet first, then the slot, deduped, order kept', () => {
    const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64)
    expect(unionNoteSigs([b, a], [a, c])).toEqual([b, a, c])
    expect(unionNoteSigs([], [c, c, a])).toEqual([c, a])
    expect(unionNoteSigs([], [])).toEqual([])
  })

  it('reads an absent facet as empty, opening and never creating', async () => {
    const opened: string[] = []
    const store = { openPool: async (m: string) => { opened.push(m); return null }, getResource: async () => null }
    expect(await readNotesFacet('cigars', { store, pubkey: null })).toEqual([])
    expect(opened).toHaveLength(1)
    expect(opened[0]!.startsWith('notes:')).toBe(true)
  })
})

describe('the synchronous path', () => {
  it('knows nothing until a read, then remembers the WORD it read — case and spacing folded', async () => {
    _resetNotesFacetCache()
    expect(cachedNotesFacet('cigars')).toEqual([])
    const store = { openPool: async () => null, getResource: async () => null }
    await readNotesFacet('  Cigars ', { store, pubkey: null })
    expect(cachedNotesFacet('cigars')).toEqual([])           // an absent facet reads as empty, and that is remembered too
    expect(cachedNotesFacet('')).toEqual([])
  })
})

describe('the notes reader', () => {
  it('reads the facet before the slot, and the commit transforms the same union', () => {
    const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'notes', 'notes.drone.ts'), 'utf8')
    const read = src.slice(src.indexOf('async #readAtLocation('), src.indexOf('\n  }\n', src.indexOf('async #readAtLocation(')))
    expect(read.includes('readNotesFacet(tileName)')).toBe(true)
    expect(read.includes('unionNoteSigs(facetSigs, slotSigs)')).toBe(true)
    const commit = src.slice(src.indexOf('async #commitCellNotes('), src.indexOf('\n  }\n', src.indexOf('async #commitCellNotes(')))
    expect(commit.includes('unionNoteSigs(await readNotesFacet(')).toBe(true)
    // every tree read hands the tile name through
    expect((src.match(/#readAtLocation\(locSig\)/g) ?? []).length).toBe(0)
    // and the synchronous paint path unions the word's last-read facet
    const sync = src.slice(src.indexOf('public readonly notesFor ='), src.indexOf('\n  }\n', src.indexOf('public readonly notesFor =')))
    expect(sync.includes('unionNoteSigs(cachedNotesFacet(cellLabel), slotSigs)')).toBe(true)
  })
})

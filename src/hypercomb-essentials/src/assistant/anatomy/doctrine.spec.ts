// doctrine.spec.ts — THE DOCTRINE IS A HIERARCHY OF TILES. The hive's
// `doctrine` tile holds a tile per tier and a tile per rule, each note a codex
// line; read back in order they are the codex, and the anatomy is composed
// from them. The hive is the only source: no tiles, no doctrine, never the
// build's copy; a tree whose order breaks carries none.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANATOMY_CODEX, ANATOMY_MECHANICS, ANATOMY_SECTIONS, ANATOMY_TEXT } from './anatomy.generated.js'
import { codexSections, parseCodex } from './codex.js'
import { composeAnatomy, headingOf, sourceOf } from './doctrine.js'
import { fromCodex, readDoctrineTree, walkDoctrine, type DoctrineTreeIo } from './doctrine-tree.js'
import { queueDoctrineRecord, readDoctrineRecord, takeQueuedDoctrineRecords, writeDoctrineRecord, type DoctrineRecordStore } from './doctrine-record.js'
import { SignatureService } from '@hypercomb/core'
import { doctrineTilePlan } from '../doctrine-tiles.js'
import { doctrineMarkdown } from './doctrine-page.js'

/** A hive holding exactly these tiles and notes. Each tile's head layer
 *  signature is its route plus its notes, so editing a note moves its head
 *  (and nothing above it: history is per page). */
const hive = (tiles: { readonly path: readonly string[]; readonly note?: string }[]): DoctrineTreeIo & { notesAt: Map<string, string[]>; missing: Set<string> } => {
  const notesAt = new Map<string, string[]>()
  const kids = new Map<string, string[]>()
  const missing = new Set<string>()
  for (const tile of tiles) {
    const key = tile.path.join('/')
    const parent = tile.path.slice(0, -1).join('/')
    kids.set(parent, [...(kids.get(parent) ?? []), tile.path[tile.path.length - 1]!])
    kids.set(key, kids.get(key) ?? [])
    if (tile.note !== undefined) notesAt.set(key, [tile.note])
  }
  const sigOf = (key: string): string => `${key}#${(notesAt.get(key) ?? []).join('|')}`
  return {
    notesAt,
    missing,
    head: async path => {
      const key = path.join('/')
      return kids.has(key) && !missing.has(key) ? { layerSig: sigOf(key), children: kids.get(key)!, complete: true } : null
    },
    notes: async layerSig => {
      const key = layerSig.slice(0, layerSig.indexOf('#'))
      return sigOf(key) === layerSig ? { notes: notesAt.get(key) ?? [], complete: true } : null
    },
  }
}
const ROOT = ['doctrine']

const file = resolve(__dirname, '../../../../documentation/doctrine.codex')
const tiers = parseCodex(existsSync(file) ? readFileSync(file, 'utf8') : ANATOMY_CODEX)

describe('the build\'s copy', () => {
  it('composes to the build\'s own anatomy, byte for byte', () => {
    expect(composeAnatomy(ANATOMY_MECHANICS, ANATOMY_SECTIONS)).toBe(ANATOMY_TEXT)
    expect(ANATOMY_SECTIONS.every(section => headingOf(section) && sourceOf(section))).toBe(true)
  })
})

describe('the doctrine tiles', () => {
  it('read back as the codex the tiles were laid from, so the anatomy is the build\'s own when the tiles are', async () => {
    const read = await readDoctrineTree(hive(doctrineTilePlan(tiers)), ROOT)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.tiers.map(tier => tier.line)).toEqual(tiers.map(tier => tier.line))
    expect(read.tiers.flatMap(tier => tier.axioms.map(axiom => axiom.line))).toEqual(tiers.flatMap(tier => tier.axioms.map(axiom => axiom.line)))
    expect(codexSections(read.tiers)).toEqual(codexSections(tiers))
  })

  it('takes order from the lines, never from where a tile sits', async () => {
    const plan = doctrineTilePlan(tiers)
    const read = await readDoctrineTree(hive([plan[0]!, ...plan.slice(1).reverse()]), ROOT)
    expect(read.ok && read.tiers.map(tier => tier.index)).toEqual(tiers.map(tier => tier.index))
    expect(read.ok && read.tiers[3]!.axioms.map(axiom => axiom.id)).toEqual(tiers[3]!.axioms.map(axiom => axiom.id))
  })

  it('follows an edited note: a rule changes by editing its tile', async () => {
    const world = hive(doctrineTilePlan(parseCodex('@0 Base\nA1: First.\nA2<A1: Second.')))
    const key = [...world.notesAt.keys()].find(path => world.notesAt.get(path)![0]!.startsWith('A2'))!
    world.notesAt.set(key, ['A2<A1: Second, edited in the hive.'])
    const read = await readDoctrineTree(world, ROOT)
    expect(read.ok && read.codex).toBe('@0 Base\nA1: First.\nA2<A1: Second, edited in the hive.\n')
  })

  it('leaves out a tile whose note is no codex line (a tile added to read, a rule being written)', async () => {
    const read = await readDoctrineTree(hive([
      ...doctrineTilePlan(parseCodex('@0 Base\nA1: First.')),
      { path: ['doctrine', 'doctrine-base', 'a-thought'], note: 'maybe a rule about tiles' },
      { path: ['doctrine', 'reading-list'] },
    ]), ROOT)
    expect(read.ok && read.codex).toBe('@0 Base\nA1: First.\n')
  })

  it('is named by its heads: editing one rule\'s note changes the name, and nothing else does', async () => {
    const world = hive(doctrineTilePlan(parseCodex('@0 Base\nA1: First.\nA2<A1: Second.')))
    const before = await walkDoctrine(world, ROOT)
    expect(await walkDoctrine(world, ROOT)).toEqual(before)
    const key = [...world.notesAt.keys()].find(path => world.notesAt.get(path)![0]!.startsWith('A2'))!
    world.notesAt.set(key, ['A2<A1: Second, edited.'])
    const after = await walkDoctrine(world, ROOT)
    expect(before.ok && after.ok && before.vector !== after.vector).toBe(true)
  })

  it('carries NO doctrine when the hive has no doctrine tile, never the build\'s copy', async () => {
    expect(await readDoctrineTree(hive([]), ROOT)).toEqual({ ok: false, reason: 'absent' })
    expect(await readDoctrineTree(hive([{ path: ['doctrine'] }]), ROOT)).toEqual({ ok: false, reason: 'absent' })
  })

  it('carries none, and says why, when a rule cites one that does not come before it', async () => {
    const read = await readDoctrineTree(hive(doctrineTilePlan(parseCodex('@0 Base\nA1: First.\n@1 Leaf\nB1<A1: Fine.'))
      .map(tile => tile.note === 'B1<A1: Fine.' ? { ...tile, note: 'B1<Z9: Rests on nothing here.' } : tile)), ROOT)
    expect(read).toEqual({ ok: false, reason: 'broken', problems: ['B1 cites Z9, which does not come before it'] })
  })

  it('carries none when a tile it names is not on this device: never a partial doctrine', async () => {
    const world = hive(doctrineTilePlan(parseCodex('@0 Base\nA1: First.\nA2<A1: Second.')))
    world.missing.add([...world.notesAt.keys()].find(path => world.notesAt.get(path)![0]!.startsWith('A2'))!)
    expect(await readDoctrineTree(world, ROOT)).toMatchObject({ ok: false, reason: 'broken' })
  })
})

describe('the doctrine record', () => {
  const memoryStore = (): DoctrineRecordStore & { docs: Map<string, ArrayBuffer>; heap: Map<string, string> } => {
    const docs = new Map<string, ArrayBuffer>()
    const heap = new Map<string, string>()
    const pool = { name: 'pool' } as FileSystemDirectoryHandle
    return {
      docs, heap,
      // jsdom's Blob has no text(): read it the way jsdom can.
      putResource: async blob => { const text = await new Promise<string>(done => { const reader = new FileReader(); reader.onload = () => done(String(reader.result)); reader.readAsText(blob) }); const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer); heap.set(sig, text); return sig },
      getResource: async sig => heap.has(sig) ? ({ text: async () => heap.get(sig)! }) as unknown as Blob : null,
      getPool: async () => pool,
      openPool: async () => pool,
      getPoolDoc: async (_pool, key) => docs.get(key ?? '') ?? null,
      putPoolDoc: async (_pool, bytes, key) => { docs.set(key ?? '', bytes); return 'ok' },
    }
  }
  const SOURCE = 'a'.repeat(64)

  it('is absent until minted, then names the codex by signature and reads back as the same doctrine', async () => {
    const store = memoryStore()
    expect(await readDoctrineRecord(store, SOURCE)).toBeNull()
    const read = await readDoctrineTree(hive(doctrineTilePlan(tiers)), ROOT)
    if (!read.ok) throw new Error('the codex tiles did not read')
    expect(await writeDoctrineRecord(store, SOURCE, read.codex)).toBe(true)
    const record = await readDoctrineRecord(store, SOURCE)
    expect(record?.codex).toBe(read.codex)
    expect(record?.codexSig).toBe(await SignatureService.sign(new TextEncoder().encode(read.codex).buffer as ArrayBuffer))
    expect(fromCodex(record!.codex)).toEqual(read)
  })

  it('answers only for its own signature, and a record naming another source is none', async () => {
    const store = memoryStore()
    await writeDoctrineRecord(store, SOURCE, '@0 Base\nA1: First.\n')
    expect(await readDoctrineRecord(store, 'b'.repeat(64))).toBeNull()
    store.docs.set('b'.repeat(64), store.docs.get(SOURCE)!)
    expect(await readDoctrineRecord(store, 'b'.repeat(64))).toBeNull()
  })

  it('is queued by a read and taken once by the optimize pass', () => {
    queueDoctrineRecord(SOURCE, 'x')
    queueDoctrineRecord(SOURCE, 'x')
    queueDoctrineRecord('not a sig', 'x')
    expect(takeQueuedDoctrineRecords()).toEqual([[SOURCE, 'x']])
    expect(takeQueuedDoctrineRecords()).toEqual([])
  })
})

describe('the doctrine page', () => {
  it('writes every tier and every rule, with what each rests on, as the docs browser reads markdown', () => {
    const page = doctrineMarkdown({ kind: 'read', tiers: tiers.length, rules: tiers.reduce((n, tier) => n + tier.axioms.length, 0) }, tiers)
    expect(page.startsWith('# Doctrine\n')).toBe(true)
    for (const tier of tiers) expect(page).toContain(`## ${tier.index} · ${tier.title}`)
    for (const axiom of tiers.flatMap(tier => tier.axioms)) expect(page).toContain(`- **${axiom.id}**`)
    const cited = tiers.flatMap(tier => tier.axioms).find(axiom => axiom.needs.length)!
    expect(page).toContain(`**${cited.id}** <span class="rests">rests on ${cited.needs.join(', ')}</span>`)
  })

  it('escapes a rule\'s own markup, since the browser does not', () => {
    const page = doctrineMarkdown({ kind: 'read', tiers: 1, rules: 1 }, parseCodex('@0 Base\nA1: Never put <script> in a note.'))
    expect(page).toContain('Never put &lt;script&gt; in a note.')
  })

  it('says why there is no doctrine, as the word does', () => {
    expect(doctrineMarkdown({ kind: 'absent' }, [])).toContain('This hive carries no doctrine')
    expect(doctrineMarkdown({ kind: 'broken', problems: ['B1 cites Z9, which does not come before it'] }, [])).toContain('- B1 cites Z9, which does not come before it')
  })
})

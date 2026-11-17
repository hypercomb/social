// assistant/anatomy/anatomy.service.ts
//
// THE ANATOMY AT RUNTIME. The shell asks for it over IoC (the shell may never
// import a module). Its signature is derived here — never written down
// anywhere — and is what a conversation turn records as "the anatomy I was
// sent".
//
// The anatomy is COMPOSED: the build's mechanics, then the doctrine this hive
// holds. The doctrine is a HIERARCHY OF TILES (jwize, 2026-11-16): the
// `doctrine` tile at the hive's root, a tile per tier, a tile per rule, each
// note a codex line (doctrine-tree.ts). The hive is the ONLY source: a hive
// with no doctrine tiles carries NO doctrine, never the build's copy, and gets
// one by adopting a host's `doctrine` branch or by the participant laying the
// build's copy (`doctrine tiles`). A rule changes by editing its tile.
//
// FAST BY HEADS (§2d): history is per page, so no one signature names the
// doctrine; its tiles' heads do. One walk of the routes gives every tile's
// head layer signature, and the signature of that head vector names the
// doctrine. When the optimize phase has recorded the codex for it
// (doctrine-record.ts) the read is that record; otherwise the notes are read
// from the head layers, and the next optimize pass records what was found.
//
// The tiles are read again after the hive changes, lazily: a reader that
// judges by the doctrine waits for `doctrine.ready`, which re-reads when a
// commit, a note or a repaint happened since the last read; `signature()` and
// `written` wait for it themselves.
//
// Design: documentation/anatomy-context-need.md §2, §2a, §6, §7.

import { EffectBus, SignatureService, isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import { ANATOMY_MECHANICS, ANATOMY_SOURCES } from './anatomy.generated.js'
import { codexSections, type CodexTier } from './codex.js'
import { doctrineMarkdown } from './doctrine-page.js'
import { composeAnatomy, headingOf, sourceOf } from './doctrine.js'
import { DOCTRINE_ROOT, fromCodex, readDoctrineNotes, walkDoctrine, type DoctrineTreeIo, type DoctrineTreeRead } from './doctrine-tree.js'
import { queueDoctrineRecord, readDoctrineRecord, type DoctrineRecordStore } from './doctrine-record.js'

export const ANATOMY_IOC_KEY = '@hypercomb.social/Anatomy'

export type DoctrineSectionInfo = { readonly index: number; readonly heading: string; readonly source: string }

/** What the last read of the doctrine tiles found. */
export type DoctrineStatus =
  | { readonly kind: 'unread' }
  | { readonly kind: 'read'; readonly tiers: number; readonly rules: number; readonly source: string; readonly recorded: boolean }
  | { readonly kind: 'absent' }
  | { readonly kind: 'broken'; readonly problems: readonly string[] }

export type DoctrineLike = {
  /** Resolves once the doctrine tiles as they stand now have been read. */
  readonly ready: Promise<void>
  /** The sections the anatomy carries now, 1-based. */
  sections(): readonly DoctrineSectionInfo[]
  /** What the last read found: the doctrine, none, or a tree whose order breaks. */
  status(): DoctrineStatus
  /** Where the doctrine lives in the hive. */
  readonly root: readonly string[]
  /** The doctrine as a page (markdown, the docs browser's), read now: what
   *  every model is sent, or why there is none. */
  markdown(): Promise<string>
}

export type AnatomyLike = {
  /** The anatomy now: the system prompt every provider receives first. */
  readonly text: string
  /** sign(text) for the anatomy now. */
  readonly signature: () => Promise<string>
  /** Resolves to that sig once the bytes are a root resource on disk — a
   *  turn record waits on this so it never names a sig that cannot be read. */
  readonly written: Promise<string>
  /** The marker name in the `system:anatomy` bag that names the settled
   *  anatomy, or undefined when the store could not be asked. */
  readonly marker: Promise<string | undefined>
  /** Which documents and sections the build's copy of the doctrine was lifted from. */
  readonly sources: readonly { readonly doc: string; readonly heading: string }[]
  readonly doctrine: DoctrineLike
}

type StoreLike = DoctrineRecordStore
type NodeReadLike = {
  readonly ok: boolean
  readonly layerSig?: string
  readonly children?: readonly { readonly name: string; readonly sig: string }[]
  readonly unresolved?: readonly string[]
  readonly content?: Record<string, unknown>
  readonly truncated?: boolean
}
type TreeReaderLike = {
  readNode?(segments: readonly string[], options?: { readonly withContent?: boolean }): Promise<NodeReadLike>
  readNodeBySig?(sig: string, options?: { readonly withContent?: boolean; readonly maxBytes?: number }): Promise<NodeReadLike>
}
const STORE_KEY = '@hypercomb.social/Store'
const TREE_KEY = '@diamondcoreprocessor.com/HypercombHiveTreeReader'
const POLL_MS = 250
const POLL_LIMIT = 240 // a minute; past that the hive is not coming this boot

// ── the hive, once it is really there ──────────────────────────────────────
//
// POLLED, NOT `whenReady`. This module registers early, and `window.ioc` is
// REPLACED after the first barrel modules load (llm-provider-registry.ts) — a
// `whenReady` parked on the early map never fires. And a store whose method
// EXISTS is not yet READY: the instance is registered before its OPFS root is
// open, and a write in that window rejects. So a rejection means "not yet";
// only the limit ends the poll, and then the anatomy carries no doctrine. The
// probe write is the mechanics alone: the build's doctrine is never written
// as if it were the hive's.
const bare = composeAnatomy(ANATOMY_MECHANICS, [])
const store: Promise<StoreLike | undefined> = new Promise(resolve => {
  let polls = 0
  const later = (): void => { if (++polls < POLL_LIMIT) setTimeout(tick, POLL_MS); else resolve(undefined) }
  const tick = (): void => {
    const ioc = window.ioc
    const found = ioc?.get?.(STORE_KEY) as StoreLike | undefined
    // The doctrine is read through the tree reader: wait for it too, or the
    // first read would find no doctrine that is there.
    if (!found?.putResource || !ioc?.get?.(TREE_KEY)) return later()
    let attempt: Promise<string>
    try { attempt = found.putResource(new Blob([bare], { type: 'text/markdown' }), { emit: false }) } catch { return later() }
    attempt.then(() => resolve(found), later)
  }
  tick()
})

const SIG = /^[a-f0-9]{64}$/
const reader = (): TreeReaderLike | undefined => window.ioc?.get?.(TREE_KEY) as TreeReaderLike | undefined

/** A note's text from a `notes` slot entry: the entry is the note, or a meta
 *  envelope naming it (life-primitive healLegacyLayer). Null when not held. */
const noteText = async (found: StoreLike, entry: string): Promise<string | null> => {
  let sig = entry.toLowerCase()
  for (let hop = 0; hop < 4 && SIG.test(sig); hop++) {
    const blob = await found.getResource?.(sig).catch(() => null)
    if (!blob) return null
    let parsed: unknown
    try { parsed = JSON.parse(await blob.text()) } catch { return null }
    if (isMetaEnvelope(parsed)) {
      const payload = metaPayloadOf(parsed)
      if (payload?.kind !== 'resource') return null
      sig = payload.sig
      continue
    }
    const note = (parsed as { note?: unknown } | null)?.note
    return typeof note === 'string' ? note : null
  }
  return null
}

/** The doctrine tiles read by route: each tile's name from its parent, its
 *  truth from its own current head (history is per page, so a parent's child
 *  signature is only a hint), and its notes from that head layer's own
 *  `notes` slot — what travels with the layer, nothing a replica merely
 *  remembers. */
const treeIo = (found: StoreLike): DoctrineTreeIo | null => {
  const tree = reader()
  if (!tree?.readNode || !tree.readNodeBySig) return null
  return {
    head: async path => {
      const read = await tree.readNode!(path, { withContent: false }).catch(() => null)
      if (!read?.ok || !read.layerSig || !SIG.test(read.layerSig)) return null
      return { layerSig: read.layerSig, children: (read.children ?? []).map(child => child.name), complete: !read.unresolved?.length }
    },
    notes: async layerSig => {
      const read = await tree.readNodeBySig!(layerSig, { withContent: true, maxBytes: 64_000 }).catch(() => null)
      if (!read?.ok) return null
      const entries = Array.isArray(read.content?.['notes']) ? (read.content!['notes'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
      const notes: string[] = []
      let complete = !read.truncated
      for (const entry of entries) {
        const text = await noteText(found, entry)
        if (text === null) complete = false
        else notes.push(text)
      }
      return { notes, complete }
    },
  }
}

// ── the anatomy's own lineage bag ──────────────────────────────────────────
//
// `sign('system:anatomy')`, markers 00000000, 00000001, … each a
// `{ layerSig, at }` record naming one anatomy version, the highest being the
// live one (anatomy-context-need §2, §6). Advanced only when the head names a
// different sig, and only for an anatomy composed from a read of the hive.
const MARKER = /^\d{8}$/
const recordAnatomy = async (found: StoreLike, sig: string): Promise<string | undefined> => {
  try {
    const bag = await found.getPool?.('system:anatomy')
    if (!bag) return undefined
    let max = -1
    for await (const [name, handle] of (bag as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (handle.kind === 'file' && MARKER.test(name)) max = Math.max(max, Number(name))
    }
    if (max >= 0) {
      const head = await (await bag.getFileHandle(String(max).padStart(8, '0'))).getFile()
      try {
        const record = JSON.parse(await head.text()) as { layerSig?: string }
        if (record.layerSig === sig) return String(max).padStart(8, '0')
      } catch { /* an unreadable head is not this sig; advance past it */ }
    }
    const next = String(max + 1).padStart(8, '0')
    const writable = await (await bag.getFileHandle(next, { create: true })).createWritable()
    try { await writable.write(new Blob([JSON.stringify({ layerSig: sig, at: Date.now() })])) } finally { await writable.close() }
    return next
  } catch {
    return undefined
  }
}

// ── the state ──────────────────────────────────────────────────────────────

let sections: readonly string[] = []
let tiersRead: readonly CodexTier[] = []
let status: DoctrineStatus = { kind: 'unread' }
let text = bare
const signatures = new Map<string, Promise<string>>()
const signOf = (value: string): Promise<string> => {
  let pending = signatures.get(value)
  if (!pending) { pending = SignatureService.sign(new TextEncoder().encode(value).buffer as ArrayBuffer); signatures.set(value, pending) }
  return pending
}
const writes = new Map<string, Promise<string>>()
const writeText = (value: string): Promise<string> => {
  let pending = writes.get(value)
  if (!pending) {
    pending = store.then(found => found?.putResource
      ? found.putResource(new Blob([value], { type: 'text/markdown' }), { emit: false })
      : Promise.reject(new Error('no store')))
    writes.set(value, pending)
  }
  return pending
}
let marker: Promise<string | undefined> = Promise.resolve(undefined)
let anatomyRecorded = false

/** A read of the tiles settled: compose the anatomy, write it, record it. */
const settle = (read: DoctrineTreeRead | null, source = '', fromRecord = false): void => {
  tiersRead = read?.ok ? read.tiers : []
  sections = read?.ok ? codexSections(read.tiers) : []
  status = !read ? { kind: 'absent' }
    : read.ok ? { kind: 'read', tiers: read.tiers.length, rules: read.tiers.reduce((sum, tier) => sum + tier.axioms.length, 0), source, recorded: fromRecord }
      : read.reason === 'broken' ? { kind: 'broken', problems: read.problems } : { kind: 'absent' }
  const next = composeAnatomy(ANATOMY_MECHANICS, sections)
  if (anatomyRecorded && next === text) return
  anatomyRecorded = true
  text = next
  marker = Promise.all([store, writeText(next)])
    .then(([found, sig]) => found ? recordAnatomy(found, sig) : undefined)
    .catch(() => undefined)
}

const readTiles = async (): Promise<void> => {
  const found = await store
  const io = found ? treeIo(found) : null
  if (!found || !io) { settle(null); return }
  try {
    // No one signature names the doctrine (history is per page): its heads
    // do. Walk the routes to their heads, name the doctrine by that vector,
    // and read the notes only when no record holds the codex for it.
    const walk = await walkDoctrine(io)
    if (!walk.ok) { settle(walk, '', false); return }
    const source = await SignatureService.sign(new TextEncoder().encode(walk.vector).buffer as ArrayBuffer)
    const record = await readDoctrineRecord(found, source)
    if (record) { settle(fromCodex(record.codex), source, true); return }
    const read = await readDoctrineNotes(io, walk)
    // Complete and in order: the next optimize pass records it (never here).
    if (read.ok) queueDoctrineRecord(source, read.codex)
    settle(read, source, false)
  } catch { settle(null) }
}

// The tiles are read again only after the hive changed since the last read: a
// commit (a tile made, removed or moved), a note written, a repaint (which a
// hide makes).
let stale = true
let reading: Promise<void> = Promise.resolve()
const changed = (): void => { stale = true }
if (typeof window !== 'undefined') window.addEventListener('synchronize', changed)
EffectBus.on('notes:changed', changed)
EffectBus.on('history:head-changed', changed)
EffectBus.on('history:head-external', changed)
const current = (): Promise<void> => {
  if (stale) {
    stale = false
    reading = reading.then(readTiles, readTiles)
  }
  return reading
}

const doctrine: DoctrineLike = {
  get ready() { return current() },
  sections: () => sections.map((section, i) => ({ index: i + 1, heading: headingOf(section), source: sourceOf(section) })),
  status: () => status,
  root: DOCTRINE_ROOT,
  markdown: () => current().then(() => doctrineMarkdown(status, tiersRead)),
}

export const anatomy: AnatomyLike = {
  get text() { return text },
  signature: () => current().then(() => signOf(text)),
  get written() { return current().then(() => { const now = text; return writeText(now).then(() => signOf(now)) }) },
  get marker() { return current().then(() => marker) },
  sources: ANATOMY_SOURCES,
  doctrine,
}

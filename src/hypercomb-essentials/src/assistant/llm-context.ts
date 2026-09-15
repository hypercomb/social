// assistant/llm-context.ts
//
// LLM CONTEXT — a token-compact projection of a tile, derived.
//
// The `hive` tool's `/read` answers with a layer's raw slots: mostly arrays
// of 64-hex signatures. A model that wants to know what a tile SAYS has to
// spend several more `read <sig>` rounds resolving them, and every round
// resends the whole transcript as input tokens (documentation/
// anatomy-context-need.md §3, §7). This is the derived-cache half of the
// fix: one small, deterministic text rendering of a tile, keyed by the
// layer signature it derives from, that `inflate()` can substitute for the
// raw bytes under a lens (history/inflate.ts).
//
// THE RECORD: for one layer signature, the compact text a model reads in
// place of that layer's raw content.
//
//   project(S) = name(S)
//              ⧺ notes(S), flattened, tags kept, shapes/marks dropped
//              ⧺ properties(S), human-meaningful scalars only
//              ⧺ every other non-child slot, as a bare count
//
// Pure composition, never a subtree walk: only S's OWN slots and the
// resources they name directly are read. A child tile's projection is a
// separate record keyed by the CHILD's own layer sig — the reader supplies
// children with sigs from truth (CHILD_SLOTS are never emitted here).
//
// ═══════════════════════════════════════════════════════════════════════
// NO SIGNATURES IN THE RECORD BYTES. READ THIS BEFORE ADDING ONE 'FOR
// CONVENIENCE'.
// ═══════════════════════════════════════════════════════════════════════
// `HistoryService.referencesOutside` credits every 64-hex run found in a
// POOL MEMBER'S BYTES and pins it against prune. A record naming the layer
// sig, a child sig, or a resource sig would therefore pin that content
// forever, and a derived cache that changes what the collector keeps is not
// wipe-safe (molecule-index.ts's header makes the same argument). The layer
// sig is the FILENAME only; every 64-hex run is stripped from the TEXT at
// the writer (`projectLayer`), the same discipline `safeSpelling` uses.
//
// Derived-cache contract (documentation/optimize-phase.md), honoured:
//   1. keyed by the SOURCE LAYER SIGNATURE — changed tile = new sig = no
//      record yet. There is no update path, only derive-on-miss.
//   2. lives in `sign('llm:context')` — recomputable, wipe-safe, GC-able.
//   3. never load-bearing: `project()` applies the identical rule whether
//      the pool holds a record or not — warm returns the stored text, cold
//      derives it in memory. One rule, two paths, proved equal in
//      llm-context.spec.ts.
//   4. mints no truth: no layers, no markers, no lineage writes, no gating.
//      Complete-or-absent — `projectLayer` returns null (never a partial
//      string) the moment a referenced resource is not local, or the
//      result would not fit the cap.
//
// THE MINTER IS NOT THE REGISTERED SERVICE. `llm-context.drone.ts`
// constructs its own `LlmContextService`; IoC carries the READ half only
// (`readRecord`, `project`) — a minter reachable through `ioc.get` would put
// a resource walk plus a pool write on any render or keystroke path that
// happened to ask.

import { CHILD_SLOTS, isSignature } from '@hypercomb/core'
import type { InflateLens } from '../history/inflate.js'

/** The pool. Colon-scoped: the bare-word list is frozen, and no tile may
 *  name this meaning (see pool-registry.ts). */
export const LLM_CONTEXT_MEANING = 'llm:context'

/**
 * THE DERIVATION VERSION. Bump it when the PROJECTION RULE changes — a
 * different slot handling, a different note format, a different cap — and
 * every prior record becomes a miss on read and is re-minted by the phase.
 * Reject-on-mismatch IS the invalidation: no migration, no sweep.
 */
export const LLM_CONTEXT_DERIVATION = 1

/** A record holds at most this many characters of projected text. Complete-
 *  or-absent: a projection that would exceed this is null, never truncated
 *  prose a model might mistake for the whole tile. */
export const MAX_PROJECTION_CHARS = 6_000

/** The record. `text` and NOTHING ELSE — no layer sig, no child sigs, no
 *  resource sigs (see the file header). */
export interface LlmContextRecord {
  readonly v: number
  readonly text: string
}

/** Any 64-hex RUN, anywhere in a string — not the anchored form. Stripped
 *  from the assembled text at the writer, exactly like molecule-index's
 *  `safeSpelling`: a note that happens to quote a signature must not pin it. */
const SIGNATURE_RUN = /[0-9a-f]{64}/gi

const asSig = (value: unknown): value is string => isSignature(value)

/** Is this a record this build can read? Reject-on-mismatch is the whole of
 *  invalidation; a malformed file is DROPPED, never thrown on, so a corrupt
 *  or foreign-version record degrades to "derive it again," never a crash. */
export const readableRecord = (parsed: unknown): LlmContextRecord | null => {
  const record = parsed as LlmContextRecord | null
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  if (record.v !== LLM_CONTEXT_DERIVATION) return null
  if (typeof record.text !== 'string' || record.text.length > MAX_PROJECTION_CHARS) return null
  return { v: LLM_CONTEXT_DERIVATION, text: record.text }
}

// ── the projection rule ────────────────────────────────────────────────

type LayerLike = { name?: unknown; [slot: string]: unknown }

/** Reads one resource's bytes, LOCALLY ONLY — never a host fetch. Bound by
 *  the caller to `Store.getResourceLocal`; kept as a plain function here so
 *  `projectLayer` stays a pure function of its two arguments and is testable
 *  with no Store, no OPFS, no IoC. */
type ReadLocalResource = (sig: string) => Promise<Uint8Array | null>

/** Property-bag keys that are never human-meaningful text: layout/position,
 *  picture plumbing, and ownership marks. Everything else that survives
 *  typing (string / boolean / number / string[]) is kept. */
const DROPPED_PROPERTY_KEYS = new Set([
  'index', 'point', 'propertyPins',
  'imageSig', 'image', 'small', 'flat', 'large',
  'substrate', 'participant',
])

/** The properties bag, filtered to what a model needs to know a tile SAYS.
 *  Sorted by key so the same bag always projects to the same lines. */
const projectPropertiesLines = (props: Record<string, unknown>): string[] => {
  const lines: string[] = []
  for (const key of Object.keys(props).sort()) {
    if (DROPPED_PROPERTY_KEYS.has(key)) continue
    const value = props[key]
    if (asSig(value)) continue
    if (typeof value === 'string') {
      if (value) lines.push(`  ${key}: ${value}`)
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`  ${key}: ${value}`)
    } else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === 'string' && !asSig(v))
      if (items.length) lines.push(`  ${key}: ${items.join(', ')}`)
    }
    // Objects (nested picture blobs already excluded by name) and anything
    // else are not text-like — dropped rather than guessed at.
  }
  return lines
}

/**
 * The note tree, flattened, two-space indent per depth. Note shape
 * (notes/note-tree.ts): `{ note, shape, mark, children, tags? }` — only
 * `note` (the text) and `tags` (pheromones, meaningful interest signals)
 * travel; `shape` and `mark` are rendering hints, dropped.
 *
 * COMPLETE-OR-ABSENT: returns false the moment a referenced note is not
 * local or is not shaped like a note — the caller turns that into an
 * overall null projection rather than a tree missing a branch. `visited` is
 * the cycle guard: a child sig already rendered is not descended into
 * again (also collapses a note shared under two parents to one rendering).
 */
const renderNotes = async (
  sigs: readonly string[],
  depth: number,
  readResource: ReadLocalResource,
  visited: Set<string>,
  out: string[],
): Promise<boolean> => {
  for (const sig of sigs) {
    if (!asSig(sig) || visited.has(sig)) continue
    visited.add(sig)
    const bytes = await readResource(sig)
    if (!bytes) return false
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { return false }
    if (!parsed || typeof parsed !== 'object') return false
    const note = parsed as { note?: unknown; tags?: unknown; children?: unknown }
    if (typeof note.note !== 'string') return false
    const tags = Array.isArray(note.tags)
      ? note.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : []
    const suffix = tags.length ? ` ${tags.map(t => `#${t}`).join(' ')}` : ''
    out.push(`${'  '.repeat(depth)}${note.note}${suffix}`)
    const children = Array.isArray(note.children) ? note.children.filter(asSig) : []
    if (children.length && !(await renderNotes(children, depth + 1, readResource, visited, out))) {
      return false
    }
  }
  return true
}

/**
 * THE RULE. A pure, deterministic function of `layer`'s own slots plus the
 * resources its `notes` and `properties` slots name. Everything else about
 * a resource fetch — local-only, never a host fetch — is the caller's job
 * (`readResource`); this function never touches Store or IoC.
 *
 * Returns null (ABSENT, never a partial string) when any referenced
 * resource is not local, or the assembled text would exceed
 * `MAX_PROJECTION_CHARS`. Same input, same bytes, always — the cap and the
 * rule are both part of the derivation.
 */
export const projectLayer = async (
  layer: LayerLike | null | undefined,
  readResource: ReadLocalResource,
): Promise<string | null> => {
  if (!layer || typeof layer !== 'object') return null
  const name = typeof layer.name === 'string' ? layer.name : ''
  const lines: string[] = [name]

  const childSlots = new Set<string>(CHILD_SLOTS as readonly string[])
  const slots = Object.keys(layer).filter(slot => slot !== 'name' && !childSlots.has(slot)).sort()

  for (const slot of slots) {
    const value = layer[slot]

    if (slot === 'notes') {
      const sigs = Array.isArray(value) ? value.filter(asSig) : []
      if (sigs.length === 0) continue
      const noteLines: string[] = []
      if (!(await renderNotes(sigs, 1, readResource, new Set(), noteLines))) return null
      if (noteLines.length) lines.push('notes:', ...noteLines)
      continue
    }

    if (slot === 'properties') {
      const sigs = Array.isArray(value) ? value.filter(asSig) : []
      if (sigs.length === 0) continue
      const bytes = await readResource(sigs[0])
      if (!bytes) return null
      let parsed: unknown = null
      try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { parsed = null }
      const props = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
      const propLines = projectPropertiesLines(props)
      if (propLines.length) lines.push('properties:', ...propLines)
      continue
    }

    if (Array.isArray(value)) lines.push(`${slot}: ${value.length}`)
  }

  const text = lines.join('\n').replace(SIGNATURE_RUN, '')
  return text.length > MAX_PROJECTION_CHARS ? null : text
}

// ── the reader / minter split (molecule-index.service.ts's pattern) ─────

type StoreLike = {
  /** THE READ-ONLY OPEN — never creates the pool directory. */
  openPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  /** Creates the pool directory if absent. Write-path only. */
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  /** The LOCAL read of a resource's bytes — OPFS only, never a host. */
  getResourceLocal(signature: string): Promise<Blob | null>
  /** The LOCAL read of a layer's bytes — OPFS only, never a host. */
  getLayerLocalBytes(signature: string): Promise<Uint8Array | null>
}

const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

const enqueueMint = (layerSig: string): void => {
  try {
    ioc<{ enqueue?: (sig: string) => void }>('@diamondcoreprocessor.com/LlmContextDrone')?.enqueue?.(layerSig)
  } catch { /* best-effort — a future commit queues it again regardless */ }
}

export class LlmContextService {

  /** Records read this session, by layer sig. A record for a sig can never
   *  go stale — the sig names the exact content it derives from. */
  #memo = new Map<string, LlmContextRecord>()

  /** The read-only pool handle, opened via `openPool` (never creates). */
  #pool: FileSystemDirectoryHandle | null | undefined

  get store(): StoreLike | undefined {
    return ioc<StoreLike>('@hypercomb.social/Store')
  }

  /** Read a record. Memo, then the pool, then null. NEVER derives, and
   *  never opens a directory or a file handle with `create: true`. */
  readRecord = async (layerSig: string): Promise<LlmContextRecord | null> => {
    const memo = this.#memo.get(layerSig)
    if (memo) return memo
    if (this.#pool === undefined) {
      this.#pool = (await this.store?.openPool(LLM_CONTEXT_MEANING).catch(() => null)) ?? null
    }
    if (!this.#pool) return null
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: false })
      const record = readableRecord(JSON.parse(await (await handle.getFile()).text()))
      if (!record) return null
      if (this.#memo.size > 64) this.#memo.clear()
      this.#memo.set(layerSig, record)
      return record
    } catch { return null }
  }

  /** Derive the record for a layer sig, in memory. No write — the caller
   *  (the phase, via the drone) decides whether to persist it. */
  derive = async (layerSig: string): Promise<LlmContextRecord | null> => {
    const store = this.store
    const bytes = await store?.getLayerLocalBytes(layerSig).catch(() => null)
    if (!bytes?.byteLength) return null
    let layer: LayerLike | null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes))
      layer = parsed && typeof parsed === 'object' ? parsed as LayerLike : null
    } catch { layer = null }
    if (!layer) return null

    const readResource: ReadLocalResource = async (sig) => {
      const blob = await store?.getResourceLocal(sig).catch(() => null)
      if (!blob) return null
      // `.text()` rather than `.arrayBuffer()` — every resource this reads
      // (notes, properties) is JSON, and `.text()` is the method the rest of
      // this codebase already relies on for blob reads of text content.
      return new TextEncoder().encode(await blob.text())
    }
    const text = await projectLayer(layer, readResource)
    return text === null ? null : { v: LLM_CONTEXT_DERIVATION, text }
  }

  /** Write a derived record, keyed by the sig it was derived from. Best-
   *  effort — a failed write costs a slower answer and nothing else. */
  writeRecord = async (layerSig: string, record: LlmContextRecord): Promise<void> => {
    const pool = (await this.store?.getPool(LLM_CONTEXT_MEANING).catch(() => null)) ?? null
    if (!pool) return
    try {
      const handle = await pool.getFileHandle(layerSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(JSON.stringify(record)) } finally { await writable.close() }
      this.#memo.set(layerSig, record)
      // The directory certainly exists now — let a later readRecord in this
      // instance reuse the handle instead of retrying openPool.
      if (!this.#pool) this.#pool = pool
    } catch { /* derived cache — a miss next time is the only cost */ }
  }

  /**
   * ONE RULE, TWO PATHS. The record when the pool already has it
   * (`minted: true`); otherwise the identical projection derived in memory
   * (`minted: false`), with the phase asked — via the drone, if one is
   * registered — to persist it for next time. Warm and cold answer with the
   * same text, which is what makes "never load-bearing" a theorem rather
   * than a hope.
   */
  project = async (layerSig: string): Promise<{ readonly text: string; readonly minted: boolean } | null> => {
    const held = await this.readRecord(layerSig)
    if (held) return { text: held.text, minted: true }
    const derived = await this.derive(layerSig)
    if (!derived) return null
    enqueueMint(layerSig)
    return { text: derived.text, minted: false }
  }
}

/** THE REGISTERED SURFACE — the read half, and nothing else. `derive` and
 *  `writeRecord` are deliberately absent: minting belongs to the optimize
 *  phase, and a minter reachable through `ioc.get` is a resource walk plus
 *  a pool write that any render, navigation or keystroke path could start
 *  by accident. The drone constructs its own service. */
export interface LlmContextReader {
  readRecord(layerSig: string): Promise<LlmContextRecord | null>
  project(layerSig: string): Promise<{ readonly text: string; readonly minted: boolean } | null>
}

export const llmContextReader = (service: LlmContextService): LlmContextReader =>
  Object.freeze({
    readRecord: service.readRecord,
    project: service.project,
  })

export const LLM_CONTEXT_SERVICE_KEY = '@diamondcoreprocessor.com/LlmContext'

if ((window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register) {
  (window as unknown as { ioc: { register: (k: string, v: unknown) => void } })
    .ioc.register(LLM_CONTEXT_SERVICE_KEY, llmContextReader(new LlmContextService()))
}

/**
 * THE LENS — what `inflate()` substitutes under, when asked (history/
 * inflate.ts). `shadow` answers ONLY on a pool hit, via `readRecord`, which
 * never derives — the inflate path must not turn one signature into a
 * resource walk. `miss` enqueues the sig on the drone so the next optimize
 * pass mints it; a miss today is a slower `inflate` tomorrow, never wrong.
 */
export const llmContextLens = (service: LlmContextService): InflateLens => ({
  shadow: async (sig: string): Promise<string | null> => {
    const record = await service.readRecord(sig)
    return record ? record.text : null
  },
  miss: (sig: string): void => enqueueMint(sig),
})

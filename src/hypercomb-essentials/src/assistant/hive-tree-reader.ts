// assistant/hive-tree-reader.ts
//
// A SMALL, HEADLESS WINDOW INTO THE LIVE HIVE TREE.
//
// The visual tree follows carried Merkle links because it can progressively
// repaint. A model read cannot: Hypercomb commits history per page, so a deep
// child's live head may be newer than the signature its parent still carries.
// This reader uses the parent only to discover each immutable child NAME, then
// resolves the child's current LOCATION head before exposing its structure.
//
// Signatures never leave this module. A successful read stores a short-lived
// head vector behind an opaque id; the chat host revalidates that vector before
// allowing an action based on what the model saw. No bridge, navigation, view
// state, content slot, or filesystem surface participates.

import { CHILD_SLOTS, childSigsOfLayer } from '@hypercomb/core'
import type { CurrentLayerRef, LayerContent } from '../history/history.service.js'

export const HIVE_TREE_READER_IOC_KEY = '@diamondcoreprocessor.com/HypercombHiveTreeReader'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const SIG = /^[0-9a-f]{64}$/
const UNSAFE_NAME = /[\\/\u0000-\u001f\u007f]/

const MAX_DEPTH = 3
const MAX_NODES = 64
const MAX_BYTES = 12_000
const MAX_READ_MS = 5_000
const SNAPSHOT_TTL_MS = 2 * 60_000
const SNAPSHOT_LIMIT = 32
/** Read results kept for reuse; the oldest falls out first. */
const CACHE_LIMIT = 64

type HiveHistory = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerRefAt(locationSig: string, stats?: { cold?: boolean }): Promise<CurrentLayerRef | null>
  getLayerBySig(sig: string): Promise<LayerContent | null>
  childrenManifestFor?(layer: LayerContent): Promise<Array<{ sig: string; layer: LayerContent }> | null>
  treeEpoch(): number
}

type HiveStore = {
  getResource(sig: string): Promise<Blob | null>
  /** Verified module bytes from the `sign('bees')` pool — never imported here. */
  getBeeBytes?(sig: string): Promise<Uint8Array | null>
  /** Verified dependency bytes from the `sign('dependencies')` pool. */
  getDependencyBytes?(sig: string): Promise<Uint8Array | null>
}
type LayerCommitter = { settled(): Promise<void> }
type Lookup = <T>(key: string) => T | undefined

export type HypercombTreeNode = {
  readonly path: string
  readonly name: string
  readonly depth: number
  readonly childCount: number
}

export type HypercombTreeRead =
  | {
    readonly ok: true
    readonly root: string
    readonly nodes: readonly HypercombTreeNode[]
    readonly truncated: boolean
    /** Opaque, short-lived handle. It is never accepted back from the model. */
    readonly snapshot: string
  }
  | {
    readonly ok: false
    readonly root: string
    readonly code: 'not-found' | 'incomplete-read' | 'stale-read' | 'budget-exceeded' | 'unavailable'
  }

export type HypercombTreeReadOptions = {
  readonly maxDepth?: number
  readonly maxNodes?: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}

type SnapshotHead = { readonly locationSig: string; readonly layerSig: string }
type Snapshot = { readonly epoch: number; readonly heads: readonly SnapshotHead[]; readonly at: number }
type CarriedChild = { readonly name: string; readonly sig: string }

const MAX_HISTORY_MARKERS = 32
const COMPACTION_KEY = '@hypercomb.social/Compaction'
const PRELOADER_KEY = '@hypercomb.social/ScriptPreloader'
const DEPENDENCY_LOADER_KEY = '@hypercomb.social/DependencyLoader'
const MAX_CODE_ENTRIES = 200
const CONTROL = /[\u0000-\u001f\u007f]/g

export type HypercombNodeRead =
  | {
    readonly ok: true
    readonly root: string
    readonly name: string
    readonly layerSig: string
    readonly children: readonly CarriedChild[]
    /** Children declared but whose layers are not on this device — listed by
     *  signature instead of failing the read (the canvas skips them too). */
    readonly unresolved?: readonly string[]
    /** The layer's own slots, everything but `children`. Absent for `/list`. */
    readonly content?: Record<string, unknown>
    readonly truncated?: boolean
    /** Absent on a sig-addressed read: immutable content has no live head. */
    readonly snapshot?: string
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-found' | 'incomplete-read' | 'stale-read' | 'unavailable' }

export type HypercombHistoryRead =
  | {
    readonly ok: true
    readonly root: string
    readonly total: number
    readonly markers: readonly { readonly index: number; readonly layerSig: string; readonly at: number; readonly name: string }[]
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-found' | 'incomplete-read' | 'unavailable' }

export type HypercombFindRead =
  | {
    readonly ok: true
    readonly root: string
    readonly query: string
    readonly matches: readonly { readonly name: string; readonly path: string }[]
    readonly truncated: boolean
    readonly snapshot: string
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-found' | 'incomplete-read' | 'stale-read' | 'budget-exceeded' | 'unavailable' }

export type HypercombSummaryRead =
  | {
    readonly ok: true
    readonly root: string
    readonly name: string
    readonly layerSig: string
    readonly model: string
    readonly text: string
    readonly minted: boolean
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-found' | 'incomplete-read' | 'stale-read' | 'unavailable' | 'no-summariser' | 'failed' }

export type HypercombBytesRead =
  | {
    readonly ok: true
    readonly root: string
    readonly sig: string
    readonly of: 'resource' | 'bee' | 'dependency'
    readonly type: string
    readonly size: number
    readonly from: number
    /** Absent when the bytes are not text. */
    readonly text?: string
    readonly truncated: boolean
    readonly next?: number
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-found' | 'incomplete-read' | 'unavailable' }

export type HypercombCodeRead =
  | {
    readonly ok: true
    readonly root: string
    readonly query: string
    readonly entries: readonly { readonly name: string; readonly sig: string; readonly of: 'bee' | 'dependency' }[]
    readonly total: number
    readonly truncated: boolean
  }
  | { readonly ok: false; readonly root: string; readonly code: 'unavailable' }

/** The whole of a Blob as bytes — `arrayBuffer` where the Blob has it, a
 *  FileReader where it does not. */
const blobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  }))
}

/** UTF-8 text, or undefined for bytes that are not text. */
const textOf = (bytes: Uint8Array): string | undefined => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\u0000') ? undefined : text
  } catch { return undefined }
}

class StaleReadError extends Error {}
class ReadBudgetError extends Error {}
class IncompleteReadError extends Error {}

const stopped = (): DOMException => new DOMException('The Hypercomb tree read was stopped', 'AbortError')

const boundedInteger = (value: number | undefined, fallback: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(max, Math.floor(value)))
}

const rootLabel = (segments: readonly string[]): string => segments.length ? `/${segments.join('/')}` : '/'

const outputBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength

/** Strictly resolve a canonical child-signature slot. A missing pointer or a
 * malformed list is not an empty branch; it makes the observation incomplete. */
const childSigs = async (layer: LayerContent, store: HiveStore): Promise<readonly string[]> => {
  for (const slot of CHILD_SLOTS) {
    const value = layer[slot]
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      const sigs = value.map(String)
      if (sigs.some(sig => !SIG.test(sig))) throw new IncompleteReadError()
      return sigs
    }
    if (typeof value === 'string') {
      if (!SIG.test(value)) throw new IncompleteReadError()
      const blob = await store.getResource(value).catch(() => null)
      if (!blob) throw new IncompleteReadError()
      let parsed: unknown
      try { parsed = JSON.parse(await blob.text()) }
      catch { throw new IncompleteReadError() }
      if (!Array.isArray(parsed)) throw new IncompleteReadError()
      const sigs = parsed.map(String)
      if (sigs.some(sig => !SIG.test(sig))) throw new IncompleteReadError()
      return sigs
    }
    if (value !== undefined && value !== null) throw new IncompleteReadError()
  }
  return []
}

/** Resolve carried children only far enough to discover their immutable path
 * names. Complete manifest first, then verified layer bytes; never partial. */
const carriedChildren = async (
  layer: LayerContent,
  history: HiveHistory,
  store: HiveStore,
): Promise<readonly CarriedChild[]> => {
  const sigs = await childSigs(layer, store)
  if (sigs.length === 0) return []

  let manifestBySig: Map<string, LayerContent> | null = null
  if (typeof history.childrenManifestFor === 'function') {
    const manifest = await history.childrenManifestFor(layer).catch(() => null)
    if (manifest?.length === sigs.length) {
      const mapped = new Map<string, LayerContent>()
      for (const entry of manifest) {
        if (SIG.test(String(entry.sig)) && entry.layer) mapped.set(String(entry.sig), entry.layer)
      }
      if (sigs.every(sig => mapped.has(sig))) manifestBySig = mapped
    }
  }

  const seen = new Set<string>()
  const children: CarriedChild[] = []
  for (const sig of sigs) {
    const child = manifestBySig?.get(sig) ?? await history.getLayerBySig(sig).catch(() => null)
    const name = typeof child?.name === 'string' ? child.name : ''
    if (!child || !name || name.length > 256 || UNSAFE_NAME.test(name)) throw new IncompleteReadError()
    if (seen.has(name)) continue
    seen.add(name)
    children.push({ name, sig })
  }
  return children
}

/**
 * ONE TILE'S CHILDREN, READ THE WAY THE CANVAS READS THEM (core level-roster
 * `childLayersOf`, "the single definition of the tiles inside this one"). A
 * malformed entry is skipped, a nameless child — a meta atom — is named by
 * its signature, and a child whose layer is not on this device is listed as
 * unresolved instead of failing the whole read. The strict walk above stays
 * for `/tree`; a single tile read must not go blank on a live hive over one
 * child it cannot see (Jaime, 2026-09-13: every read came back
 * incomplete-read).
 */
const scannedChildren = async (
  layer: LayerContent,
  history: HiveHistory,
  store: HiveStore,
): Promise<{ readonly children: readonly CarriedChild[]; readonly unresolved: readonly string[] }> => {
  const sigs = await childSigsOfLayer(layer as never, store).catch(() => [] as string[])
  if (sigs.length === 0) return { children: [], unresolved: [] }

  const inlined = new Map<string, LayerContent>()
  if (typeof history.childrenManifestFor === 'function') {
    const manifest = await history.childrenManifestFor(layer).catch(() => null)
    if (manifest?.length === sigs.length) {
      for (const entry of manifest) if (SIG.test(String(entry.sig)) && entry.layer) inlined.set(String(entry.sig), entry.layer)
    }
  }

  const seen = new Set<string>()
  const children: CarriedChild[] = []
  const unresolved: string[] = []
  for (const sig of sigs) {
    const child = inlined.get(sig) ?? await history.getLayerBySig(sig).catch(() => null)
    if (!child) { unresolved.push(sig); continue }
    const raw = typeof child.name === 'string' ? child.name.replace(CONTROL, '').trim().slice(0, 256) : ''
    const name = raw || sig.slice(0, 8)
    if (seen.has(name)) continue
    seen.add(name)
    children.push({ name, sig })
  }
  return { children, unresolved }
}

export class HypercombHiveTreeReader {
  readonly #lookup: Lookup
  readonly #snapshots = new Map<string, Snapshot>()
  #sequence = 0

  constructor(lookup: Lookup = ((key: string) => window.ioc?.get<unknown>(key)) as Lookup) {
    this.#lookup = lookup
  }

  #history(): HiveHistory | undefined { return this.#lookup<HiveHistory>(HISTORY_KEY) }
  #store(): HiveStore | undefined { return this.#lookup<HiveStore>(STORE_KEY) }
  #committer(): LayerCommitter | undefined { return this.#lookup<LayerCommitter>(COMMITTER_KEY) }

  #pruneSnapshots(now = Date.now()): void {
    for (const [id, snapshot] of this.#snapshots) {
      if (now - snapshot.at > SNAPSHOT_TTL_MS) this.#snapshots.delete(id)
    }
    while (this.#snapshots.size > SNAPSHOT_LIMIT) {
      const oldest = this.#snapshots.keys().next().value as string | undefined
      if (!oldest) break
      this.#snapshots.delete(oldest)
    }
  }

  #remember(epoch: number, heads: readonly SnapshotHead[]): string {
    this.#pruneSnapshots()
    const id = `tree-${Date.now().toString(36)}-${(++this.#sequence).toString(36)}`
    this.#snapshots.set(id, { epoch, heads: [...heads], at: Date.now() })
    this.#pruneSnapshots()
    return id
  }

  /** Bounded breadth-first structural read rooted only at a participant path. */
  async #readTreeLive(
    segments: readonly string[],
    options: HypercombTreeReadOptions = {},
    /** The cache already waited for pending commits: wait exactly once. */
    settled = false,
  ): Promise<HypercombTreeRead> {
    const root = rootLabel(segments)
    const history = this.#history()
    const store = this.#store()
    const committer = this.#committer()
    if (!history?.currentLayerRefAt || !store?.getResource || !committer?.settled) {
      return { ok: false, root, code: 'unavailable' }
    }

    const maxDepth = boundedInteger(options.maxDepth, 2, MAX_DEPTH)
    const maxNodes = Math.max(1, boundedInteger(options.maxNodes, 48, MAX_NODES))
    const maxBytes = Math.max(1_024, boundedInteger(options.maxBytes, 8_000, MAX_BYTES))
    const deadline = Date.now() + MAX_READ_MS
    const signal = options.signal

    try {
      if (signal?.aborted) throw stopped()
      if (!settled) await committer.settled()
      if (signal?.aborted) throw stopped()
      const epoch = history.treeEpoch()

      const guard = (): void => {
        if (signal?.aborted) throw stopped()
        if (Date.now() > deadline) throw new ReadBudgetError()
        if (history.treeEpoch() !== epoch) throw new StaleReadError()
      }
      const currentRef = async (path: readonly string[]): Promise<CurrentLayerRef | null> => {
        guard()
        const locationSig = await history.sign({ explorerSegments: () => [...path] })
        guard()
        const stats: { cold?: boolean } = {}
        const ref = await history.currentLayerRefAt(locationSig, stats)
        guard()
        if (!ref && stats.cold) throw new IncompleteReadError()
        return ref
      }

      const rootRef = await currentRef(segments)
      if (!rootRef) return { ok: false, root, code: 'not-found' }
      const rootChildren = await carriedChildren(rootRef.layer, history, store)
      guard()

      const nodes: HypercombTreeNode[] = []
      const heads: SnapshotHead[] = [{ locationSig: rootRef.locationSig, layerSig: rootRef.layerSig }]
      const first: HypercombTreeNode = {
        path: root,
        name: rootRef.layer.name || (segments[segments.length - 1] ?? 'hive'),
        depth: 0,
        childCount: rootChildren.length,
      }
      nodes.push(first)
      let bytes = outputBytes(first)
      let truncated = false
      let exhausted = false
      const queue: Array<{
        readonly path: readonly string[]
        readonly depth: number
        readonly children: readonly CarriedChild[]
      }> = [{ path: [...segments], depth: 0, children: rootChildren }]

      for (let cursor = 0; cursor < queue.length && !exhausted; cursor++) {
        const parent = queue[cursor]
        if (parent.depth >= maxDepth) {
          if (parent.children.length > 0) truncated = true
          continue
        }

        for (const carried of parent.children) {
          guard()
          if (nodes.length >= maxNodes) { truncated = true; exhausted = true; break }
          const path = [...parent.path, carried.name]
          const ref = await currentRef(path)
          // The live location disappearing while its live parent still names
          // it is an incomplete read, not an authoritative partial tree.
          if (!ref || ref.layer.name !== carried.name) throw new IncompleteReadError()
          const children = await carriedChildren(ref.layer, history, store)
          guard()
          const node: HypercombTreeNode = {
            path: rootLabel(path),
            name: carried.name,
            depth: parent.depth + 1,
            childCount: children.length,
          }
          const cost = outputBytes(node)
          if (bytes + cost > maxBytes) { truncated = true; exhausted = true; break }
          bytes += cost
          nodes.push(node)
          heads.push({ locationSig: ref.locationSig, layerSig: ref.layerSig })
          queue.push({ path, depth: node.depth, children })
        }
      }

      guard()
      return { ok: true, root, nodes, truncated, snapshot: this.#remember(epoch, heads) }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      if (error instanceof StaleReadError) return { ok: false, root, code: 'stale-read' }
      if (error instanceof ReadBudgetError) return { ok: false, root, code: 'budget-exceeded' }
      return { ok: false, root, code: 'incomplete-read' }
    }
  }

  /**
   * ONE TILE, WITH ITS CONTENT. The `hive` tool's `/read` and `/list` verbs
   * (documentation/anatomy-context-need.md §3): the layer at a route, its
   * own slots (everything but `children`, bounded to `maxBytes`), and its
   * children as `{ name, sig }`. Signatures ARE returned here — this door
   * only ever opens to the participant's local model or a provider they
   * granted (llm-hive-access.ts); `/tree` stays structure-only for the
   * ungranted case. Same epoch/snapshot discipline as `readTree`.
   */
  async #readNodeLive(
    segments: readonly string[],
    options: { readonly maxBytes?: number; readonly withContent?: boolean; readonly signal?: AbortSignal } = {},
    /** The cache already waited for pending commits: wait exactly once. */
    settled = false,
  ): Promise<HypercombNodeRead> {
    const root = rootLabel(segments)
    const history = this.#history()
    const store = this.#store()
    const committer = this.#committer()
    if (!history?.currentLayerRefAt || !store?.getResource || !committer?.settled) {
      return { ok: false, root, code: 'unavailable' }
    }
    const maxBytes = Math.max(512, boundedInteger(options.maxBytes, 8_000, MAX_BYTES))
    const signal = options.signal
    try {
      if (signal?.aborted) throw stopped()
      if (!settled) await committer.settled()
      const epoch = history.treeEpoch()
      const locationSig = await history.sign({ explorerSegments: () => [...segments] })
      const stats: { cold?: boolean } = {}
      const ref = await history.currentLayerRefAt(locationSig, stats)
      if (!ref && stats.cold) throw new IncompleteReadError()
      if (!ref) return { ok: false, root, code: 'not-found' }
      if (history.treeEpoch() !== epoch) throw new StaleReadError()
      const { children, unresolved } = await scannedChildren(ref.layer, history, store)
      if (history.treeEpoch() !== epoch) throw new StaleReadError()

      let content: Record<string, unknown> | undefined
      let truncated = false
      if (options.withContent !== false) {
        content = {}
        let bytes = 0
        for (const [slot, value] of Object.entries(ref.layer)) {
          if (slot === 'children' || value === undefined || value === null) continue
          const cost = JSON.stringify({ [slot]: value })?.length ?? 0
          if (bytes + cost > maxBytes) { truncated = true; continue }
          bytes += cost
          content[slot] = value
        }
      }
      return {
        ok: true,
        root,
        name: ref.layer.name || (segments[segments.length - 1] ?? 'hive'),
        layerSig: ref.layerSig,
        children,
        ...(unresolved.length ? { unresolved } : {}),
        ...(content ? { content, truncated } : {}),
        snapshot: this.#remember(epoch, [{ locationSig: ref.locationSig, layerSig: ref.layerSig }]),
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      if (error instanceof StaleReadError) return { ok: false, root, code: 'stale-read' }
      return { ok: false, root, code: 'incomplete-read' }
    }
  }

  /**
   * THE BAG AT A ROUTE — the `hive` tool's `/history` verb. The lineage
   * markers of the tile at `segments`, oldest first, bounded to the last
   * `limit`. Each marker names one complete earlier layer (§6: walked,
   * never diffed); the model may `/read` none of them yet — routes address
   * the present, and an earlier sig is a later verb — but it can see how
   * many there are, when, and what each was called.
   */
  async #readHistoryLive(
    segments: readonly string[],
    options: { readonly limit?: number; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombHistoryRead> {
    const root = rootLabel(segments)
    const history = this.#history() as (HiveHistory & {
      listLayers?(locationSig: string): Promise<readonly { index: number; layerSig: string; at: number }[]>
    }) | undefined
    if (!history?.listLayers || !history.sign) return { ok: false, root, code: 'unavailable' }
    const limit = Math.max(1, boundedInteger(options.limit, 12, MAX_HISTORY_MARKERS))
    try {
      if (options.signal?.aborted) throw stopped()
      const locationSig = await history.sign({ explorerSegments: () => [...segments] })
      const all = await history.listLayers(locationSig)
      if (!all.length) return { ok: false, root, code: 'not-found' }
      const tail = all.slice(-limit)
      const markers = []
      for (const entry of tail) {
        if (options.signal?.aborted) throw stopped()
        const layer = await history.getLayerBySig(entry.layerSig).catch(() => null)
        markers.push({
          index: entry.index,
          layerSig: entry.layerSig,
          at: entry.at,
          name: typeof layer?.name === 'string' ? layer.name : '',
        })
      }
      return { ok: true, root, total: all.length, markers }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      return { ok: false, root, code: 'incomplete-read' }
    }
  }

  /**
   * A LAYER BY SIGNATURE — `/read <sig>` and `/list <sig>`. Immutable
   * content: an earlier version a `/history` marker named, or a child a
   * `/list` returned. No location head, so no snapshot — there is nothing
   * to go stale. Reads the verified bytes through the history service.
   */
  async #readNodeBySigLive(
    sig: string,
    options: { readonly maxBytes?: number; readonly withContent?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombNodeRead> {
    const root = sig
    const history = this.#history()
    const store = this.#store()
    if (!history?.getLayerBySig || !store?.getResource) return { ok: false, root, code: 'unavailable' }
    if (!SIG.test(sig)) return { ok: false, root, code: 'not-found' }
    const maxBytes = Math.max(512, boundedInteger(options.maxBytes, 8_000, MAX_BYTES))
    try {
      if (options.signal?.aborted) throw stopped()
      const layer = await history.getLayerBySig(sig).catch(() => null)
      if (!layer) return { ok: false, root, code: 'not-found' }
      const { children, unresolved } = await scannedChildren(layer, history, store)
      let content: Record<string, unknown> | undefined
      let truncated = false
      if (options.withContent !== false) {
        content = {}
        let bytes = 0
        for (const [slot, value] of Object.entries(layer)) {
          if (slot === 'children' || value === undefined || value === null) continue
          const cost = JSON.stringify({ [slot]: value })?.length ?? 0
          if (bytes + cost > maxBytes) { truncated = true; continue }
          bytes += cost
          content[slot] = value
        }
      }
      return {
        ok: true, root, name: layer.name || sig.slice(0, 8), layerSig: sig, children,
        ...(unresolved.length ? { unresolved } : {}),
        ...(content ? { content, truncated } : {}),
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      return { ok: false, root, code: 'incomplete-read' }
    }
  }

  /**
   * NAMES UNDER A ROUTE — `/find <word>`. The same bounded walk as `/tree`
   * (depth 3, node and byte budgets, one snapshot), filtered by a
   * case-insensitive name fragment. Returns paths the model can `/read`.
   */
  async find(
    query: string,
    segments: readonly string[],
    options: { readonly maxNodes?: number; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombFindRead> {
    const root = rootLabel(segments)
    const needle = String(query ?? '').trim().toLowerCase()
    if (!needle) return { ok: false, root, code: 'not-found' }
    const walk = await this.readTree(segments, {
      maxDepth: MAX_DEPTH, maxNodes: MAX_NODES, maxBytes: MAX_BYTES, signal: options.signal,
    })
    if (!walk.ok) return { ok: false, root, code: walk.code }
    const limit = Math.max(1, boundedInteger(options.maxNodes, 48, MAX_NODES))
    const hits = walk.nodes.filter(node => node.depth > 0 && node.name.toLowerCase().includes(needle))
    return {
      ok: true, root, query: needle,
      matches: hits.slice(0, limit).map(node => ({ name: node.name, path: node.path })),
      truncated: walk.truncated || hits.length > limit,
      snapshot: walk.snapshot,
    }
  }

  /**
   * THE SUMMARY OF A TILE — the `/summary` verb (anatomy-context-need §5).
   * Resolves the tile like `/read`, then asks compaction for the record
   * keyed by its layer sig; on a miss the tile's content (what `/read`
   * returns, same bound) is summarised once by the first mediator-ranked
   * provider the gate admits, and stored. The model never sees the pool.
   */
  async readSummary(
    segments: readonly string[],
    options: { readonly maxBytes?: number; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombSummaryRead> {
    const root = rootLabel(segments)
    const compaction = this.#lookup<{
      summarize?(inputSig: string, content: () => Promise<string | undefined>, signal?: AbortSignal): Promise<
        { ok: true; record: { model: string; text: string }; minted: boolean } | { ok: false; code: string }>
    }>(COMPACTION_KEY)
    if (!compaction?.summarize) return { ok: false, root, code: 'unavailable' }
    const node = await this.readNode(segments, { maxBytes: options.maxBytes ?? MAX_BYTES, withContent: true, signal: options.signal })
    if (!node.ok) return { ok: false, root, code: node.code }
    const content = async (): Promise<string | undefined> =>
      JSON.stringify({ name: node.name, content: node.content ?? {}, children: node.children.map(child => child.name) })
    const result = await compaction.summarize(node.layerSig, content, options.signal)
    if (!result.ok) {
      const code = result.code === 'no-summariser' || result.code === 'failed' ? result.code : 'unavailable'
      return { ok: false, root, code }
    }
    return { ok: true, root, name: node.name, layerSig: node.layerSig, model: result.record.model, text: result.record.text, minted: result.minted }
  }

  /**
   * WHAT A SIGNATURE NAMES, OPENED — `/read <sig>` when the signature is not
   * a layer, and `/read <sig> <from>` (Jaime, 2026-09-13: "open and review
   * every resource and including the code"). A module from the bees pool, a
   * dependency from its pool, else a resource from the store; text a page at
   * a time from `from` characters in. Bytes that are not text report their
   * type and size only. Modules are read as bytes and never imported, so
   * reading code can never run it. Immutable, so cached by signature.
   */
  async readBytesBySig(
    sig: string,
    options: { readonly from?: number; readonly maxBytes?: number; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombBytesRead> {
    if (options.signal?.aborted) throw stopped()
    const from = Math.max(0, Math.floor(Number(options.from) || 0))
    const key = `bytes|${JSON.stringify([sig, from, options.maxBytes])}`
    const hit = this.#cacheGet<HypercombBytesRead>(key)
    if (hit) return hit
    const read = await this.#readBytesBySigLive(sig, from, options)
    this.#cacheSet(key, null, read)
    return read
  }

  async #readBytesBySigLive(
    sig: string,
    from: number,
    options: { readonly maxBytes?: number; readonly signal?: AbortSignal },
  ): Promise<HypercombBytesRead> {
    const root = sig
    const store = this.#store()
    if (!store?.getResource) return { ok: false, root, code: 'unavailable' }
    if (!SIG.test(sig)) return { ok: false, root, code: 'not-found' }
    const maxBytes = Math.max(512, boundedInteger(options.maxBytes, 8_000, MAX_BYTES))
    try {
      let of: 'bee' | 'dependency' | 'resource' = 'bee'
      let type = 'text/javascript'
      let bytes = (await store.getBeeBytes?.(sig).catch(() => null)) ?? null
      if (!bytes) {
        of = 'dependency'
        bytes = (await store.getDependencyBytes?.(sig).catch(() => null)) ?? null
      }
      if (!bytes) {
        of = 'resource'
        const blob = await store.getResource(sig).catch(() => null)
        if (!blob) return { ok: false, root, code: 'not-found' }
        type = blob.type
        bytes = await blobBytes(blob)
      }
      if (options.signal?.aborted) throw stopped()
      const text = textOf(bytes)
      if (text === undefined) {
        return { ok: true, root, sig, of, type: type || 'application/octet-stream', size: bytes.byteLength, from: 0, truncated: false }
      }
      const page = text.slice(from, from + maxBytes)
      const end = from + page.length
      const more = end < text.length
      return {
        ok: true, root, sig, of, type: type || 'text/plain', size: bytes.byteLength, from, text: page,
        truncated: more, ...(more ? { next: end } : {}),
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      return { ok: false, root, code: 'incomplete-read' }
    }
  }

  /**
   * THE RUNNING CODE BY NAME — `/code` and `/code <word>`. Every module the
   * script preloader loaded and every dependency the import map carries,
   * each with the signature `/read` opens. The names come from the runtime,
   * never from a list kept here.
   */
  async listCode(
    query: string,
    options: { readonly maxEntries?: number; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombCodeRead> {
    const root = 'code'
    if (options.signal?.aborted) throw stopped()
    const preloader = this.#lookup<{ actions?: readonly { signature?: string; name?: string }[] }>(PRELOADER_KEY)
    const loader = this.#lookup<{ loadedSignatures?: readonly string[] }>(DEPENDENCY_LOADER_KEY)
    const aliases = (globalThis as { __hypercombAliasMap?: unknown }).__hypercombAliasMap
    if (!preloader?.actions && !loader?.loadedSignatures && !(aliases instanceof Map)) return { ok: false, root, code: 'unavailable' }

    const entries = new Map<string, { name: string; sig: string; of: 'bee' | 'dependency' }>()
    const add = (rawSig: unknown, rawName: unknown, of: 'bee' | 'dependency'): void => {
      const sig = String(rawSig ?? '').replace(/\.js$/i, '').toLowerCase()
      if (!SIG.test(sig) || entries.has(sig)) return
      const name = String(rawName ?? '').replace(CONTROL, '').trim().slice(0, 256) || sig.slice(0, 12)
      entries.set(sig, { name, sig, of })
    }
    for (const action of preloader?.actions ?? []) add(action?.signature, action?.name, 'bee')
    if (aliases instanceof Map) for (const [alias, sig] of aliases) add(sig, alias, 'dependency')
    for (const sig of loader?.loadedSignatures ?? []) add(sig, '', 'dependency')

    const needle = String(query ?? '').trim().toLowerCase()
    const matched = [...entries.values()]
      .filter(entry => !needle || entry.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
    const limit = Math.max(1, boundedInteger(options.maxEntries, 60, MAX_CODE_ENTRIES))
    return { ok: true, root, query: needle, entries: matched.slice(0, limit), total: matched.length, truncated: matched.length > limit }
  }

  // ── THE READ CACHE ──────────────────────────────────────────────────────
  //
  // LOOKED UP ONCE, REUSED (Jaime, 2026-09-13: "keep our own cache in memory
  // locally within the hive so it can be reused quickly upon new questions
  // that require the same context"). Every read a model makes is kept here
  // for the session, so the next question needing the same context is
  // answered without walking the store again.
  //
  // It can never serve a stale answer. A route read is keyed by the tree
  // epoch — any change anywhere moves the epoch, and the next read is fresh.
  // A read by signature is keyed by the signature, because that content can
  // never change. Only successful reads are kept, and a hit mints a FRESH
  // snapshot from the heads it was read at, so the change check that guards
  // a later write still validates. In memory only: a derived cache that is
  // wipe-safe by construction and never load-bearing.

  readonly #cache = new Map<string, { readonly epoch: number | null; readonly heads?: readonly SnapshotHead[]; readonly value: unknown }>()

  #cacheGet<T extends { ok: boolean; snapshot?: string }>(key: string): T | undefined {
    const hit = this.#cache.get(key)
    if (!hit) return undefined
    const value = hit.value as T
    if (!hit.heads || hit.epoch === null) return value
    return { ...value, snapshot: this.#remember(hit.epoch, hit.heads) }
  }

  #cacheSet(key: string, epoch: number | null, value: { ok: boolean; snapshot?: string }): void {
    if (!value.ok) return
    const heads = value.snapshot ? this.#snapshots.get(value.snapshot)?.heads : undefined
    this.#cache.delete(key)
    this.#cache.set(key, { epoch, ...(heads ? { heads: [...heads] } : {}), value })
    if (epoch !== null) {
      for (const [other, entry] of this.#cache) if (entry.epoch !== null && entry.epoch !== epoch) this.#cache.delete(other)
    }
    while (this.#cache.size > CACHE_LIMIT) {
      const oldest = this.#cache.keys().next().value as string | undefined
      if (!oldest) break
      this.#cache.delete(oldest)
    }
  }

  /** The epoch a route read would be taken at, once pending commits land. */
  async #settledEpoch(signal?: AbortSignal): Promise<number | undefined> {
    const history = this.#history()
    const committer = this.#committer()
    if (!history?.treeEpoch || !committer?.settled) return undefined
    if (signal?.aborted) throw stopped()
    await committer.settled()
    if (signal?.aborted) throw stopped()
    return history.treeEpoch()
  }

  async readTree(segments: readonly string[], options: HypercombTreeReadOptions = {}): Promise<HypercombTreeRead> {
    const epoch = await this.#settledEpoch(options.signal)
    if (epoch === undefined) return this.#readTreeLive(segments, options)
    const key = `tree|${JSON.stringify([segments, options.maxDepth, options.maxNodes, options.maxBytes])}|${epoch}`
    const hit = this.#cacheGet<HypercombTreeRead>(key)
    if (hit) return hit
    const read = await this.#readTreeLive(segments, options, true)
    this.#cacheSet(key, epoch, read)
    return read
  }

  async readNode(
    segments: readonly string[],
    options: { readonly maxBytes?: number; readonly withContent?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombNodeRead> {
    const epoch = await this.#settledEpoch(options.signal)
    if (epoch === undefined) return this.#readNodeLive(segments, options)
    // SIGNATURES ARE THE LOOKUP KEYS (Jaime, 2026-09-13: "just need to store
    // the signatures as lookup keys"). A route is kept only as what it
    // resolved to at this epoch — its signature and head, never its content —
    // and the content is looked up by that signature, the same entry a read
    // by signature uses. Any change moves the epoch and the route resolves
    // afresh; the content behind a signature never changes.
    const routeKey = `${JSON.stringify(segments)}|${epoch}`
    const route = this.#routes.get(routeKey)
    if (route) {
      const read = await this.readNodeBySig(route.layerSig, options)
      if (read.ok) return { ...read, root: rootLabel(segments), name: route.name, snapshot: this.#remember(epoch, [route.head]) }
    }
    const read = await this.#readNodeLive(segments, options, true)
    const head = read.ok && read.snapshot ? this.#snapshots.get(read.snapshot)?.heads[0] : undefined
    if (read.ok && head) {
      for (const [key, entry] of this.#routes) if (entry.epoch !== epoch) this.#routes.delete(key)
      this.#routes.set(routeKey, { epoch, head, layerSig: read.layerSig, name: read.name })
      while (this.#routes.size > CACHE_LIMIT) this.#routes.delete(this.#routes.keys().next().value as string)
      const { snapshot: _snapshot, ...content } = read
      const bySignature: HypercombNodeRead = { ...content, root: read.layerSig }
      this.#cacheSet(`sig|${JSON.stringify([read.layerSig, options.maxBytes, options.withContent !== false])}`, null, bySignature)
    }
    return read
  }

  /** Route → the signature it resolved to at one epoch. Signatures only. */
  readonly #routes = new Map<string, { readonly epoch: number; readonly head: SnapshotHead; readonly layerSig: string; readonly name: string }>()

  async readHistory(
    segments: readonly string[],
    options: { readonly limit?: number; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombHistoryRead> {
    const epoch = await this.#settledEpoch(options.signal)
    if (epoch === undefined) return this.#readHistoryLive(segments, options)
    const key = `history|${JSON.stringify([segments, options.limit])}|${epoch}`
    const hit = this.#cacheGet<HypercombHistoryRead>(key)
    if (hit) return hit
    const read = await this.#readHistoryLive(segments, options)
    this.#cacheSet(key, epoch, read)
    return read
  }

  async readNodeBySig(
    sig: string,
    options: { readonly maxBytes?: number; readonly withContent?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<HypercombNodeRead> {
    if (options.signal?.aborted) throw stopped()
    // Immutable content: keyed by the signature alone, valid across epochs.
    const key = `sig|${JSON.stringify([sig, options.maxBytes, options.withContent !== false])}`
    const hit = this.#cacheGet<HypercombNodeRead>(key)
    if (hit) return hit
    const read = await this.#readNodeBySigLive(sig, options)
    this.#cacheSet(key, null, read)
    return read
  }

  /** Revalidate the union of every bounded head vector the current model turn
   * used. The opaque ids come from the host closure, never model arguments. */
  async validateSnapshots(ids: readonly string[], signal?: AbortSignal): Promise<boolean> {
    if (ids.length === 0) return true
    const history = this.#history()
    const committer = this.#committer()
    if (!history?.currentLayerRefAt || !committer?.settled) return false
    if (signal?.aborted) throw stopped()
    await committer.settled()
    if (signal?.aborted) throw stopped()

    this.#pruneSnapshots()
    const snapshots = ids.map(id => this.#snapshots.get(id))
    if (snapshots.some(snapshot => !snapshot)) return false
    const epoch = history.treeEpoch()
    if (snapshots.some(snapshot => snapshot!.epoch !== epoch)) return false

    const expected = new Map<string, string>()
    for (const snapshot of snapshots as Snapshot[]) {
      for (const head of snapshot.heads) {
        const prior = expected.get(head.locationSig)
        if (prior && prior !== head.layerSig) return false
        expected.set(head.locationSig, head.layerSig)
      }
    }
    for (const [locationSig, layerSig] of expected) {
      if (signal?.aborted) throw stopped()
      const ref = await history.currentLayerRefAt(locationSig)
      if (!ref || ref.layerSig !== layerSig || history.treeEpoch() !== epoch) return false
    }
    return history.treeEpoch() === epoch
  }
}

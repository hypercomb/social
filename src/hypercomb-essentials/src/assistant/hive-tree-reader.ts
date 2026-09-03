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

import { CHILD_SLOTS } from '@hypercomb/core'
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

type HiveHistory = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerRefAt(locationSig: string, stats?: { cold?: boolean }): Promise<CurrentLayerRef | null>
  getLayerBySig(sig: string): Promise<LayerContent | null>
  childrenManifestFor?(layer: LayerContent): Promise<Array<{ sig: string; layer: LayerContent }> | null>
  treeEpoch(): number
}

type HiveStore = { getResource(sig: string): Promise<Blob | null> }
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
  async readTree(
    segments: readonly string[],
    options: HypercombTreeReadOptions = {},
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
      await committer.settled()
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

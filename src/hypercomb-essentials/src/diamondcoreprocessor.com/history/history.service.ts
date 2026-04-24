// diamondcoreprocessor.com/core/history.service.ts
import { SignatureService, SignatureStore } from '@hypercomb/core'

export type HistoryOpType =
  // Cell lifecycle
  | 'add'
  | 'remove'
  | 'reorder'
  | 'rename'
  // Drone lifecycle
  | 'add-drone'
  | 'remove-drone'
  // Feature state (signature-addressed payloads)
  | 'instruction-state'
  | 'tag-state'
  | 'content-state'
  | 'layout-state'
  // Visibility markers
  | 'hide'
  | 'unhide'

export type HistoryOp = {
  op: HistoryOpType
  cell: string
  at: number
  groupId?: string
}

export type LayerState = {
  bees: string[]
  layers: string[]
  dependencies: string[]
  resources: string[]
}

/**
 * A full, signature-addressed snapshot of everything a location's cells need.
 * Layer content is what gets hashed — identical states produce identical
 * signatures and dedupe automatically. Timestamps live on the *entry* that
 * references the layer, never in the layer itself.
 *
 * Ordering contract:
 * - `cells` is ordered (position in array = layout position).
 * - All other string arrays (`hidden`, `bees`, `dependencies`) are
 *   canonically sorted (lexicographic) so that set-equal states produce
 *   byte-equal JSON and dedupe.
 * - Object keys are sorted when serialized.
 */
export type LayerContent = {
  version: 2
  cells: string[]
  hidden: string[]
  contentByCell: Record<string, string>
  tagsByCell: Record<string, string[]>
  notesByCell: Record<string, string>
  bees: string[]
  dependencies: string[]
  layoutSig: string
  instructionsSig: string
}

/**
 * One history entry. Just a pointer to a layer resource plus the timestamp
 * at which this entry was appended. Entries live in
 * `__history__/{locationSig}/layers/{NNNNNNNN}.json`.
 */
export type LayerEntry = {
  layerSig: string
  at: number
}

export class HistoryService {

  // In-memory cache of full replay per signature. Keeps navigation instant —
  // history is the same until the next record()/updateLayer() append.
  readonly #replayCache = new Map<string, HistoryOp[]>()

  private get historyRoot(): FileSystemDirectoryHandle {
    const store = get<{ history: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    return store!.history
  }

  private readonly getBag = async (signature: string): Promise<FileSystemDirectoryHandle> => {
    const root = this.historyRoot
    return await root.getDirectoryHandle(signature, { create: true })
  }

  /**
   * Sign a lineage path to get the history bag signature.
   * Matches the same signing scheme as ShowCellDrone.
   */
  public readonly sign = async (lineage: any): Promise<string> => {
    const domain = String(lineage?.domain?.() ?? 'hypercomb.io')
    const explorerSegmentsRaw = lineage?.explorerSegments?.()
    const explorerSegments = Array.isArray(explorerSegmentsRaw)
      ? explorerSegmentsRaw
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      : []

    const lineagePath = explorerSegments.join('/')

    // include space (room) and secret — must match ShowHoneycomb.computeSignatureLocation()
    const roomStore = get<any>('@hypercomb.social/RoomStore')
    const secretStore = get<any>('@hypercomb.social/SecretStore')
    const space = roomStore?.value ?? ''
    const secret = secretStore?.value ?? ''
    const parts = [space, domain, lineagePath, secret, 'cell'].filter(Boolean)
    const key = parts.join('/')

    // use SignatureStore.signText() for memoization — same lineage = same sig
    const sigStore = get<SignatureStore>('@hypercomb/SignatureStore')
    return sigStore
      ? await sigStore.signText(key)
      : await SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)
  }

  /**
   * Record an operation into the history bag for the given signature.
   * Appends a sequential file (00000001, 00000002, ...) with JSON content.
   *
   * Ops are a legacy view — the primary history primitive is the layer
   * snapshot (commitLayer). Any edit while rewound simply appends a new
   * layer at head; previous layers remain immutable and addressable.
   */
  public readonly record = async (signature: string, operation: HistoryOp): Promise<void> => {
    const bag = await this.getBag(signature)

    const nextIndex = await this.nextIndex(bag)
    const fileName = String(nextIndex).padStart(8, '0')

    const fileHandle = await bag.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(operation))
    await writable.close()

    // keep the replay cache fresh so future navigations don't re-read OPFS
    const cached = this.#replayCache.get(signature)
    if (cached) cached.push(operation)
  }

  /**
   * Replay all operations in a bag, in order.
   * If upTo is provided, stop at that index (inclusive).
   */
  public readonly replay = async (signature: string, upTo?: number): Promise<HistoryOp[]> => {
    // cache-only fast path: full replay is memoized by signature
    if (upTo === undefined) {
      const cached = this.#replayCache.get(signature)
      if (cached) return cached
    }

    const root = this.historyRoot

    let bag: FileSystemDirectoryHandle
    try {
      bag = await root.getDirectoryHandle(signature, { create: false })
    } catch {
      if (upTo === undefined) this.#replayCache.set(signature, [])
      return []
    }

    const entries: { name: string; handle: FileSystemFileHandle }[] = []
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== 'file') continue
      entries.push({ name, handle: handle as FileSystemFileHandle })
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))

    const ops: HistoryOp[] = []
    for (const entry of entries) {
      const index = parseInt(entry.name, 10)
      if (isNaN(index)) continue
      if (upTo !== undefined && index > upTo) break

      try {
        const file = await entry.handle.getFile()
        const text = await file.text()
        const op = JSON.parse(text) as HistoryOp
        ops.push(op)
      } catch {
        // skip corrupted entries
      }
    }

    if (upTo === undefined) this.#replayCache.set(signature, ops)
    return ops
  }

  /**
   * List all signature bags in __history__/.
   */
  public readonly list = async (): Promise<{ signature: string; count: number }[]> => {
    const root = this.historyRoot
    const result: { signature: string; count: number }[] = []

    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue

      let count = 0
      for await (const [, child] of (handle as FileSystemDirectoryHandle).entries()) {
        if (child.kind === 'file') count++
      }

      result.push({ signature: name, count })
    }

    return result
  }

  /**
   * Return the latest operation index and contents for a given bag.
   */
  public readonly head = async (signature: string): Promise<{ index: number; op: HistoryOp } | null> => {
    const root = this.historyRoot

    let bag: FileSystemDirectoryHandle
    try {
      bag = await root.getDirectoryHandle(signature, { create: false })
    } catch {
      return null
    }

    let maxName = ''
    let maxHandle: FileSystemFileHandle | null = null

    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== 'file') continue
      if (name > maxName) {
        maxName = name
        maxHandle = handle as FileSystemFileHandle
      }
    }

    if (!maxHandle) return null

    try {
      const file = await maxHandle.getFile()
      const text = await file.text()
      const op = JSON.parse(text) as HistoryOp
      return { index: parseInt(maxName, 10), op }
    } catch {
      return null
    }
  }

  // -------------------------------------------------
  // layer.json — materialized layer state
  // -------------------------------------------------

  static readonly #LAYER_FILE = 'layer.json'

  static readonly #emptyLayer: LayerState = { bees: [], layers: [], dependencies: [], resources: [] }

  public readonly getLayer = async (signature: string): Promise<LayerState> => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(signature, { create: false })
      const handle = await bag.getFileHandle(HistoryService.#LAYER_FILE)
      const file = await handle.getFile()
      const text = await file.text()
      return JSON.parse(text) as LayerState
    } catch {
      return { ...HistoryService.#emptyLayer }
    }
  }

  public readonly putLayer = async (signature: string, state: LayerState): Promise<void> => {
    const bag = await this.getBag(signature)
    const handle = await bag.getFileHandle(HistoryService.#LAYER_FILE, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(JSON.stringify(state))
    } finally {
      await writable.close()
    }
  }

  public readonly updateLayer = async (
    signature: string,
    next: LayerState
  ): Promise<{ added: Partial<LayerState>; removed: Partial<LayerState> }> => {

    const prev = await this.getLayer(signature)

    const added: Partial<LayerState> = {}
    const removed: Partial<LayerState> = {}

    for (const key of ['bees', 'layers', 'dependencies', 'resources'] as const) {
      const prevSet = new Set(prev[key])
      const nextSet = new Set(next[key])

      const a = next[key].filter(s => !prevSet.has(s))
      const r = prev[key].filter(s => !nextSet.has(s))

      if (a.length) added[key] = a
      if (r.length) removed[key] = r
    }

    const hasChanges = Object.keys(added).length > 0 || Object.keys(removed).length > 0

    if (hasChanges) {
      const bag = await this.getBag(signature)
      const nextIndex = await this.nextIndex(bag)
      const fileName = String(nextIndex).padStart(8, '0')

      const handle = await bag.getFileHandle(fileName, { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(JSON.stringify({ added, removed, at: Date.now() }))
      } finally {
        await writable.close()
      }

      await this.putLayer(signature, next)

      // layer update writes a non-HistoryOp blob into the bag — invalidate so the
      // next replay re-reads rather than returning a stale cache.
      this.#replayCache.delete(signature)
    }

    return { added, removed }
  }

  // -------------------------------------------------
  // layer snapshots — signature-addressed history entries
  // -------------------------------------------------

  static readonly #LAYERS_DIR = 'layers'

  /**
   * Canonicalize a layer so byte-equal content produces byte-equal JSON.
   * `cells` keeps its caller-supplied order (position is meaningful). All
   * other string arrays are sorted lexicographically. Object keys are
   * inserted in sorted order; V8 preserves insertion order for string
   * keys, so plain `JSON.stringify` then produces stable output.
   */
  static readonly canonicalizeLayer = (layer: LayerContent): LayerContent => {
    const contentKeys = Object.keys(layer.contentByCell).sort()
    const contentByCell: Record<string, string> = {}
    for (const k of contentKeys) contentByCell[k] = layer.contentByCell[k]

    const tagKeys = Object.keys(layer.tagsByCell).sort()
    const tagsByCell: Record<string, string[]> = {}
    for (const k of tagKeys) tagsByCell[k] = [...layer.tagsByCell[k]].sort()

    const notesKeys = Object.keys(layer.notesByCell).sort()
    const notesByCell: Record<string, string> = {}
    for (const k of notesKeys) notesByCell[k] = layer.notesByCell[k]

    return {
      version: 2,
      cells: layer.cells.slice(),
      hidden: [...layer.hidden].sort(),
      contentByCell,
      tagsByCell,
      notesByCell,
      bees: [...layer.bees].sort(),
      dependencies: [...layer.dependencies].sort(),
      layoutSig: layer.layoutSig,
      instructionsSig: layer.instructionsSig,
    }
  }

  /**
   * Commit a layer snapshot for a location.
   *
   * Writes the canonical layer content as a signature-addressed resource
   * (via Store.putResource) and appends an entry file pointing at it
   * under `__history__/{locationSig}/layers/NNNNNNNN.json`. Skips the
   * append if the new layer signature equals the current head (dedup).
   *
   * @returns the layer signature, or null if the commit was deduped.
   */
  public readonly commitLayer = async (
    locationSig: string,
    layer: LayerContent,
  ): Promise<string | null> => {
    const canonical = HistoryService.canonicalizeLayer(layer)
    const json = JSON.stringify(canonical)
    const bytes = new TextEncoder().encode(json).buffer as ArrayBuffer
    const layerSig = await SignatureService.sign(bytes)

    // Content dedup: a new entry is appended only when the layer actually
    // differs from the current head. Identical canonical content produces
    // identical signatures, so a signature match is a bytewise content
    // match. Without this, repeated `synchronize` / `render:cell-count`
    // ticks flood history with entries that show as "(no change)".
    const head = await this.headLayer(locationSig)
    if (head && head.layerSig === layerSig) return null

    // The entry file is a pointer to the resource — we must write the
    // resource first. If the Store isn't registered yet, refuse the
    // commit entirely rather than creating an orphan entry that would
    // render as "(loading)" in the viewer forever.
    const store = get<{ putResource: (blob: Blob) => Promise<void> }>('@hypercomb.social/Store')
    if (!store) return null
    await store.putResource(new Blob([json], { type: 'application/json' }))

    const layersDir = await this.#getLayersDir(locationSig)
    const nextIndex = await this.#nextLayerIndex(locationSig, layersDir)
    const fileName = String(nextIndex).padStart(8, '0') + '.json'

    const handle = await layersDir.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    try {
      const entry: LayerEntry = { layerSig, at: Date.now() }
      await writable.write(JSON.stringify(entry))
    } finally {
      await writable.close()
    }

    return layerSig
  }

  /**
   * Read the highest-numbered layer entry for a location, or null if the
   * location has no layer history yet.
   */
  public readonly headLayer = async (
    locationSig: string,
  ): Promise<(LayerEntry & { index: number }) | null> => {
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return null

    let maxName = ''
    let maxHandle: FileSystemFileHandle | null = null
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      if (name > maxName) {
        maxName = name
        maxHandle = handle as FileSystemFileHandle
      }
    }
    if (!maxHandle) return null

    try {
      const file = await maxHandle.getFile()
      const entry = JSON.parse(await file.text()) as LayerEntry
      return { ...entry, index: parseInt(maxName, 10) }
    } catch {
      return null
    }
  }

  /**
   * Read a specific layer entry by index. Returns null if missing.
   */
  public readonly getLayerAt = async (
    locationSig: string,
    index: number,
  ): Promise<LayerEntry | null> => {
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return null

    const fileName = String(index).padStart(8, '0') + '.json'
    try {
      const handle = await layersDir.getFileHandle(fileName, { create: false })
      const file = await handle.getFile()
      return JSON.parse(await file.text()) as LayerEntry
    } catch {
      return null
    }
  }

  /**
   * List all layer entries for a location, sorted by index ascending.
   * Entries whose referenced layer resource can no longer be resolved are
   * filtered out — they are dead pointers that would otherwise render as
   * "(loading)" forever in the history viewer.
   */
  public readonly listLayers = async (
    locationSig: string,
  ): Promise<Array<LayerEntry & { index: number }>> => {
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return []

    const raw: Array<LayerEntry & { index: number }> = []
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const entry = JSON.parse(await file.text()) as LayerEntry
        raw.push({ ...entry, index: parseInt(name, 10) })
      } catch {
        // skip corrupted entries
      }
    }
    raw.sort((a, b) => a.index - b.index)

    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    const resolved = new Set<string>()
    if (store) {
      const uniqueSignatures = Array.from(new Set(raw.map(e => e.layerSig)))
      await Promise.all(uniqueSignatures.map(async (signature) => {
        try {
          const blob = await store.getResource(signature)
          if (blob) resolved.add(signature)
        } catch {
          // leave unresolved — entry will be filtered out below
        }
      }))
    }

    // Drop entries whose backing resource can't be resolved — they'd
    // render as "(loading)" forever. Consecutive-duplicate collapse
    // previously lived here too, but promoteToHead legitimately
    // produces consecutive-duplicate entries (that's the whole point:
    // bring a past sig back to head), and silently hiding those
    // looked like a broken button. Legacy bags that still contain
    // runs can be cleaned up through the delete button now.
    const filtered: Array<LayerEntry & { index: number }> = []
    for (const entry of raw) {
      if (store && !resolved.has(entry.layerSig)) continue
      filtered.push(entry)
    }
    return filtered
  }

  // -------------------------------------------------
  // layer promotion / soft-delete / merge
  // -------------------------------------------------
  //
  // Three primitives the viewer binds to its per-row and multi-select
  // action buttons:
  //
  //   promoteToHead(sig)          → append a new entry at head that
  //                                  points at the same layer content.
  //                                  Same sig, new index, new timestamp.
  //                                  The layer lives twice in the bag —
  //                                  that's the whole point: bringing a
  //                                  past state back to head without
  //                                  touching the past.
  //
  //   removeEntries(indexes[])    → soft-delete: move entry files into
  //                                  __deleted__/{locSig}/ with the full
  //                                  layer JSON as content. 30 days from
  //                                  `deletedAt` they are GC'd out by
  //                                  pruneExpiredDeletes. Restorable
  //                                  because the content is still
  //                                  byte-equal under its original sig.
  //
  //   mergeEntries(indexes[])     → multi-select merge. Picks the newest
  //                                  selected entry's content as the
  //                                  combined state, appends it to head
  //                                  via promoteToHead, then removes all
  //                                  the selected entries so the bag
  //                                  ends up with one fewer row instead
  //                                  of one more. Deletion is soft.

  static readonly #DELETED_DIR = '__deleted__'
  static readonly #DELETE_TTL_MS = 30 * 24 * 60 * 60 * 1000

  /**
   * Force-append a new entry at head pointing at the given layer sig.
   * Used to promote a historical layer back to current without touching
   * the past. Skips the dedup gate commitLayer applies; the whole point
   * is to re-use an existing sig as the new head.
   */
  public readonly promoteToHead = async (
    locationSig: string,
    layerSig: string,
  ): Promise<string | null> => {
    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store) return null
    // Sanity check — refuse to promote a dead pointer. If the resource
    // is missing the viewer would render "(loading)" forever, same as
    // the filtered-out dead entries in listLayers.
    const blob = await store.getResource(layerSig)
    if (!blob) return null

    const layersDir = await this.#getLayersDir(locationSig)
    const nextIndex = await this.#nextLayerIndex(locationSig, layersDir)
    const fileName = String(nextIndex).padStart(8, '0') + '.json'
    const handle = await layersDir.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    try {
      const entry: LayerEntry = { layerSig, at: Date.now() }
      await writable.write(JSON.stringify(entry))
    } finally {
      await writable.close()
    }
    return layerSig
  }

  /**
   * Soft-delete history entries. Each entry file's content is archived
   * (entry pointer + full layer JSON snapshot, so we have everything we
   * need to restore without depending on __resources__) into
   * __deleted__/{locSig}/{deletedAt}-{layerSig}.json, then the original
   * entry file is removed. 30-day TTL enforced by pruneExpiredDeletes.
   */
  public readonly removeEntries = async (
    locationSig: string,
    entryIndexes: number[],
  ): Promise<number> => {
    if (entryIndexes.length === 0) return 0
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return 0
    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    const deletedDir = await this.#getDeletedDir(locationSig)
    const deletedAt = Date.now()

    let removed = 0
    for (const index of entryIndexes) {
      const entryFile = String(index).padStart(8, '0') + '.json'
      let entry: LayerEntry | null = null
      try {
        const handle = await layersDir.getFileHandle(entryFile, { create: false })
        const file = await handle.getFile()
        entry = JSON.parse(await file.text()) as LayerEntry
      } catch {
        continue
      }

      // Archive: write deleted record that carries both the pointer
      // and the snapshot content, so restore doesn't depend on the
      // resource cache still being populated for this sig.
      let archivePayload: { deletedAt: number; entry: LayerEntry; layer: unknown } = {
        deletedAt,
        entry,
        layer: null,
      }
      if (store) {
        try {
          const blob = await store.getResource(entry.layerSig)
          if (blob) archivePayload.layer = JSON.parse(await blob.text())
        } catch { /* archive anyway with layer=null; restore will fall back to resource cache */ }
      }

      try {
        // Archive keeps the original filename — same 8-digit padded
        // index as the live entry used. Everything else (deletedAt,
        // layer snapshot, the entry pointer) lives in the payload so
        // the naming convention stays uniform across layers/ and
        // __deleted__/ and #nextLayerIndex can parseInt both dirs
        // identically.
        const archiveName = String(index).padStart(8, '0') + '.json'
        const archiveHandle = await deletedDir.getFileHandle(archiveName, { create: true })
        const writable = await archiveHandle.createWritable()
        try { await writable.write(JSON.stringify(archivePayload)) } finally { await writable.close() }
      } catch { /* if archive fails, skip the actual delete so the entry isn't lost */ continue }

      try { await layersDir.removeEntry(entryFile) } catch { /* already gone */ }
      removed++
    }
    return removed
  }

  /**
   * Multi-select "merge into head". Appends the newest selected layer's
   * content as the new head (via promoteToHead), then soft-deletes all
   * the selected source entries. Net effect: one new row at top, the
   * sources disappear from the active list but remain restorable from
   * __deleted__ for 30 days.
   */
  public readonly mergeEntries = async (
    locationSig: string,
    entryIndexes: number[],
  ): Promise<string | null> => {
    if (entryIndexes.length === 0) return null

    // Load the selected entries, ordered oldest → newest. The newest
    // selected entry's sig becomes the new head content.
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return null
    const sorted = [...entryIndexes].sort((a, b) => a - b)
    let newestSig: string | null = null
    for (const index of sorted) {
      const entryFile = String(index).padStart(8, '0') + '.json'
      try {
        const handle = await layersDir.getFileHandle(entryFile, { create: false })
        const file = await handle.getFile()
        const entry = JSON.parse(await file.text()) as LayerEntry
        newestSig = entry.layerSig
      } catch { /* skip missing */ }
    }
    if (!newestSig) return null

    const newSig = await this.promoteToHead(locationSig, newestSig)
    if (!newSig) return null
    await this.removeEntries(locationSig, sorted)
    return newSig
  }

  /**
   * GC pass: remove soft-deleted entries older than 30 days. Safe to
   * call at startup and after any delete/merge. Idempotent and bounded
   * by the number of deleted files at this location.
   */
  public readonly pruneExpiredDeletes = async (
    locationSig: string,
  ): Promise<number> => {
    const deletedDir = await this.#tryGetDeletedDir(locationSig)
    if (!deletedDir) return 0
    const cutoff = Date.now() - HistoryService.#DELETE_TTL_MS
    let pruned = 0
    const names: string[] = []
    for await (const [name, handle] of deletedDir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      names.push(name)
    }
    for (const name of names) {
      // Filename is just the original NNNNNNNN.json; deletedAt lives
      // in the payload. One file read per archived entry on a cold
      // startup GC — cheap enough given the archive is capped at
      // whatever the user soft-deleted over the last 30 days at this
      // single location.
      let deletedAt = 0
      try {
        const handle = await deletedDir.getFileHandle(name, { create: false })
        const file = await handle.getFile()
        const payload = JSON.parse(await file.text()) as { deletedAt?: number }
        deletedAt = Number(payload?.deletedAt ?? 0)
      } catch { continue }
      if (!Number.isFinite(deletedAt) || deletedAt === 0 || deletedAt > cutoff) continue
      try { await deletedDir.removeEntry(name); pruned++ } catch { /* already gone */ }
    }
    return pruned
  }

  readonly #getDeletedDir = async (
    locationSig: string,
  ): Promise<FileSystemDirectoryHandle> => {
    const bag = await this.getBag(locationSig)
    return await bag.getDirectoryHandle(HistoryService.#DELETED_DIR, { create: true })
  }

  readonly #tryGetDeletedDir = async (
    locationSig: string,
  ): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
      return await bag.getDirectoryHandle(HistoryService.#DELETED_DIR, { create: false })
    } catch {
      return null
    }
  }

  readonly #getLayersDir = async (
    locationSig: string,
  ): Promise<FileSystemDirectoryHandle> => {
    const bag = await this.getBag(locationSig)
    return await bag.getDirectoryHandle(HistoryService.#LAYERS_DIR, { create: true })
  }

  readonly #tryGetLayersDir = async (
    locationSig: string,
  ): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
      return await bag.getDirectoryHandle(HistoryService.#LAYERS_DIR, { create: false })
    } catch {
      return null
    }
  }

  /**
   * Next numeric index for a new entry at this location. Scans both the
   * active layers dir and the soft-delete archive so a just-deleted
   * highest index is never handed back out — that would reuse the
   * filename of a still-archived entry and confuse restore. Callers
   * derive this only ever at the moment of a fresh write, so scanning
   * is O(entries-at-this-location) and happens once per commit.
   */
  readonly #nextLayerIndex = async (
    locationSig: string,
    layersDir: FileSystemDirectoryHandle,
  ): Promise<number> => {
    let max = 0
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > max) max = n
    }
    // The archive stores `{NNNNNNNN}-{deletedAt}-{sig}.json`, so
    // parseInt picks up the leading index and we can compare.
    const deletedDir = await this.#tryGetDeletedDir(locationSig)
    if (deletedDir) {
      for await (const [name, handle] of deletedDir.entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue
        const n = parseInt(name, 10)
        if (!isNaN(n) && n > max) max = n
      }
    }
    return max + 1
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  private readonly nextIndex = async (bag: FileSystemDirectoryHandle): Promise<number> => {
    let max = 0
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== 'file') continue
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > max) max = n
    }
    return max + 1
  }
}

const _historyService = new HistoryService()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistoryService', _historyService)

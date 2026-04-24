// diamondcoreprocessor.com/core/history.service.ts
import { SignatureService, SignatureStore } from '@hypercomb/core'
import { canonicalise, parse as parseRecord, type DeltaRecord } from './delta-record.js'
export type { DeltaRecord } from './delta-record.js'

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
 * `__history__/{locationSig}/layers/{uuid}.json`. Filenames carry no
 * semantic meaning — they're opaque handles. Ordering comes from `at`.
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
    const fileName = await this.#nextEntryFilename(locationSig, layersDir)
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
   * Allocate the next sequential filename for an entry at this location.
   * Format is 8-digit zero-padded starting at 00000001. The filename is
   * ONLY used to guarantee a unique handle — nothing reads it to infer
   * order, head, or age (use the payload's `at` for that). Scans both
   * layers/ and __deleted__/ so a just-deleted highest slot never gets
   * handed back out and collide with an archived restore.
   */
  readonly #nextEntryFilename = async (
    locationSig: string,
    layersDir: FileSystemDirectoryHandle,
  ): Promise<string> => {
    let max = 0
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > max) max = n
    }
    const deletedDir = await this.#tryGetDeletedDir(locationSig)
    if (deletedDir) {
      for await (const [name, handle] of deletedDir.entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue
        const n = parseInt(name, 10)
        if (!isNaN(n) && n > max) max = n
      }
    }
    return String(max + 1).padStart(8, '0') + '.json'
  }

  /**
   * Head = the most recent entry. Found by scanning every entry, parsing
   * its payload, and picking the one with the highest `at`. Filenames
   * are opaque — never compared or parsed here. Returns null when the
   * location has no history yet.
   */
  public readonly headLayer = async (
    locationSig: string,
  ): Promise<(LayerEntry & { index: number; filename: string }) | null> => {
    const all = await this.listLayers(locationSig)
    if (all.length === 0) return null
    return all[all.length - 1]
  }

  /**
   * List all layer entries for a location, sorted chronologically by
   * `at` (oldest first). `index` is the position in that sorted array,
   * `filename` is the opaque on-disk handle — callers that need to
   * delete or promote a specific entry pass `filename` back in. Entries
   * whose backing resource can't be resolved are dropped so the viewer
   * never renders "(loading)" rows forever.
   */
  public readonly listLayers = async (
    locationSig: string,
  ): Promise<Array<LayerEntry & { index: number; filename: string }>> => {
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return []

    const raw: Array<LayerEntry & { filename: string }> = []
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const entry = JSON.parse(await file.text()) as LayerEntry
        raw.push({ ...entry, filename: name })
      } catch {
        // skip corrupted entries
      }
    }
    // Chronological order is the payload's `at`, not the filename.
    // Ties break on filename so the order is deterministic even when
    // two entries land on the same millisecond (rare but possible
    // during rapid programmatic commits).
    raw.sort((a, b) => (a.at - b.at) || a.filename.localeCompare(b.filename))

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

    const filtered: Array<LayerEntry & { index: number; filename: string }> = []
    let position = 0
    for (const entry of raw) {
      if (store && !resolved.has(entry.layerSig)) continue
      filtered.push({ ...entry, index: position })
      position++
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
    const fileName = await this.#nextEntryFilename(locationSig, layersDir)
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
   * Soft-delete history entries by filename. Each entry's content is
   * archived (entry pointer + full layer JSON snapshot) into
   * __deleted__/{locSig}/{sameFilename}, then the original entry file
   * is removed. 30-day TTL enforced by pruneExpiredDeletes.
   */
  public readonly removeEntries = async (
    locationSig: string,
    filenames: string[],
  ): Promise<number> => {
    if (filenames.length === 0) return 0
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return 0
    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    const deletedDir = await this.#getDeletedDir(locationSig)
    const deletedAt = Date.now()

    let removed = 0
    for (const filename of filenames) {
      let entry: LayerEntry | null = null
      try {
        const handle = await layersDir.getFileHandle(filename, { create: false })
        const file = await handle.getFile()
        entry = JSON.parse(await file.text()) as LayerEntry
      } catch {
        continue
      }

      // Archive payload carries the pointer and the snapshot content so
      // restore can re-verify the layer sig even if the resource cache
      // has evicted the signature later.
      const archivePayload: { deletedAt: number; entry: LayerEntry; layer: unknown } = {
        deletedAt,
        entry,
        layer: null,
      }
      if (store) {
        try {
          const blob = await store.getResource(entry.layerSig)
          if (blob) archivePayload.layer = JSON.parse(await blob.text())
        } catch { /* archive with layer=null */ }
      }

      try {
        // Reuse the same opaque filename in __deleted__/ — nothing
        // infers anything from it, so keeping it stable just means
        // restore can write straight back into layers/ under the
        // same handle if we ever wire a restore action.
        const archiveHandle = await deletedDir.getFileHandle(filename, { create: true })
        const writable = await archiveHandle.createWritable()
        try { await writable.write(JSON.stringify(archivePayload)) } finally { await writable.close() }
      } catch { continue }

      try { await layersDir.removeEntry(filename) } catch { /* already gone */ }
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
    filenames: string[],
  ): Promise<string | null> => {
    if (filenames.length === 0) return null

    // Load the selected entries by filename and pick the chronologically
    // newest one (highest `at`) — that entry's layer content becomes
    // the new head. Filenames are opaque, so we MUST read payloads to
    // decide order.
    const layersDir = await this.#tryGetLayersDir(locationSig)
    if (!layersDir) return null
    let newest: LayerEntry | null = null
    for (const filename of filenames) {
      try {
        const handle = await layersDir.getFileHandle(filename, { create: false })
        const file = await handle.getFile()
        const entry = JSON.parse(await file.text()) as LayerEntry
        if (!newest || entry.at > newest.at) newest = entry
      } catch { /* skip missing */ }
    }
    if (!newest) return null

    const newSig = await this.promoteToHead(locationSig, newest.layerSig)
    if (!newSig) return null
    await this.removeEntries(locationSig, filenames)
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

  // -------------------------------------------------
  // mechanical delta-record primitives
  // -------------------------------------------------
  //
  // Records are the pure-differential form of history. A record is
  // `{name, <op>: [sigs]}` serialised as raw line-oriented text (see
  // delta-record.ts). Records are immutable and content-addressed:
  // the record bytes live at `__layers__/{sig}` (flat, not in a
  // domain subfolder — LayerInstaller's domain-scoped package reads
  // iterate only directories, so flat sig files coexist cleanly).
  //
  // Per-location markers live at the bag root as opaque zero-padded
  // entry files (`__history__/{locSig}/NNNNNNNN`, no extension).
  // Each marker contains exactly one sig on one line. Ordering and
  // timestamps come from file.lastModified on the filesystem; under
  // the immutable-files invariant that IS the creation time. Nothing
  // is embedded in the content.
  //
  // Legacy op files that predate the layer system also live at the
  // bag root with the same NNNNNNNN naming. The reader discriminates
  // by content: a new marker file holds a 64-hex sig; a legacy op
  // file holds JSON with `{op, cell, at, ...}`. Coexistence is
  // stable because both formats sort by filename consistently.

  /**
   * Canonicalise the record, sign it, write the raw bytes into
   * `__layers__/{sig}`, and append a new marker at the bag root
   * containing only the record-sig. Returns the record-sig, or null
   * if the Store isn't available yet.
   */
  public readonly writeRecord = async (
    locationSig: string,
    record: DeltaRecord,
  ): Promise<string | null> => {
    const store = get<{ layers: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    if (!store?.layers) return null

    const canonical = canonicalise(record)
    const bytes = new TextEncoder().encode(canonical)
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    // Write the layer content to __layers__/{sig}. Content-addressed,
    // immutable — if the file already exists, skip the rewrite so we
    // don't invalidate any live Blob handles that point at it.
    let exists = true
    try { await store.layers.getFileHandle(sig) } catch { exists = false }
    if (!exists) {
      const handle = await store.layers.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    }

    // Append the marker at the bag root.
    const bag = await this.getBag(locationSig)
    const fileName = await this.#nextBagMarker(bag)
    const mhandle = await bag.getFileHandle(fileName, { create: true })
    const mwrite = await mhandle.createWritable()
    try { await mwrite.write(sig) } finally { await mwrite.close() }

    return sig
  }

  /**
   * Walk the bag root in chronological order, returning each marker
   * entry's record-sig plus its timestamp. Files whose content is
   * not a sig (legacy op files) are skipped — those readers have
   * their own replay path.
   */
  public readonly listRecordSigs = async (
    locationSig: string,
  ): Promise<Array<{ sig: string; at: number; filename: string }>> => {
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
    } catch {
      return []
    }
    const out: Array<{ sig: string; at: number; filename: string }> = []
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const text = (await file.text()).trim()
        // Discriminate marker (bare sig) from legacy op (JSON) from
        // anything else (skip). A sig is exactly 64 hex chars, single-
        // line, no whitespace.
        if (/^[a-f0-9]{64}$/.test(text)) {
          out.push({ sig: text, at: file.lastModified, filename: name })
        }
      } catch { /* skip unreadable entry */ }
    }
    out.sort((a, b) => (a.at - b.at) || a.filename.localeCompare(b.filename))
    return out
  }

  /**
   * Load + parse the DeltaRecord at the given signature from
   * __layers__/{sig}. Returns null on missing or malformed content.
   */
  public readonly resolveDeltaRecord = async (
    sig: string,
  ): Promise<DeltaRecord | null> => {
    const store = get<{ layers: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    if (!store?.layers) return null
    try {
      const handle = await store.layers.getFileHandle(sig, { create: false })
      const file = await handle.getFile()
      const text = await file.text()
      return parseRecord(text)
    } catch {
      return null
    }
  }

  readonly #nextBagMarker = async (
    bag: FileSystemDirectoryHandle,
  ): Promise<string> => {
    let max = 0
    for await (const [name] of (bag as any).entries()) {
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > max) max = n
    }
    return String(max + 1).padStart(8, '0')
  }

  // -------------------------------------------------

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

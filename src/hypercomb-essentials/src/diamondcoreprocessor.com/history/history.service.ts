// diamondcoreprocessor.com/core/history.service.ts
import { SignatureService, SignatureStore } from '@hypercomb/core'
import { canonicalise, parse as parseRecord, type DeltaRecord } from './delta-record.js'
import { reduce as reduceRecords, type HydratedState } from './delta-reducer.js'
export type { DeltaRecord } from './delta-record.js'
export type { HydratedState } from './delta-reducer.js'

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
 * A signature-addressed snapshot of a lineage's cell state.
 *
 * Two named arrays, nothing else. Per the architectural rule, a primitive
 * resource is an array of one useful type with a name — no heterogeneous
 * records. Tags, content, notes, bees, dependencies, layout, instructions
 * all live as their own primitives elsewhere (live OPFS reads, per-service
 * resources). Stuffing them into the layer made the layer a coupled bag
 * that drifted out of sync; primitives are decoupled by construction.
 *
 * Ordering contract:
 * - `cells` is ordered (position in array = layout position).
 * - `hidden` is canonically sorted (lexicographic) so set-equal states
 *   produce byte-equal JSON and dedupe.
 */
export type LayerContent = {
  cells: string[]
  hidden: string[]
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
  //
  // On hypercomb.io a lineage's history bag is self-contained:
  //
  //   __history__/{sign(lineage)}/
  //     {sig}              ← layer content, named by its own content sig
  //     {sig}              ← another layer content
  //     ...
  //     __temporary__/     ← soft-deleted layers (30-day TTL)
  //       {sig}
  //
  // No inner `layers/` subfolder. No marker indirection. No entry
  // wrapper JSON. The bag file IS the LayerContent JSON, named by the
  // hash of its bytes — same state collapses to the same file (natural
  // dedupe). Ordering comes from `file.lastModified`. Promotion ("make
  // head") rewrites the file to bump its lastModified; soft-delete
  // moves it into `__temporary__/{sig}` keeping the same name so a
  // restore can move it straight back without rewriting bytes.
  //
  // DCP, by contrast, splits the model: `__layers__/{sig}` holds layer
  // content shared across lineages, and `__history__/{lineageSig}/NNNNNNNN`
  // markers (each containing a single sig line) point into that pool.
  // Markers are a DCP-only indirection — they do not appear here.

  /**
   * Canonicalize a layer so byte-equal content produces byte-equal JSON.
   * `cells` keeps its caller-supplied order (position is meaningful).
   * `hidden` is sorted lexicographically so set-equal states dedupe.
   */
  static readonly canonicalizeLayer = (layer: LayerContent): LayerContent => ({
    cells: layer.cells.slice(),
    hidden: [...layer.hidden].sort(),
  })

  /**
   * Commit a layer snapshot for a location.
   *
   * Writes the canonical layer content directly into the lineage bag
   * as `__history__/{lineageSig}/{layerSig}` — the file IS the layer
   * content, named by the hash of its bytes. Same content → same sig
   * → same file (natural dedupe, no separate dedup table). Skips the
   * write if a file with that sig already exists so any cached Blob
   * handle elsewhere can't be invalidated by an idempotent rewrite.
   *
   * Also seeds Store.putResource so cross-bag resolvers (cursor warmup,
   * renderer) keep finding the content under the same sig — but the
   * source of truth for this lineage's history is the bag file itself.
   *
   * @returns the layer signature, or null if the layer was a no-op
   *          rewrite of the current head.
   */
  public readonly commitLayer = async (
    locationSig: string,
    layer: LayerContent,
  ): Promise<string | null> => {
    const canonical = HistoryService.canonicalizeLayer(layer)
    const json = JSON.stringify(canonical)
    const bytes = new TextEncoder().encode(json)
    const layerSig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    // 1. Content lives in the SHARED pool at __layers__/{sig}, not in
    //    the bag. Same shape as DCP — both sides have a flat content
    //    pool keyed by sig + a per-lineage __history__/ holding only
    //    markers. Sync convergence (matching merkle roots) requires
    //    identical structure on both sides.
    await this.#writeLayerToPool(layerSig, bytes)

    // 2. Append a marker at __history__/{lineage}/{NNNN} containing
    //    the sig. ALWAYS appended, even when the sig matches an
    //    existing pool entry — markers carry the per-event timeline,
    //    content lives once in the pool. Two markers may point at
    //    the same sig (overlap = dedupe).
    const bag = await this.getBag(locationSig)
    const markerName = await this.#nextMarkerName(bag)
    const markerHandle = await bag.getFileHandle(markerName, { create: true })
    const markerWritable = await markerHandle.createWritable()
    try { await markerWritable.write(layerSig) } finally { await markerWritable.close() }

    // Seed Store cache for cross-bag resolvers (warmup, diff inspector)
    // even though the bag-direct read path is the source of truth.
    const store = get<{ putResource: (blob: Blob) => Promise<void> }>('@hypercomb.social/Store')
    if (store) {
      try { await store.putResource(new Blob([json], { type: 'application/json' })) } catch { /* best-effort */ }
    }

    return layerSig
  }

  /**
   * Write layer bytes into the shared content pool at __layers__/{sig}.
   * Idempotent — if the file already exists with the same name, we
   * skip the write to keep any cached Blob handles valid. The pool
   * is the SAME shape and role as DCP's __layers__/{sig}, so sigs
   * are interchangeable across the push boundary.
   */
  readonly #writeLayerToPool = async (
    layerSig: string,
    bytes: Uint8Array,
  ): Promise<void> => {
    const store = get<{ layers: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    if (!store?.layers) return
    let exists = true
    try { await store.layers.getFileHandle(layerSig, { create: false }) } catch { exists = false }
    if (exists) return
    const handle = await store.layers.getFileHandle(layerSig, { create: true })
    const writable = await handle.createWritable()
    // Cast to ArrayBuffer for strict-mode FileSystemWriteChunkType.
    try { await writable.write(bytes.buffer as ArrayBuffer) } finally { await writable.close() }
  }

  /**
   * Head = the chronologically latest marker. Returns null when the
   * location has no markers yet.
   */
  public readonly headLayer = async (
    locationSig: string,
  ): Promise<(LayerEntry & { index: number; filename: string }) | null> => {
    const all = await this.listLayers(locationSig)
    if (all.length === 0) return null
    return all[all.length - 1]
  }

  /**
   * Filename conventions at the bag root:
   *   - 64-hex sig file → layer content (one per unique state)
   *   - 8-digit numeric → marker file (one per user event), content = a sig
   *
   * Two named shapes, two roles. The convention is mechanical — names
   * carry meaning, no inspection of content needed for routing. Markers
   * give us per-event history with overlap (multiple markers can point
   * at the same sig); sig files give us content dedupe.
   */
  static readonly #SIG_RE = /^[a-f0-9]{64}$/
  static readonly #MARKER_RE = /^\d{8}$/

  /**
   * List all marker entries for a location, sorted chronologically by
   * marker filename (numeric ascending, so the last element is the
   * latest commit). Each entry's `filename` is the MARKER name (used
   * for delete/promote ops); `layerSig` is the content sig the marker
   * points at; `at` is the marker file's lastModified.
   *
   * Multiple markers may share the same `layerSig` (overlap is the
   * whole point of markers — per-event history with content dedupe).
   */
  public readonly listLayers = async (
    locationSig: string,
  ): Promise<Array<LayerEntry & { index: number; filename: string }>> => {
    await this.#quarantineNonLayerFiles(locationSig)

    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
    } catch {
      return []
    }

    const markers: Array<LayerEntry & { filename: string }> = []
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const sig = (await file.text()).trim()
        if (!HistoryService.#SIG_RE.test(sig)) continue   // malformed marker, skip
        markers.push({ layerSig: sig, at: file.lastModified, filename: name })
      } catch { /* skip unreadable */ }
    }
    // Numeric ascending — markers are minted by #nextMarkerName as
    // monotonically increasing zero-padded integers. Tie-break on
    // filename for determinism when two markers share a millisecond.
    markers.sort((a, b) => a.filename.localeCompare(b.filename))

    return markers.map((entry, position) => ({ ...entry, index: position }))
  }

  /**
   * Allocate the next sequential marker name for this bag. Format is
   * 8-digit zero-padded starting at 00000001. Scans existing markers
   * (and the __temporary__ archive if present) for the current max so
   * a re-issued name can never collide with an archived entry.
   */
  readonly #nextMarkerName = async (
    bag: FileSystemDirectoryHandle,
  ): Promise<string> => {
    let max = 0
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > max) max = n
    }
    return String(max + 1).padStart(8, '0')
  }

  /**
   * Read a layer's content from the SHARED pool at __layers__/{sig}.
   * The pool is the source of truth — same shape on hypercomb and
   * DCP, sigs are interchangeable across the push boundary. The bag
   * holds only markers (per-event NNNN files containing a sig); the
   * content lives once in the pool no matter how many markers point
   * at it.
   *
   * Falls back to Store.getResource for legacy paths that may have
   * cached the bytes earlier. `locationSig` is unused but kept on
   * the signature for callers that haven't been updated yet.
   */
  public readonly getLayerContent = async (
    _locationSig: string,
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null

    let bytes: ArrayBuffer | null = null
    let blob: Blob | null = null

    // 1. Primary: read from the shared pool.
    const store = get<{
      layers: FileSystemDirectoryHandle
      getResource?: (sig: string) => Promise<Blob | null>
      putResource?: (blob: Blob) => Promise<void>
    }>('@hypercomb.social/Store')
    if (store?.layers) {
      try {
        const handle = await store.layers.getFileHandle(layerSig, { create: false })
        const file = await handle.getFile()
        bytes = await file.arrayBuffer()
        blob = file
      } catch { /* not in pool — try resource fallback */ }
    }

    // 2. Fallback: legacy resource cache.
    if (!bytes && store?.getResource) {
      const cached = await store.getResource(layerSig).catch(() => null)
      if (cached) {
        bytes = await cached.arrayBuffer()
        blob = cached
      }
    }

    if (!bytes) return null

    let parsed: Partial<LayerContent>
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LayerContent> }
    catch { return null }

    // Slim layer — only cells and hidden. Anything else in the file
    // (legacy fat-layer fields) is ignored at read.
    const content: LayerContent = {
      cells: parsed.cells ?? [],
      hidden: parsed.hidden ?? [],
    }

    // Warm the resource cache so other resolvers stay hot.
    if (blob && store?.putResource) {
      try { await store.putResource(blob) } catch { /* best-effort */ }
    }

    return content
  }

  /**
   * One-time bag-pollution cleanup. The pre-refactor history-recorder
   * dual-emitted delta records into the bag root (sig-named files
   * with non-layer content) and numeric markers (legacy ops + DCP-
   * style markers). Both shapes live alongside legitimate layer
   * snapshots and would surface as fake rows in listLayers.
   *
   * Sniffing is the price of cleaning a polluted disk. Going forward,
   * the recorder no longer writes records into hypercomb.io bags, so
   * subsequent runs of this pass find nothing to do — the bag stays
   * well-formed and listLayers can keep its mechanical "filename
   * shape IS the type" rule.
   *
   * What gets removed:
   *   - 64-hex sig file whose content is NOT a v2 layer JSON
   *   - 8-digit numeric file (legacy op or DCP marker — doesn't
   *     belong in a hypercomb.io bag)
   *
   * Files whose names don't match either shape are left alone for
   * manual triage.
   */
  /**
   * Normalize a bag on every read: keep canonical markers ONLY, drop
   * everything else.
   *
   * Canonical = NNNN file with content that's exactly a 64-hex sig.
   * Anything else (legacy sig-named bag entries, JSON pointer markers,
   * direct-content markers, op logs, oddly-named files) is removed.
   * No migration — pre-canonical bags lose their history.
   *
   * Acceptable trade-off (per the explicit "old users lose history,
   * we have no users really" call): the renderer falls through to live
   * disk when a bag has no markers, so tiles still display; only the
   * undo/redo timeline is reset. New events going forward mint
   * canonical markers and the timeline rebuilds from there.
   *
   * Idempotent: a clean bag is unchanged.
   */
  readonly #quarantineNonLayerFiles = async (
    locationSig: string,
  ): Promise<void> => {
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
    } catch { return }

    const drop: string[] = []
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue

      // Canonical marker: NNNN name + sig content. Anything else dies.
      if (HistoryService.#MARKER_RE.test(name)) {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const text = (await file.text()).trim()
          if (HistoryService.#SIG_RE.test(text)) continue   // canonical, keep
        } catch { /* unreadable — drop */ }
      }
      drop.push(name)
    }

    for (const name of drop) {
      try { await bag.removeEntry(name) } catch { /* already gone */ }
    }
  }

  // -------------------------------------------------
  // marker promotion / delete / merge
  // -------------------------------------------------
  //
  // Direct CRUD on markers — append, delete. Sig content files are
  // touched only by commitLayer (writes a new sig file when content
  // is novel). promoteToHead appends a fresh marker pointing at the
  // existing sig (no content rewrite). removeEntries deletes markers,
  // not sig files (orphan sig files can be GC'd later).
  //
  //   promoteToHead(sig)        → append a new marker pointing at sig.
  //                                Result: that sig appears at head
  //                                without re-writing the content file.
  //
  //   removeEntries(markers[])  → bag.removeEntry(markerName) per item.
  //
  //   mergeEntries(markers[])   → take newest selected marker's sig,
  //                                promote to head, delete the rest.

  /**
   * Bring a layer sig back to head by appending a fresh marker that
   * points at it. The sig content file is NOT touched — its mtime
   * stays put, no Blob handles invalidated. Markers, not content,
   * carry the per-event timeline.
   */
  public readonly promoteToHead = async (
    locationSig: string,
    layerSig: string,
  ): Promise<string | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null
    const bag = await this.getBag(locationSig)

    // Sanity: the sig file should exist in the bag (or be hydrate-able
    // from the Store). If neither, the marker would be a dead pointer.
    let sigExists = true
    try { await bag.getFileHandle(layerSig, { create: false }) } catch { sigExists = false }
    if (!sigExists) {
      const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = store ? await store.getResource(layerSig).catch(() => null) : null
      if (!blob) return null
      // Materialise the sig file in the bag so the marker resolves.
      const bytes = await blob.arrayBuffer()
      const handle = await bag.getFileHandle(layerSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    }

    const markerName = await this.#nextMarkerName(bag)
    const markerHandle = await bag.getFileHandle(markerName, { create: true })
    const markerWritable = await markerHandle.createWritable()
    try { await markerWritable.write(layerSig) } finally { await markerWritable.close() }
    return layerSig
  }

  /**
   * Direct delete of marker files. Sig content files are NOT deleted
   * here (a sig may still be referenced by other markers); orphan-sig
   * GC is a separate sweep if/when needed.
   */
  public readonly removeEntries = async (
    locationSig: string,
    filenames: string[],
  ): Promise<number> => {
    if (filenames.length === 0) return 0
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
    } catch { return 0 }

    let removed = 0
    for (const filename of filenames) {
      try {
        await bag.removeEntry(filename)
        removed++
      } catch { /* already gone */ }
    }
    return removed
  }

  /**
   * Multi-select "merge into head". Pick the newest selected marker's
   * sig, promote it (append a fresh marker), then delete every other
   * selected marker. Net effect: one new marker at head, the merged-
   * source markers are gone from the active list.
   */
  public readonly mergeEntries = async (
    locationSig: string,
    filenames: string[],
  ): Promise<string | null> => {
    if (filenames.length === 0) return null
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
    } catch { return null }

    let newestMarker: string | null = null
    let newestSig: string | null = null
    for (const filename of filenames) {
      if (!HistoryService.#MARKER_RE.test(filename)) continue
      try {
        const handle = await bag.getFileHandle(filename, { create: false })
        const file = await handle.getFile()
        if (newestMarker === null || filename.localeCompare(newestMarker) > 0) {
          newestMarker = filename
          newestSig = (await file.text()).trim()
        }
      } catch { /* skip missing */ }
    }
    if (!newestSig) return null

    const promoted = await this.promoteToHead(locationSig, newestSig)
    if (!promoted) return null
    await this.removeEntries(locationSig, filenames.filter(f => f !== newestMarker))
    return promoted
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
   * Canonicalise the record, sign it, write the raw bytes into the
   * same history bag as `{sig}`, and append a numeric marker at the
   * bag root whose content is that sig. Everything lives in one
   * folder per location so publishing maps to "share this bag" —
   * tar up `__history__/{locSig}/` and the peer gets the markers
   * and the layer content they reference as one self-contained unit.
   * Returns the record-sig, or null if the Store isn't available.
   */
  public readonly writeRecord = async (
    locationSig: string,
    record: DeltaRecord,
  ): Promise<string | null> => {
    const canonical = canonicalise(record)
    const bytes = new TextEncoder().encode(canonical)
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    const bag = await this.getBag(locationSig)

    // Layer content at __history__/{locSig}/{sig}. Content-addressed,
    // immutable — skip the rewrite if the file already exists so live
    // Blob handles elsewhere can't be invalidated.
    let exists = true
    try { await bag.getFileHandle(sig) } catch { exists = false }
    if (!exists) {
      const handle = await bag.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    }

    // Numeric marker at the same bag root. Readers discriminate
    // marker vs record vs legacy-op by filename shape (numeric vs
    // 64-hex sig vs numeric-JSON legacy), not by subfolder.
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
   * Load + parse the DeltaRecord at the given signature. Records now
   * live inside each history bag (`__history__/{locSig}/{sig}`), so
   * resolution is scoped to the bag — callers pass the locationSig
   * along with the record sig. Returns null on missing or malformed
   * content.
   */
  public readonly resolveDeltaRecord = async (
    locationSig: string,
    sig: string,
  ): Promise<DeltaRecord | null> => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
      const handle = await bag.getFileHandle(sig, { create: false })
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

  /**
   * Resolve every marker at this location, fold the records into a
   * HydratedState. Optional `upTo` slices the chain — used by the
   * cursor to preview past positions without mutating live state.
   * Empty chain (or `upTo = 0`) returns the identity state — this is
   * the synthetic-seed render path: before any real entry, the grid
   * is empty. No disk writes, no timestamp invention — a pure fold.
   */
  public readonly hydratedStateAt = async (
    locationSig: string,
    upTo?: number,
  ): Promise<HydratedState> => {
    const markers = await this.listRecordSigs(locationSig)
    const slice = typeof upTo === 'number'
      ? markers.slice(0, Math.max(0, upTo))
      : markers
    const records = await Promise.all(
      slice.map(m => this.resolveDeltaRecord(locationSig, m.sig))
    )
    return reduceRecords(records)
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

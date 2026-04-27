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
 * Canonical layer. Always has a `name` (required, non-empty).
 * `children` is optional — present only when the layer has children.
 * The empty layer at `00000000` is just `{ name }`.
 *
 * Beyond `name` and `children`, the layer carries an OPEN SET of
 * slots contributed by registered subsystems (notes, tags,
 * instructions, future features) via LayerSlotRegistry. Each slot is
 * a single field at the top level of the layer JSON, keyed by the
 * slot's `slot` name. Slots returning undefined at read time are
 * omitted entirely (sparse layer shape — empty fields cost nothing).
 *
 * Marker sig = sha256 of the marker file's bytes. When ANY field
 * changes (children, notes, tags, ...), bytes change, sig changes,
 * cascade propagates to the root. Undo restores the layer's bytes →
 * restores every slot at once.
 *
 * SOURCE OF TRUTH for child names = the child layer's own `name`
 * field. To display children, fetch each child sig's marker file
 * and read its name. To navigate, append the name to the current
 * path → resolve the target lineage sig → open its bag.
 */
export type LayerContent = {
  name: string
  children?: string[]
  /** Open slot bag — registered subsystems contribute fields here.
   *  See LayerSlotRegistry. Reads/writes use bracket access so this
   *  signature doesn't have to enumerate every possible slot. */
  [slot: string]: unknown
}

/** Root's display name. Used when the layer has no path segments. */
export const ROOT_NAME = '/'

/** Empty layer — content of `00000000` minted on bag's first touch.
 *  Only `name`; no `children` field at all. */
export const emptyLayer = (name: string): LayerContent => ({ name })

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

    // The bag's identity = the lineage's ancestry, nothing else.
    //
    // Bag IS the location: you're already there. Domain is a display
    // namespace (not part of identity). Room (space) and secret are
    // mesh-layer concerns — they apply when sharing identity to peers,
    // not when naming the local bag. Including any of those here would
    // mean "the bag for this lineage moves when you switch room or
    // secret," which is wrong: the bag is the data, the data doesn't
    // move because you changed your mesh credentials.
    //
    // Discard `domain` parameter (still extracted for backward-compat
    // of the call surface) — sig is purely path-derived.
    void domain
    const key = explorerSegments.join('/')

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
   *
   * Rules:
   *   - `name` always present, always first.
   *   - `children` second when non-empty; omitted entirely when empty.
   *   - All other slot fields follow, sorted alphabetically by key for
   *     stable byte output regardless of registration / mutation order.
   *   - Slot values are kept as-is (each slot is responsible for its
   *     own internal canonical form — sorted arrays, sorted nested
   *     keys, etc.). Empty arrays / empty objects / undefined are
   *     dropped to keep the sparse-layer invariant.
   */
  static readonly canonicalizeLayer = (layer: LayerContent): LayerContent => {
    const out: LayerContent = { name: layer.name }
    if (layer.children && layer.children.length > 0) out.children = layer.children.slice()
    const slotKeys = Object.keys(layer).filter(k => k !== 'name' && k !== 'children').sort()
    for (const key of slotKeys) {
      const v = layer[key]
      if (v === undefined || v === null) continue
      if (Array.isArray(v) && v.length === 0) continue
      if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
      out[key] = v
    }
    return out
  }

  /**
   * Commit a complete layer snapshot for a lineage.
   *
   * The marker file IS the full layer JSON — no pool indirection on
   * hypercomb. Bag layout:
   *
   *   __history__/{lineageSig}/00000000  ← empty layer (auto-minted on first touch)
   *   __history__/{lineageSig}/00000001  ← first user-event commit
   *   __history__/{lineageSig}/00000002
   *   ...
   *
   * Each file's content is the full layer JSON; sha256(file bytes) is
   * the marker's "sig" (the layer's identity). Parent layers reference
   * each child's current marker sig in their `cells` array — the
   * cascade walk that ancestors do upstream of every commit produces
   * a new marker at every level, so the root lineage's bag's latest
   * marker IS the global merkle root.
   *
   * commitLayer here writes ONE marker for ONE lineage. Cascade is
   * orchestrated by the caller (LayerCommitter): walk leaf → root,
   * call commitLayer at each level with that level's freshly-assembled
   * layer (which references its children's just-committed marker sigs).
   *
   * @returns the new marker's sig (sha256 of the file bytes).
   */
  public readonly commitLayer = async (
    locationSig: string,
    layer: LayerContent,
  ): Promise<string> => {
    const canonical = HistoryService.canonicalizeLayer(layer)
    const json = JSON.stringify(canonical)
    const bytes = new TextEncoder().encode(json)
    const layerSig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    // Dedup: if this sig matches the bag's current latest, the layer
    // is unchanged. Skip the write — no meaningless markers.
    const lastSig = this.#latestSigByLineage.get(locationSig)
    if (lastSig === layerSig) return layerSig

    const bag = await this.getBag(locationSig)
    await this.#ensureEmptyMarker(bag, layer.name)

    const markerName = await this.#nextMarkerName(bag)
    const markerHandle = await bag.getFileHandle(markerName, { create: true })
    const markerWritable = await markerHandle.createWritable()
    try { await markerWritable.write(bytes.buffer as ArrayBuffer) } finally { await markerWritable.close() }

    // Hot-cache the just-written bytes so the cursor's next read does not
    // round-trip OPFS / re-hash — getLayerContent picks it up directly.
    const cacheMap = this.#markerBytesCache.get(locationSig)
      ?? (this.#markerBytesCache.set(locationSig, new Map()), this.#markerBytesCache.get(locationSig)!)
    cacheMap.set(layerSig, bytes.buffer as ArrayBuffer)

    // Preloader cache: map every sig we've touched to its bytes,
    // globally (not per-lineage). Lookup by sig anywhere in the
    // app: instant. Also remember the lineage's CURRENT sig so a
    // resolver can ask "what's the latest sig for /A/B?" without
    // re-reading the bag.
    this.#preloaderCache.set(layerSig, bytes.buffer as ArrayBuffer)
    this.#latestSigByLineage.set(locationSig, layerSig)

    // Push queue is informational — fires for backup but doesn't gate
    // anything. Stub receipts arrive immediately (real DCP transport
    // is forthcoming).
    const pushQueue = get<{ enqueue: (sig: string) => Promise<void> }>('@diamondcoreprocessor.com/PushQueueService')
    if (pushQueue) {
      void pushQueue.enqueue(layerSig).catch(() => { /* best-effort */ })
    }

    return layerSig
  }

  /**
   * Ensure `00000000` exists in the bag with the empty layer for this
   * lineage's name. Bag's first touch always plants this empty marker
   * so undo has a concrete pre-history landing spot and the bag is
   * never empty once visited.
   *
   * The empty marker's sig is also mirrored into the preloader cache
   * so callers that look it up by sig hit warm without re-reading the
   * file.
   */
  readonly #ensureEmptyMarker = async (
    bag: FileSystemDirectoryHandle,
    name: string,
  ): Promise<void> => {
    let exists = true
    try { await bag.getFileHandle('00000000', { create: false }) } catch { exists = false }
    if (exists) return
    const empty = HistoryService.canonicalizeLayer(emptyLayer(name))
    const json = JSON.stringify(empty)
    const bytes = new TextEncoder().encode(json)
    const handle = await bag.getFileHandle('00000000', { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes.buffer as ArrayBuffer) } finally { await writable.close() }
    // Preloader cache: every sig must be addressable. The bytes are
    // now on disk; mirror them in memory so a sig→content lookup
    // anywhere in the app hits without a re-read.
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    this.#preloaderCache.set(sig, bytes.buffer as ArrayBuffer)
  }

  /**
   * Return the sig of the lineage's CURRENT layer bytes.
   *
   * Source of truth: the bag at `__history__/<lineageSig>/`. If it has
   * markers, return the latest marker's content sig. If it's empty (or
   * doesn't exist yet), MATERIALIZE the empty marker `00000000` on
   * disk for this name, then return the sig of those real bytes.
   *
   * No virtual / name-derived sigs. Every sig the cascade hands to a
   * parent is the hash of bytes that physically exist in `__history__`.
   * The only named primitive in the system is `<lineageSig>` itself —
   * the bag directory — and the marker filenames `NNNNNNNN`. Cell
   * names live INSIDE the marker JSON (`{name, children?}`), never as
   * folder names anywhere else.
   */
  public readonly latestMarkerSigFor = async (
    lineageSig: string,
    name: string,
  ): Promise<string> => {
    // Hot path: housekeeping invariant says #latestSigByLineage tracks
    // the bag's current head, kept in sync by commitLayer (and
    // invalidated by removeEntries / mergeEntries / promoteToHead).
    // If we've got an entry, AND its bytes are in the preloader, we
    // already know the answer — no OPFS work.
    const cached = this.#latestSigByLineage.get(lineageSig)
    if (cached && this.#preloaderCache.has(cached)) return cached

    // Ensure a bag exists so we always have a real `00000000` to hash.
    const bag = await this.historyRoot.getDirectoryHandle(lineageSig, { create: true })

    let latestName = ''
    for await (const [entryName, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(entryName)) continue
      if (entryName > latestName) latestName = entryName
    }

    if (!latestName) {
      // Brand-new bag: materialize the empty marker on disk so its
      // sig is the hash of real file bytes, not a virtual computation.
      await this.#ensureEmptyMarker(bag, name)
      latestName = '00000000'
    }

    const handle = await bag.getFileHandle(latestName, { create: false })
    const file = await handle.getFile()
    const bytes = await file.arrayBuffer()
    const sig = await SignatureService.sign(bytes)
    // Mirror the marker bytes into the preloader so subsequent
    // sig→content lookups hit memory, not disk.
    this.#preloaderCache.set(sig, bytes)
    this.#latestSigByLineage.set(lineageSig, sig)
    return sig
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
   * Filename convention at the bag root:
   *   - 8-digit numeric (NNNNNNNN) → marker file
   *
   * The marker file's content IS the full layer JSON. The marker's
   * "sig" is sha256 of its bytes. Anything else in the bag is foreign
   * and gets quarantined.
   */
  static readonly #SIG_RE = /^[a-f0-9]{64}$/
  static readonly #MARKER_RE = /^\d{8}$/

  /**
   * List all marker entries for a lineage's bag, sorted by filename
   * (numeric ascending). The first element is the empty layer
   * (`00000000`); the last element is the current head.
   *
   * `layerSig` for each entry is sha256 of the marker file's bytes —
   * computed at read time from the file content (not stored anywhere).
   * Two markers with identical content have the same `layerSig`; the
   * filenames stay distinct (they're the per-event timeline).
   */
  public readonly listLayers = async (
    locationSig: string,
  ): Promise<Array<LayerEntry & { index: number; filename: string }>> => {
    // SKIP non-canonical entries; do NOT delete them. Auto-delete on
    // every read is destructive and not user-driven — a single bad
    // detection rule could erase real markers and lose history. To
    // explicitly purge non-canonical files, the user can run /compact
    // which calls #quarantineNonLayerFiles via a dedicated path.
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
    } catch {
      return []
    }

    const cacheMap = this.#markerBytesCache.get(locationSig)
      ?? (this.#markerBytesCache.set(locationSig, new Map()), this.#markerBytesCache.get(locationSig)!)

    const markers: Array<LayerEntry & { filename: string }> = []
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const bytes = await file.arrayBuffer()
        // Read-time filter: only include canonical merkle markers
        // (JSON object with children[]). Pre-merkle bare-sig markers
        // and op-JSON entries are skipped from the active list but
        // are NOT deleted — the file stays on disk until the user
        // explicitly compacts.
        const text = new TextDecoder().decode(bytes)
        const trimmed = text.trim()
        if (HistoryService.#SIG_RE.test(trimmed)) continue   // legacy bare-sig marker
        try {
          const parsed = JSON.parse(text)
          // Canonical layer: must have a non-empty name. children is
          // optional (empty-layer shape `{name}` is valid).
          if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || parsed.name.length === 0) continue
        } catch { continue }
        const layerSig = await SignatureService.sign(bytes)
        cacheMap.set(layerSig, bytes)
        // Mechanical: every marker we read warms the preloader cache.
        this.#preloaderCache.set(layerSig, bytes)
        markers.push({ layerSig, at: file.lastModified, filename: name })
      } catch { /* skip unreadable */ }
    }
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
   * Read a layer's content directly from the lineage's bag.
   *
   * On hypercomb the marker file IS the full layer JSON — no pool
   * indirection. Each NNNN marker in the bag holds one full
   * `LayerContent`; its sha256 is the marker's "sig" (its merkle
   * identity).
   *
   * To resolve `layerSig` → content, we walk the bag's markers,
   * hash each, and return the matching one. Bags are small (one
   * marker per user event for that lineage) so the scan is cheap.
   * For repeated reads we cache (lineageSig, layerSig) → bytes
   * via `#markerBytesCache`.
   */
  public readonly getLayerContent = async (
    locationSig: string,
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null

    // 1. Hot cache — populated by listLayers and previous getLayerContent calls
    const cache = this.#markerBytesCache.get(locationSig)
    let bytes: ArrayBuffer | undefined = cache?.get(layerSig)

    // 2. Cold scan — walk markers, hash, match
    if (!bytes) {
      let bag: FileSystemDirectoryHandle
      try {
        bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false })
      } catch { return null }

      const cacheMap = this.#markerBytesCache.get(locationSig)
        ?? (this.#markerBytesCache.set(locationSig, new Map()), this.#markerBytesCache.get(locationSig)!)

      for await (const [name, handle] of (bag as any).entries()) {
        if (handle.kind !== 'file') continue
        if (!HistoryService.#MARKER_RE.test(name)) continue
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const fileBytes = await file.arrayBuffer()
          const sig = await SignatureService.sign(fileBytes)
          cacheMap.set(sig, fileBytes)
          if (sig === layerSig) { bytes = fileBytes; break }
        } catch { /* skip unreadable */ }
      }
    }

    if (!bytes) return null

    let parsed: Partial<LayerContent>
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LayerContent> }
    catch { return null }

    // name is required; children is optional (omitted when empty).
    if (!parsed.name) return null
    const out: LayerContent = { name: parsed.name }
    if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children
    return out
  }

  // (lineageSig → layerSig → bytes) cache, populated by listLayers
  // and getLayerContent. Keeps undo/redo navigation off OPFS for
  // markers we've already touched in this session.
  readonly #markerBytesCache = new Map<string, Map<string, ArrayBuffer>>()

  /**
   * Preloader cache: every layer sig the system has minted, mapped
   * to its bytes. Populated by:
   *   - commitLayer (every cascade step writes here)
   *   - #ensureEmptyMarker (every freshly-minted 00000000 layer)
   *   - listLayers (every marker we read while walking a bag)
   * Lookup is O(1) by sig anywhere in the app — the renderer's
   * resolver, the cursor, anything that has a sig.
   */
  readonly #preloaderCache = new Map<string, ArrayBuffer>()

  /**
   * Per-lineage current-sig cache. Updated on every commit so
   * "what's the latest sig for /A/B?" doesn't have to re-walk the bag.
   */
  readonly #latestSigByLineage = new Map<string, string>()

  /**
   * Reverse index: marker sig → the lineage bag it lives in. Lets the
   * depth-bounded preload jump from a child-sig in a parent layer to
   * the child's bag in O(1) without enumerating bags. Populated by
   * every bag walk (#warmBag, listLayers cache fill, getLayerContent
   * cold-scan, commitLayer, latestMarkerSigFor).
   */
  readonly #lineageBySig = new Map<string, string>()

  /**
   * Per-bag "fully warm" flag. Set when #warmBag has read every
   * marker file in the bag and populated #preloaderCache + reverse
   * map for each. Cleared on any destructive op (removeEntries,
   * promoteToHead). commitLayer keeps the flag set because it appends
   * one new marker whose sig+bytes it caches incrementally.
   */
  readonly #bagFullyCached = new Set<string>()

  /**
   * Preloader depth — how many levels of children to keep warm
   * outward from the current lineage. Configurable so callers can
   * trade memory for hit-rate. The cache itself is unbounded; depth
   * only bounds how aggressively we PROACTIVELY walk new bags.
   */
  public preloaderDepth = 3

  /**
   * Preloader API: get a layer's parsed content by its sig, from
   * anywhere. Cache hit is O(1); cache miss falls back to a bag scan
   * (which then preloads the bag for future hits).
   */
  public readonly getLayerBySig = async (
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null
    const cached = this.#preloaderCache.get(layerSig)
    if (cached) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(cached)) as Partial<LayerContent>
        if (!parsed.name) return null
        const out: LayerContent = { name: parsed.name }
        if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children
        return out
      } catch { /* fall through to disk */ }
    }
    // Cold miss: trigger the global preload (idempotent — runs once per
    // session) so this and every future getLayerBySig hits the cache.
    await this.preloadAllBags()
    const refreshed = this.#preloaderCache.get(layerSig)
    if (!refreshed) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(refreshed)) as Partial<LayerContent>
      if (!parsed.name) return null
      const out: LayerContent = { name: parsed.name }
      if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children
      return out
    } catch { return null }
  }

  /**
   * One-shot session preload: walk every bag in `__history__/`, hash
   * every NNNNNNNN marker, populate `#preloaderCache` and
   * `#latestSigByLineage`. After this runs, every sig anywhere in any
   * layer is resolvable in O(1) from the preloader — no cold walks
   * during render.
   *
   * Idempotent and cheap on subsequent calls (the in-flight promise is
   * shared, completed runs short-circuit).
   *
   * Housekeeping invariant:
   *   - For every lineage encountered, `#latestSigByLineage[lineageSig]`
   *     = sig of the bag's last NNNNNNNN.
   *   - For every marker hashed, `#preloaderCache[sig]` = its bytes.
   * commitLayer / latestMarkerSigFor / removeEntries / promoteToHead /
   * mergeEntries all maintain those invariants from the moment this
   * preload finishes.
   */
  #preloadAllBagsPromise: Promise<void> | null = null
  public readonly preloadAllBags = async (): Promise<void> => {
    if (this.#preloadAllBagsPromise) return this.#preloadAllBagsPromise
    this.#preloadAllBagsPromise = (async () => {
      const root = this.historyRoot
      for await (const [lineageSig, dirHandle] of (root as any).entries()) {
        if (dirHandle.kind !== 'directory') continue
        if (!HistoryService.#SIG_RE.test(lineageSig)) continue
        const bag = dirHandle as FileSystemDirectoryHandle
        let latestName = ''
        let latestSig = ''
        for await (const [name, fileHandle] of (bag as any).entries()) {
          if (fileHandle.kind !== 'file') continue
          if (!HistoryService.#MARKER_RE.test(name)) continue
          try {
            const file = await (fileHandle as FileSystemFileHandle).getFile()
            const bytes = await file.arrayBuffer()
            const sig = await SignatureService.sign(bytes)
            this.#preloaderCache.set(sig, bytes)
            if (name > latestName) { latestName = name; latestSig = sig }
          } catch { /* skip unreadable */ }
        }
        if (latestSig) this.#latestSigByLineage.set(lineageSig, latestSig)
      }
    })()
    return this.#preloadAllBagsPromise
  }

  /**
   * Per-lineage refresh: invalidate the cached latest for one lineage
   * and re-read its bag. Use after destructive ops on that lineage
   * (already invoked automatically by removeEntries/promoteToHead/
   * mergeEntries, but exposed for callers that mutate a bag directly).
   */
  public readonly refreshLineageCache = async (lineageSig: string): Promise<void> => {
    this.#latestSigByLineage.delete(lineageSig)
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.historyRoot.getDirectoryHandle(lineageSig, { create: false })
    } catch { return }
    let latestName = ''
    let latestSig = ''
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const bytes = await file.arrayBuffer()
        const sig = await SignatureService.sign(bytes)
        this.#preloaderCache.set(sig, bytes)
        if (name > latestName) { latestName = name; latestSig = sig }
      } catch { /* skip */ }
    }
    if (latestSig) this.#latestSigByLineage.set(lineageSig, latestSig)
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
   * Purge non-canonical files from a bag.
   *
   * Canonical = NNNN file whose content is a JSON object with at least
   * the slim-layer fields (`children` array). Pre-merkle bags (containing
   * legacy sig-named pool pointers, op-JSON entries, etc.) are dropped.
   *
   * USER-DRIVEN ONLY. listLayers no longer calls this — silently
   * deleting markers from a passive read path is destructive (a single
   * detection bug could erase real history). The only call site is
   * /compact, which the user invokes deliberately.
   *
   * Idempotent: a clean bag is unchanged.
   */
  public readonly purgeNonLayerFiles = async (
    locationSig: string,
  ): Promise<void> => this.#quarantineNonLayerFiles(locationSig)

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

      // Canonical marker: NNNN name + JSON-with-name content.
      if (HistoryService.#MARKER_RE.test(name)) {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const text = (await file.text()).trim()
          // Bare-sig content is the pre-merkle marker shape; drop it.
          if (HistoryService.#SIG_RE.test(text)) { drop.push(name); continue }
          // Layer-JSON content — keep if it parses to an object with a
          // non-empty `name`. children is optional (empty-layer shape `{name}`).
          try {
            const parsed = JSON.parse(text)
            if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.name.length > 0) continue
          } catch { /* unparseable — drop */ }
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
    // Housekeeping: head changed. Invalidate the lineage's cached
    // latest sig — the next read repopulates from disk.
    this.#latestSigByLineage.delete(locationSig)
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
    // Housekeeping: head MAY have changed (we don't bother checking
    // whether one of the deleted files was the head). Cheap to drop
    // the cached entry; next read repopulates from the bag's actual
    // last NNNNNNNN.
    if (removed > 0) this.#latestSigByLineage.delete(locationSig)
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
   * the synthetic-empty render path: before any real entry, the grid
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

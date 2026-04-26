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
 * Canonical minimal layer. Only two fields:
 *
 *   name      — this layer's name (e.g. "" at root, "abc" at /abc).
 *   children  — ordered child layer sigs. Each sig points to a child
 *               layer; to get a child's display name, load the layer
 *               at that sig and read its own `name`.
 *
 * Marker sig = sha256 of the marker file's bytes. Parent layer's
 * `children` array carries each child's current marker sig — when a
 * child commits a new marker, its sig changes, parent's children
 * array changes, parent's bytes change, parent's sig changes. The
 * cascade propagates that all the way up to the root lineage's bag,
 * where the latest marker IS the current global merkle root.
 *
 * SOURCE OF TRUTH for child names = the child layer's `name` field,
 * not anything stored at the parent. To display children, fetch each
 * child sig's marker file and read its name. To navigate, append the
 * name to the current path → resolve the target lineage sig → open
 * its bag.
 */
export type LayerContent = {
  name: string
  children: string[]
}

/** Empty seed — content of `00000000` minted on bag's first touch. */
export const emptyLayer = (name: string): LayerContent => ({ name, children: [] })

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
   * `children` keeps its caller-supplied order (position is meaningful).
   */
  static readonly canonicalizeLayer = (layer: LayerContent): LayerContent => ({
    name: layer.name,
    children: layer.children.slice(),
  })

  /**
   * Commit a complete layer snapshot for a lineage.
   *
   * The marker file IS the full layer JSON — no pool indirection on
   * hypercomb. Bag layout:
   *
   *   __history__/{lineageSig}/00000000  ← empty seed (auto-minted on first touch)
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

    const bag = await this.getBag(locationSig)
    await this.#ensureSeed(bag, layer.name)

    const markerName = await this.#nextMarkerName(bag)
    const markerHandle = await bag.getFileHandle(markerName, { create: true })
    const markerWritable = await markerHandle.createWritable()
    try { await markerWritable.write(bytes.buffer as ArrayBuffer) } finally { await markerWritable.close() }

    // Hot-cache the just-written bytes so the cursor's next read does not
    // round-trip OPFS / re-hash — getLayerContent picks it up directly.
    const cacheMap = this.#markerBytesCache.get(locationSig)
      ?? (this.#markerBytesCache.set(locationSig, new Map()), this.#markerBytesCache.get(locationSig)!)
    cacheMap.set(layerSig, bytes.buffer as ArrayBuffer)

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
   * Ensure `00000000` exists in the bag with the empty seed for this
   * lineage's name. Bag's first touch always plants this seed so undo
   * has a concrete pre-history landing spot and the bag is never empty
   * once visited.
   *
   * The seed sig is also cached so callers that look it up by sig
   * (e.g., `latestMarkerSigFor` for a freshly-visited child) hit
   * warm without an extra OPFS round-trip.
   */
  readonly #ensureSeed = async (
    bag: FileSystemDirectoryHandle,
    name: string,
  ): Promise<void> => {
    let exists = true
    try { await bag.getFileHandle('00000000', { create: false }) } catch { exists = false }
    if (exists) return
    const seed = HistoryService.canonicalizeLayer(emptyLayer(name))
    const seedJson = JSON.stringify(seed)
    const seedBytes = new TextEncoder().encode(seedJson)
    const handle = await bag.getFileHandle('00000000', { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(seedBytes.buffer as ArrayBuffer) } finally { await writable.close() }
  }

  /**
   * Read the latest marker file from a lineage's bag and compute its
   * sig (sha256 of its bytes). Used by the cascade: an ancestor
   * commit needs each child's CURRENT marker sig to populate its
   * own `cells` array.
   *
   * If the bag doesn't exist or is empty, returns the sig of the
   * empty seed for that name (so children that haven't been visited
   * yet still have a deterministic placeholder sig).
   */
  public readonly latestMarkerSigFor = async (
    lineageSig: string,
    name: string,
  ): Promise<string> => {
    let bag: FileSystemDirectoryHandle | null = null
    try {
      bag = await this.historyRoot.getDirectoryHandle(lineageSig, { create: false })
    } catch { /* no bag */ }

    if (bag) {
      // Find latest NNNN marker
      let latestName = ''
      for await (const [n, h] of (bag as any).entries()) {
        if (h.kind !== 'file') continue
        if (!HistoryService.#MARKER_RE.test(n)) continue
        if (n > latestName) latestName = n
      }
      if (latestName) {
        try {
          const handle = await bag.getFileHandle(latestName, { create: false })
          const file = await handle.getFile()
          const bytes = await file.arrayBuffer()
          return await SignatureService.sign(bytes)
        } catch { /* fall through to empty seed */ }
      }
    }

    // Default: empty seed sig for this name
    const seed = HistoryService.canonicalizeLayer(emptyLayer(name))
    const seedBytes = new TextEncoder().encode(JSON.stringify(seed))
    return await SignatureService.sign(seedBytes.buffer as ArrayBuffer)
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
   * (numeric ascending). The first element is the empty seed
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
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.children)) continue
        } catch { continue }
        const layerSig = await SignatureService.sign(bytes)
        cacheMap.set(layerSig, bytes)
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

    return {
      name: parsed.name ?? '',
      children: parsed.children ?? [],
    }
  }

  // (lineageSig → layerSig → bytes) cache, populated by listLayers
  // and getLayerContent. Keeps undo/redo navigation off OPFS for
  // markers we've already touched in this session.
  readonly #markerBytesCache = new Map<string, Map<string, ArrayBuffer>>()

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

      // Canonical marker: NNNN name + JSON-with-children[] content.
      if (HistoryService.#MARKER_RE.test(name)) {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const text = (await file.text()).trim()
          // Bare-sig content is the pre-merkle marker shape; drop it.
          if (HistoryService.#SIG_RE.test(text)) { drop.push(name); continue }
          // Layer-JSON content — keep if it parses to an object with a
          // `children` array.
          try {
            const parsed = JSON.parse(text)
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.children)) continue
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

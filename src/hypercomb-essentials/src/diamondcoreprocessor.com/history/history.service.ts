// diamondcoreprocessor.com/core/history.service.ts
import { EffectBus, SignatureService, SignatureStore } from '@hypercomb/core'
import { lineageKey, rawLineageKey } from './lineage-key.js'
import { canonicalise, parse as parseRecord, type DeltaRecord } from './delta-record.js'
import { reduce as reduceRecords, type HydratedState } from './delta-reducer.js'
export type { DeltaRecord } from './delta-record.js'
export type { HydratedState } from './delta-reducer.js'

export type HistoryOpType =
  // Cell lifecycle
  | 'add'
  | 'remove'
  | 'reorder'
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

// SHA-256 of canonical JSON: {"bees":[],"dependencies":[],"layers":[],"resources":[]}
export const EMPTY_LAYER_STATE_SIG = '892748ce914b902feb21d612f4652cc231b4455786683b23f9d82304ce061be1'
export const EMPTY_LAYER_STATE: Readonly<LayerState> = Object.freeze({ bees: [], layers: [], dependencies: [], resources: [] })

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
 * Layer sig = sha256 of the canonical layer bytes (the pooled JSON).
 * When ANY field changes (children, notes, tags, ...), bytes change,
 * sig changes, cascade propagates to the root. Undo restores the
 * layer's bytes → restores every slot at once. (The history marker is
 * a separate pointer record `{"layer":"<sig>"}` — see commitLayer.)
 *
 * SOURCE OF TRUTH for child names = the child layer's own `name`
 * field. To display children, fetch each child sig's layer from the
 * pool and read its name. To navigate, append the name to the current
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

// SHA-256 of canonical JSON: {"children":[],"name":""}
export const EMPTY_LAYER_CONTENT_SIG = 'a8a9aaacd1d7631b9d1b66a6b0e4b14fdd2f1052ffd5dfac2e92c0740020ee8d'
export const EMPTY_LAYER_CONTENT: Readonly<LayerContent> = Object.freeze({ name: '', children: [] })

/** Root's display name. Used when the layer has no path segments. */
export const ROOT_NAME = '/'

/** Empty layer — content of `00000000` minted on bag's first touch.
 *  Only `name`; no `children` field at all. */
export const emptyLayer = (name: string): LayerContent => ({ name })

/**
 * One history entry. Just a pointer to a layer resource plus the timestamp
 * at which this entry was appended. Entries are the `NNNNNNNN` marker files
 * inside the lineage's sigbag (`<root>/<lineageSig>/`). Filenames carry no
 * semantic meaning beyond ordering — the max marker is the current head.
 */
export type LayerEntry = {
  layerSig: string
  at: number
}

/**
 * Marker file shape. A marker at `<root>/<lineageSig>/<NNNNNNNN>` (the
 * lineage sigbag at the OPFS root; legacy `__history__`/`__hive__`/
 * `hypercomb.io` bags are read-fallback drain sources) is a small JSON
 * record naming WHICH layer this revision points at, plus (optionally)
 * any supporting-data sigs attached to the same revision.
 *
 * Legacy markers contain the full layer JSON directly (the bytes
 * themselves were the layer). Readers detect this by parsing: if the
 * parsed object has a `.layer` field that looks like a sig, treat as
 * pointer record. Otherwise treat as legacy layer bytes (and hash the
 * bytes to derive the layer sig).
 */
export type MarkerRecord = {
  /** Sig of the layer bytes for this revision. Resolves through
   *  `store.getLayerBytes(sig)` to the canonical layer JSON. */
  layer: string
  /** Optional named supporting-data sig fields — decorations, context,
   *  receipts, future kinds. Each resolves through the appropriate pool.
   *  Versioning + undo + share-ability come automatically because the
   *  marker IS the revision. */
  [field: string]: unknown
}

const SIG_RE = /^[0-9a-f]{64}$/i

/**
 * Extract the layer sig from a marker file's bytes. Handles both:
 *   1. Pointer records — JSON `{ "layer": "<sig>", ... }` — modern shape.
 *   2. Legacy layer bytes — the full layer JSON. Sig = hash(bytes).
 *
 * Returns `{ layerSig, isPointer, record? }`. `isPointer === false` means
 * the bytes ARE the layer (legacy); caller can opportunistically migrate
 * by writing those bytes to the layer pool.
 */
export async function extractLayerSigFromMarker(
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ layerSig: string; isPointer: boolean; record?: MarkerRecord }> {
  const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : bytes
  // Try parse as pointer record first.
  try {
    const text = new TextDecoder().decode(buf)
    const trimmed = text.trim()
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed)
      const layerField = parsed?.layer
      if (typeof layerField === 'string' && SIG_RE.test(layerField)) {
        // Pointer-record shape. Also has `name` somewhere? No — `name`
        // belongs on the LAYER (which lives in the pool), not on the
        // marker. The marker only carries sigs into pools.
        // The presence of `.name` on a parsed marker means it's a legacy
        // layer JSON, not a pointer record. Distinguish by `.layer` field.
        return { layerSig: layerField, isPointer: true, record: parsed as MarkerRecord }
      }
    }
  } catch { /* fall through to legacy hash */ }
  // Legacy bytes — hash them to derive the layer sig.
  const sig = await SignatureService.sign(buf)
  return { layerSig: sig, isPointer: false }
}

export class HistoryService {

  // In-memory cache of full replay per signature. Keeps navigation instant —
  // history is the same until the next record()/updateLayer() append.
  readonly #replayCache = new Map<string, HistoryOp[]>()

  constructor() {
    // Warm-start. Restore the persisted per-lineage head index BEFORE the
    // first paint so currentLayerAt resolves heads from cache instead of
    // enumerating every history bag (the multi-second preloadAllBags
    // rebuild — measured 13.6s over 603 bags / 8006 markers). The full
    // scan still runs, but demoted to an idle reconciliation tail that
    // refreshes + re-persists the index. See #restoreHeadIndex /
    // #scheduleHeadPersist.
    this.#restoreHeadIndex()
    try {
      // Flush the latest head snapshot when the tab is hidden/closed so the
      // next boot starts warm even if the debounce timer hadn't fired.
      window.addEventListener('pagehide', this.#flushHeadIndex)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.#flushHeadIndex()
      })
    } catch { /* non-DOM context — head persistence is a main-thread-only optimization */ }
    // SELF-CLEANING: when the legacy `__history__` pool (or a per-bag
    // `__temporary__` archive) still exists, drain it into the signed
    // locations and remove the orphaned dirs — automatically. Detached
    // and delayed so it never competes with first paint or the warmup
    // walk; `/consolidate-history` remains as a manual force-run of the
    // same pass. Idempotent and resumable — a partial pass finishes on
    // a later boot.
    setTimeout(() => { void this.#selfCleanLegacy() }, HistoryService.#SELF_CLEAN_DELAY_MS)
  }

  /** How long after construction the history self-clean waits — clear of
   *  first paint and the warmup walk. Slightly later than Store's content
   *  self-clean (20s) so the two drains don't contend for single-threaded
   *  OPFS. */
  static readonly #SELF_CLEAN_DELAY_MS = 30_000

  /** Detached drain pass: waits for Store, then (1) relocates + retires
   *  the legacy `__history__` pool via gcLegacyHistory, and (2) absorbs
   *  any per-bag `__temporary__` archives at the root into the
   *  sign('temporary') pool. Best-effort — never throws, never blocks a
   *  render; removal is gated on confirmed copies throughout. */
  readonly #selfCleanLegacy = async (): Promise<void> => {
    try {
      const store = get<{
        initialize?: () => Promise<void>
        hypercombRoot?: FileSystemDirectoryHandle
        history?: FileSystemDirectoryHandle
      }>('@hypercomb.social/Store')
      await store?.initialize?.()
      if (!store?.hypercombRoot) return  // OPFS unavailable — a later boot retries
      if (store.history) await this.gcLegacyHistory()
      await this.#absorbRootBagArchives()
    } catch { /* best-effort — resumed on a later boot */ }
  }

  /** Legacy `__history__` drain source (opened WITHOUT create by Store),
   *  or undefined once drained / for a fresh participant. Reads union it
   *  in via bag promotion; the self-cleaning drain (`gcLegacyHistory`)
   *  retires it. */
  private get historyRoot(): FileSystemDirectoryHandle | undefined {
    const store = get<{ history?: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    return store?.history
  }

  /** The user-content root — `store.hypercombRoot`, which IS the OPFS
   *  root. Lineage sigbags (`<lineageSig>/` of `NNNNNNNN` markers, max
   *  marker = current) live here as sig-named DIRS beside content sig
   *  FILES and sign(meaning) pool dirs; a lineage sig and a content sig
   *  never collide (different preimages). Every NEW bag and marker
   *  writes here — never to a legacy dir. */
  private get hiveRoot(): FileSystemDirectoryHandle {
    const store = get<{ hypercombRoot: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    return store!.hypercombRoot
  }

  /** Legacy bag sources, all optional (Store opens them WITHOUT create,
   *  so a drained dir stays gone): `__hive__/` (the brief-lived root
   *  rename), `hypercomb.io/` (pre-`__hive__`), `__history__/` (Phase-1).
   *  Store's content relocation drains the first two; `gcLegacyHistory`
   *  owns the third. Until every one is gone, reads UNION them. */
  readonly #legacyBagSources = (): (FileSystemDirectoryHandle | undefined)[] => {
    const store = get<{
      legacyHive?: FileSystemDirectoryHandle
      legacyHypercombIo?: FileSystemDirectoryHandle
      history?: FileSystemDirectoryHandle
    }>('@hypercomb.social/Store')
    return [store?.legacyHive, store?.legacyHypercombIo, store?.history]
  }

  /** Lineages whose root bag is confirmed union-complete for this session
   *  (every legacy copy merged in, or no legacy copy exists). */
  readonly #promotedBags = new Set<string>()
  readonly #promotePending = new Map<string, Promise<void>>()

  /** canonical lineage sig → OLD raw-key sig, populated by `sign` only when
   *  canonicalization changed the key. #promoteBag unions the old bag (a
   *  punctuation-named tile's pre-canonicalization history) into the new
   *  canonical bag. Empty for the common clean-name case. */
  readonly #rawAlias = new Map<string, string>()

  /** UNION-promote one lineage's bag to the root: copy every marker /
   *  record file that any legacy source (`__hive__`, `hypercomb.io/`,
   *  `__history__`) holds and the root bag lacks. The HIGHEST marker
   *  across sources wins by construction — the union only ADDS missing
   *  filenames, and on a same-name divergence the root's copy is kept
   *  (it is the live era; the content bytes both markers point at live
   *  at the root regardless). First-hit source selection is forbidden:
   *  a stale source must never time-travel the tree backwards. Legacy
   *  `__temporary__` archive subdirs absorb into the sign('temporary')
   *  pool instead of being copied — no underscore dir is ever created.
   *  Memoized per session and a cheap no-op once every legacy source is
   *  drained. */
  readonly #promoteBag = (lineageSig: string): Promise<void> => {
    if (this.#promotedBags.has(lineageSig)) return Promise.resolve()
    const pending = this.#promotePending.get(lineageSig)
    if (pending) return pending
    const promise = (async (): Promise<void> => {
      const store = get<{ hypercombRoot?: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
      // Store not ready — do NOT memoize; the caller's root access throws
      // the same not-ready signal it always did, and a later touch retries.
      if (!store?.hypercombRoot) return
      try {
        const sources: FileSystemDirectoryHandle[] = []
        for (const src of this.#legacyBagSources()) {
          if (!src) continue
          try { sources.push(await src.getDirectoryHandle(lineageSig, { create: false })) } catch { /* not in this source */ }
        }
        // MIGRATION: before canonicalization this lineage's bag was named by
        // its raw-key sig. Union that bag in — from the root AND every legacy
        // source — so a punctuation-named tile keeps its committed history and
        // head layer (highest marker wins, same construction as legacy union).
        // Non-destructive: the raw bag is left in place as a read-drained
        // remnant; a later GC can remove verified copies. Absent for clean
        // names (no alias) — the common path is unchanged.
        const rawSig = this.#rawAlias.get(lineageSig)
        if (rawSig && rawSig !== lineageSig) {
          for (const src of [store.hypercombRoot as FileSystemDirectoryHandle, ...this.#legacyBagSources()]) {
            if (!src) continue
            try { sources.push(await src.getDirectoryHandle(rawSig, { create: false })) } catch { /* raw bag not in this source */ }
          }
        }
        if (sources.length > 0) {
          const root = await store.hypercombRoot.getDirectoryHandle(lineageSig, { create: true })
          for (const src of sources) await this.#copyBagInto(src, root)
        }
        this.#promotedBags.add(lineageSig)
      } catch { /* transient OPFS hiccup — retried on the next touch */ }
    })()
    this.#promotePending.set(lineageSig, promise)
    promise.finally(() => { this.#promotePending.delete(lineageSig) })
    return promise
  }

  /** Resolve a lineage bag for WRITING. The root bag is the ONLY write
   *  destination; the union-promotion runs first so the NNNNNNNN sequence
   *  continues from the highest marker across every source (a fresh root
   *  bag must never restart at 00000001 while deeper markers sit in a
   *  legacy dir). Commits are serialized, so no two writers race the same
   *  bag, and promotion is idempotent. */
  private readonly getBag = async (signature: string): Promise<FileSystemDirectoryHandle> => {
    await this.#promoteBag(signature)
    return await this.hiveRoot.getDirectoryHandle(signature, { create: true })
  }

  /** Resolve a lineage bag for READING. Union-promotes first (see
   *  `#promoteBag`) so the returned ROOT bag holds every marker from every
   *  source — highest marker wins — then opens it WITHOUT create. Throws
   *  (like getDirectoryHandle) when the bag is absent at the root and in
   *  every legacy source, so every existing try/catch read site keeps its
   *  cold-vs-authoritative-absence semantics. */
  private readonly bagForRead = async (lineageSig: string): Promise<FileSystemDirectoryHandle> => {
    await this.#promoteBag(lineageSig)
    return await this.hiveRoot.getDirectoryHandle(lineageSig, { create: false })
  }

  /** Copy one legacy bag's FILES into the root bag, skipping names already
   *  present (union — the root's copy wins on any same-name divergence;
   *  the max marker only grows). A legacy `__temporary__` archive subdir
   *  is absorbed into the sign('temporary') pool — and removed from the
   *  source once fully drained — instead of being copied, so no
   *  underscore dir is ever (re)created. Unknown subdirs are left
   *  untouched; their presence defers the source's GC. Best-effort per
   *  entry, idempotent, safe to re-run. */
  readonly #copyBagInto = async (
    src: FileSystemDirectoryHandle,
    dst: FileSystemDirectoryHandle,
  ): Promise<void> => {
    for await (const [name, handle] of (src as any).entries()) {
      if (handle.kind === 'directory') {
        if (name === HistoryService.#LEGACY_TEMPORARY_DIRECTORY) {
          await this.#absorbTemporaryDir(handle as FileSystemDirectoryHandle, src)
        }
        continue
      }
      try { await dst.getFileHandle(name, { create: false }); continue } catch { /* absent — copy it */ }
      try {
        const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
        const out = await dst.getFileHandle(name, { create: true })
        const w = await out.createWritable()
        try { await w.write(bytes) } finally { await w.close() }
      } catch { /* best-effort per entry */ }
    }
  }

  /** Every lineage bag across the root and every legacy drain source,
   *  keyed by lineage sig and resolved to the ROOT bag — each name is
   *  union-promoted first, so the returned handle holds every marker from
   *  every source (highest marker wins). Only 64-hex DIRECTORIES count:
   *  content sig FILES are skipped, and so are the sign(meaning) POOL
   *  dirs that share the root (their addresses are derivable from the
   *  known meanings — see `#poolSigs`). */
  private readonly enumerateBags = async (): Promise<Map<string, FileSystemDirectoryHandle>> => {
    const pools = await this.#poolSigs()
    const names = new Set<string>()
    const scan = async (root: FileSystemDirectoryHandle | undefined): Promise<void> => {
      if (!root) return
      try {
        for await (const [name, handle] of (root as any).entries()) {
          if (handle.kind !== 'directory') continue
          if (!HistoryService.#SIG_RE.test(name)) continue
          if (pools.has(name)) continue
          names.add(name)
        }
      } catch { /* root unreadable — skip */ }
    }
    await scan(this.hiveRoot)
    for (const src of this.#legacyBagSources()) await scan(src)
    const bags = new Map<string, FileSystemDirectoryHandle>()
    for (const name of names) {
      await this.#promoteBag(name)
      try { bags.set(name, await this.hiveRoot.getDirectoryHandle(name, { create: false })) } catch { /* vanished mid-scan — skip */ }
    }
    return bags
  }

  /** sign(meaning) pool addresses that share the OPFS root with lineage
   *  sigbags. Derived at runtime — sha256 of the UTF-8 meaning bytes,
   *  never hardcoded hex — and excluded from bag enumeration: a pool dir
   *  is not a lineage. The list mirrors the known pool meanings across
   *  subsystems (Store pre-opens the first seven). */
  static readonly #POOL_MEANINGS = [
    'bees', 'dependencies', 'clipboard', 'threads', 'computation',
    'manifests', 'optimization', 'temporary', 'receipts', 'structure',
    'roots', 'patches',
  ] as const
  #poolSigsPromise: Promise<ReadonlySet<string>> | null = null
  readonly #poolSigs = (): Promise<ReadonlySet<string>> => {
    return this.#poolSigsPromise ??= (async () => {
      const sigs = new Set<string>()
      for (const meaning of HistoryService.#POOL_MEANINGS) {
        sigs.add(await SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer))
      }
      return sigs
    })()
  }

  /** SELF-CLEANING drain of the legacy `__history__/` pool — the single
   *  destructive step on NEVER-WIPE history. Union-merges every remaining
   *  legacy bag into its root bag (idempotent; promote-on-touch has
   *  already moved the active ones), then verifies EVERY legacy entry is
   *  shadowed at the root — per FILE, not per directory — before removing
   *  `__history__`. Any unshadowed or unrecognised entry retains the
   *  folder for a later pass. Runs detached + delayed after boot (see the
   *  constructor) and stays manually invocable via `/consolidate-history`
   *  as a force-run. The `__hive__/` and `hypercomb.io/` content roots
   *  drain via Store's relocation, not here — but reads union all four
   *  sources until every one is gone. */
  public readonly gcLegacyHistory = async (): Promise<{ bags: number; copied: number; removed: boolean }> => {
    const legacyRoot = this.historyRoot
    if (!legacyRoot) return { bags: 0, copied: 0, removed: true }  // already drained (or fresh participant)
    let bags = 0
    let copied = 0
    let allShadowed = true
    try {
      for await (const [name, handle] of (legacyRoot as any).entries()) {
        if (handle.kind !== 'directory' || !HistoryService.#SIG_RE.test(name)) {
          // Not a lineage bag — not ours to move; its presence defers removal.
          allShadowed = false
          continue
        }
        bags++
        const rootBag = await this.hiveRoot.getDirectoryHandle(name, { create: true })
        await this.#copyBagInto(handle as FileSystemDirectoryHandle, rootBag)
        // Per-file gate: every legacy entry must be confirmed at the root
        // bag. Directory existence alone is NOT enough — a copy that died
        // mid-bag on an earlier run must not pass the gate.
        if (await HistoryService.#dirShadowed(handle as FileSystemDirectoryHandle, rootBag)) copied++
        else allShadowed = false
      }
    } catch (err) {
      console.warn('[history] gcLegacyHistory: scan/copy failed — legacy __history__ left in place', err)
      return { bags, copied, removed: false }
    }
    if (!allShadowed) {
      console.warn(`[history] gcLegacyHistory: ${copied}/${bags} bags shadowed — legacy __history__ retained for a later pass`)
      return { bags, copied, removed: false }
    }
    const store = get<{ opfsRoot?: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    if (!store?.opfsRoot) return { bags, copied, removed: false }
    try {
      await store.opfsRoot.removeEntry(HistoryService.#LEGACY_HISTORY_DIRECTORY, { recursive: true })
      console.log(`[history] gcLegacyHistory: ${bags} bags shadowed at the root — legacy __history__ removed`)
      return { bags, copied, removed: true }
    } catch (err) {
      console.warn('[history] gcLegacyHistory: removeEntry(__history__) failed — left in place', err)
      return { bags, copied, removed: false }
    }
  }

  /** True when every FILE in `src` exists (by name) in `dst` and `src`
   *  holds no leftover subdirs. The union copy never overwrites, so name
   *  presence is the correct shadow test: a same-named file IS the
   *  surviving era's marker, and the content bytes both point at live at
   *  the root regardless. */
  static readonly #dirShadowed = async (
    src: FileSystemDirectoryHandle,
    dst: FileSystemDirectoryHandle,
  ): Promise<boolean> => {
    try {
      for await (const [name, handle] of (src as any).entries()) {
        if (handle.kind !== 'file') return false  // `__temporary__` straggler or unknown subdir
        try { await dst.getFileHandle(name, { create: false }) } catch { return false }
      }
      return true
    } catch { return false }
  }

  // -------------------------------------------------
  // sign('temporary') pool — soft-deleted marker archive
  // -------------------------------------------------
  //
  // Archived markers are keyed by the layer sig they point at, so
  // identical archived states dedup GLOBALLY (one pool, not one archive
  // per bag). The address is derived by convention — sha256 of the
  // UTF-8 bytes of 'temporary' — so any tier computes it with no
  // registry. The legacy per-bag `__temporary__` subdirs are drain
  // sources: absorbed into this pool and removed by the self-clean.

  static readonly #TEMPORARY_MEANING = 'temporary'
  static readonly #LEGACY_TEMPORARY_DIRECTORY = '__temporary__'
  static readonly #LEGACY_HISTORY_DIRECTORY = '__history__'

  #temporaryPoolPromise: Promise<FileSystemDirectoryHandle | null> | null = null
  readonly #temporaryPool = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (this.#temporaryPoolPromise) {
      const cached = await this.#temporaryPoolPromise
      if (cached) return cached
      this.#temporaryPoolPromise = null  // Store wasn't ready — retry
    }
    this.#temporaryPoolPromise = (async (): Promise<FileSystemDirectoryHandle | null> => {
      const store = get<{
        getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
        hypercombRoot?: FileSystemDirectoryHandle
      }>('@hypercomb.social/Store')
      try {
        if (store?.getPool) return await store.getPool(HistoryService.#TEMPORARY_MEANING)
        // Store without getPool — derive the address by convention.
        if (!store?.hypercombRoot) return null
        const sig = await SignatureService.sign(
          new TextEncoder().encode(HistoryService.#TEMPORARY_MEANING).buffer as ArrayBuffer)
        return await store.hypercombRoot.getDirectoryHandle(sig, { create: true })
      } catch { return null }
    })()
    return this.#temporaryPoolPromise
  }

  /** Drain one legacy `__temporary__` archive dir into the
   *  sign('temporary') pool: copy→remove per record, then a NON-recursive
   *  removeEntry that only succeeds once the dir is empty — a straggler
   *  is never destroyed. Mirrors Store's legacy record-pool absorb. */
  readonly #absorbTemporaryDir = async (
    dir: FileSystemDirectoryHandle,
    parent: FileSystemDirectoryHandle,
  ): Promise<void> => {
    const pool = await this.#temporaryPool()
    if (!pool) return
    try {
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind !== 'file') continue
        try {
          let present = true
          try { await pool.getFileHandle(name, { create: false }) } catch { present = false }
          if (!present) {
            const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
            const out = await pool.getFileHandle(name, { create: true })
            const w = await out.createWritable()
            try { await w.write(bytes) } finally { await w.close() }
          }
          await dir.removeEntry(name)
        } catch { /* straggler — absorbed on a later pass */ }
      }
      await parent.removeEntry(HistoryService.#LEGACY_TEMPORARY_DIRECTORY)
    } catch { /* not yet empty — retried on a later pass */ }
  }

  /** Sweep root lineage bags for legacy `__temporary__` archive subdirs
   *  and absorb each into the sign('temporary') pool. Pool dirs are
   *  excluded via `#poolSigs`; anything unrecognised is untouched. Part
   *  of the detached self-clean — never on a render path. */
  readonly #absorbRootBagArchives = async (): Promise<void> => {
    const root = this.hiveRoot
    if (!root) return
    const pools = await this.#poolSigs()
    try {
      for await (const [name, handle] of (root as any).entries()) {
        if (handle.kind !== 'directory') continue
        if (!HistoryService.#SIG_RE.test(name) || pools.has(name)) continue
        let archive: FileSystemDirectoryHandle
        try {
          archive = await (handle as FileSystemDirectoryHandle)
            .getDirectoryHandle(HistoryService.#LEGACY_TEMPORARY_DIRECTORY, { create: false })
        } catch { continue }
        await this.#absorbTemporaryDir(archive, handle as FileSystemDirectoryHandle)
      }
    } catch { /* root unreadable — a later boot retries */ }
  }

  /**
   * Sign a lineage path to get the history bag signature.
   *
   * The preimage is the CANONICAL lineage key (see lineage-key.ts) — the same
   * helper the swarm mesh sig and ShowCellDrone use, so every site that names
   * this bag agrees byte-for-byte. Canonicalization folds invisible name
   * variation (punctuation, hyphens, en-dashes, NBSPs, doubled spaces) so two
   * paths a human reads as the same place hash to the SAME bag.
   */
  public readonly sign = async (lineage: any): Promise<string> => {
    const domain = String(lineage?.domain?.() ?? 'hypercomb.io')
    const explorerSegmentsRaw = lineage?.explorerSegments?.()

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
    const key = lineageKey(explorerSegmentsRaw)

    // use SignatureStore.signText() for memoization — same lineage = same sig
    const sigStore = get<SignatureStore>('@hypercomb/SignatureStore')
    const sig = sigStore
      ? await sigStore.signText(key)
      : await SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)

    // Migration bridge: if canonicalization CHANGED the key, the tile's
    // pre-canonicalization history lives in the bag under the OLD raw-key sig.
    // Remember that mapping so #promoteBag can union the old bag into this new
    // canonical one (keeping the tile's committed history + head layer). Bounded
    // to punctuation-bearing names and computed once per canonical sig. Clean
    // names (raw === key) set no alias and take the unchanged path.
    const raw = rawLineageKey(explorerSegmentsRaw)
    if (raw !== key && !this.#rawAlias.has(sig)) {
      try {
        const rawSig = sigStore
          ? await sigStore.signText(raw)
          : await SignatureService.sign(new TextEncoder().encode(raw).buffer as ArrayBuffer)
        if (rawSig && rawSig !== sig) this.#rawAlias.set(sig, rawSig)
      } catch { /* best-effort — a later sign() retries */ }
    }
    return sig
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

    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(signature)
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
   * List all lineage bags (root bags + legacy drain sources —
   * `__history__`/`__hive__`/`hypercomb.io` — deduped, union-promoted).
   */
  public readonly list = async (): Promise<{ signature: string; count: number }[]> => {
    const result: { signature: string; count: number }[] = []
    const bags = await this.enumerateBags()

    for (const [signature, handle] of bags) {
      let count = 0
      for await (const [, child] of (handle as any).entries()) {
        if (child.kind === 'file') count++
      }
      result.push({ signature, count })
    }

    return result
  }

  /**
   * Return the latest operation index and contents for a given bag.
   */
  public readonly head = async (signature: string): Promise<{ index: number; op: HistoryOp } | null> => {
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(signature)
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

  public readonly getLayer = async (signature: string): Promise<LayerState> => {
    try {
      const bag = await this.bagForRead(signature)
      const handle = await bag.getFileHandle(HistoryService.#LAYER_FILE)
      const file = await handle.getFile()
      const text = await file.text()
      return JSON.parse(text) as LayerState
    } catch {
      return EMPTY_LAYER_STATE
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
  // A lineage's history bag is a sig-named dir at the OPFS root:
  //
  //   <root>/{sign(lineage)}/
  //     00000000           ← pointer-record marker (empty layer, auto-minted)
  //     00000001           ← marker for the first user-event commit
  //     ...
  //
  // Markers are pointer records `{"layer":"<sig>"}`; the layer bytes
  // they name live as sig files at the flat root (store.writeLayerBytes
  // / getLayerPoolBytes). Max marker = current head. Soft-deleted
  // markers pool into the sign('temporary') pool keyed by layer sig, so
  // identical archived states dedup to one entry globally.
  //
  // LEGACY (drain sources, read-fallback only): bags stranded in
  // `__history__/`, `__hive__/` or `hypercomb.io/` union-promote to the
  // root bag on first touch — highest marker wins; per-bag
  // `__temporary__` archives absorb into the sign('temporary') pool.
  // Pre-merkle bags whose marker bytes ARE the layer JSON migrate
  // opportunistically on read (see #opportunisticMigrateMarker).

  /**
   * Canonicalize a layer so byte-equal content produces byte-equal JSON.
   *
   * Rules:
   *   - `name` always present, always first. Layer's only intrinsic.
   *   - All other fields are SLOTS (open set; drones plug in via
   *     LayerSlotRegistry). They follow `name` in alphabetical order
   *     by key for stable byte output regardless of registration /
   *     mutation order. Slot-agnostic: `children` is just one slot
   *     among many — no special positioning.
   *   - Slot values kept as-is (each slot is responsible for its own
   *     internal canonical form — sorted arrays, sorted nested keys).
   *     Empty arrays / empty objects / undefined are dropped to keep
   *     the sparse-layer invariant.
   */
  static readonly canonicalizeLayer = (layer: LayerContent): LayerContent => {
    const out: LayerContent = { name: layer.name }
    const slotKeys = Object.keys(layer).filter(k => k !== 'name').sort()
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
   * Two writes per commit:
   *   1. layer bytes → sig-named file at the flat OPFS root
   *      (store.writeLayerBytes; layerSig = sha256 of the canonical
   *      layer JSON);
   *   2. a POINTER-RECORD marker — `{"layer":"<layerSig>"}` — appended
   *      to the lineage's root bag. The marker is META (names which layer
   *      this revision points at); the layer itself is root content. Bag:
   *
   *   <root>/{lineageSig}/00000000  ← marker for the empty layer (auto-minted on first touch)
   *   <root>/{lineageSig}/00000001  ← marker for the first user-event commit
   *   <root>/{lineageSig}/00000002
   *   ...
   *
   * Each NNNNNNNN file is a pointer record, NOT a layer; the highest
   * number is the current revision (history = the run, current = max).
   * The layer's identity is `layerSig`; parents reference each child's
   * current `layerSig` in their `children` array — the cascade walk
   * ancestors do upstream of every commit produces a new layer + marker
   * at each level, so the root lineage's latest layer sig IS the global
   * merkle root.
   *
   * (Legacy markers stored the full layer JSON inline; readers still
   *  handle both via `extractLayerSigFromMarker`, migrating on read.)
   *
   * commitLayer writes ONE marker for ONE lineage. Cascade is orchestrated
   * by the caller (LayerCommitter): walk leaf → root, calling commitLayer
   * at each level with that level's freshly-assembled layer (which
   * references its children's just-committed layer sigs).
   *
   * @returns the new layer's sig (sha256 of the canonical layer bytes) —
   *          also what the freshly-written marker points at.
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
    await this.#ensureEmptyMarker(bag, layer.name, locationSig)

    // Pool write FIRST — the marker (about to be written) is a pointer
    // record referencing this sig. The pool entry must exist by the time
    // any reader resolves the marker, so we await it before the marker
    // write. Subsequent reads (this session or after reload) find the
    // bytes via store.getLayerPoolBytes(layerSig).
    const store = get<{
      writeLayerBytes?: (sig: string, b: ArrayBuffer) => Promise<void>
      writeChildrenManifest?: (
        parentSig: string,
        manifest: Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }>,
      ) => Promise<void>
    }>('@hypercomb.social/Store')
    if (store?.writeLayerBytes) {
      await store.writeLayerBytes(layerSig, bytes.buffer as ArrayBuffer)
    }

    // Write marker as a POINTER RECORD: {"layer": "<sig>"}. The
    // layer bytes themselves live in the pool (written above). The
    // marker is the revision; supporting-data sigs (context, decorations,
    // receipts) can be added as additional fields without changing
    // anything else. Cursor traversal still works against marker
    // filenames (NNNNNNNN); each marker yields its layerSig via the
    // pointer record.
    // Marker name: when the in-memory marker list is warm its max
    // filename is the bag's max — sequence numbers only grow (flatten
    // archives below the first post-flatten commit, whose number
    // #nextMarkerName derived from live ∪ archive; deletions drop the
    // cache entirely). Cold cache → one O(markers) enumeration, after
    // which listLayers' next scan re-warms it.
    const knownList = this.#layerListCache.get(locationSig)
    const markerName = (knownList && knownList.length > 0)
      ? String(knownList.reduce((max, e) => Math.max(max, parseInt(e.filename, 10) || 0), 0) + 1).padStart(8, '0')
      : await this.#nextMarkerName(bag)
    const markerHandle = await bag.getFileHandle(markerName, { create: true })
    const markerRecord: MarkerRecord = { layer: layerSig }
    const markerBytes = new TextEncoder().encode(JSON.stringify(markerRecord))
    const markerWritable = await markerHandle.createWritable()
    try { await markerWritable.write(markerBytes.buffer as ArrayBuffer) } finally { await markerWritable.close() }

    // Keep the in-memory marker list coherent: the entry we just wrote
    // IS the bag's new tail. cursor.onNewLayer reads it via listLayers'
    // warm path instead of re-scanning the whole bag.
    if (knownList) knownList.push({ layerSig, at: Date.now(), filename: markerName })

    // The flat root is the only writer destination. No legacy mirror —
    // sig is hash(bytes), one root entry per sig, content-addressed and
    // never stale. The legacy `__optimized__`/`__layers__` dirs are
    // read-fallback drain sources only (resolved inside Store).

    // Children manifest: for any layer with a non-empty `children` array,
    // pre-resolve each child sig to its head layer and write the array
    // into the sign('manifests') pool keyed by the parent layer sig.
    // Reads of this parent's children skip the per-child sig→layer walk
    // on cold load.
    // Microtask-scheduled (not idle) — the commit return is unblocked,
    // but the write fires before the next render frame so the manifest
    // is reliably present on "next start" after a single commit cycle.
    const childSigs = Array.isArray(canonical.children) ? canonical.children : []
    if (store?.writeChildrenManifest && childSigs.length > 0) {
      queueMicrotask(() => {
        void (async () => {
          const manifest: Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> = []
          for (const sig of childSigs) {
            const child = await this.getLayerBySig(sig)
            if (!child) continue
            manifest.push({ sig, layer: child })
          }
          // Write ONLY a COMPLETE manifest. A partial (a child didn't
          // resolve this pass) fails the reader's length check
          // (manifest.length === children.length) and is silently ignored
          // on every future load, forcing the slow per-child path that
          // drops not-yet-cached children — the two-stage render bug. A
          // missing manifest is fine: resolveChildNames backfills a
          // complete one once all children are warm.
          if (manifest.length === childSigs.length) await store.writeChildrenManifest!(layerSig, manifest)
        })()
      })
    }

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
    this.#parsedLayerCache.set(layerSig, canonical)
    this.#latestSigByLineage.set(locationSig, layerSig)
    this.#scheduleHeadPersist()

    // Mirror up to DCP. PushQueueService listens on EffectBus and
    // enqueues the bytes for sentinel intake; the queue survives
    // page reloads and retries until DCP acks.
    EffectBus.emit('content:wrote', { sig: layerSig, kind: 'layer' as const, bytes: bytes.buffer as ArrayBuffer })

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
    locationSig?: string,
  ): Promise<void> => {
    let exists = true
    try { await bag.getFileHandle('00000000', { create: false }) } catch { exists = false }
    if (exists) return
    // Planting 00000000 changes the bag's marker set outside the
    // commitLayer append path — drop the in-memory marker list so the
    // next listLayers re-scans (the bag is brand-new here, so the
    // re-scan is O(1)).
    if (locationSig) this.#layerListCache.delete(locationSig)
    const empty = HistoryService.canonicalizeLayer(emptyLayer(name))
    const json = JSON.stringify(empty)
    const bytes = new TextEncoder().encode(json)
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    // Pool write FIRST — the 00000000 marker is a pointer to the empty
    // layer; the pool must hold its bytes when the marker becomes readable.
    const store = get<{
      writeLayerBytes?: (sig: string, b: ArrayBuffer) => Promise<void>
    }>('@hypercomb.social/Store')
    if (store?.writeLayerBytes) {
      await store.writeLayerBytes(sig, bytes.buffer as ArrayBuffer)
    }

    // Write the 00000000 marker as a POINTER RECORD pointing at the
    // empty layer's sig.
    const handle = await bag.getFileHandle('00000000', { create: true })
    const markerRecord: MarkerRecord = { layer: sig }
    const markerBytes = new TextEncoder().encode(JSON.stringify(markerRecord))
    const writable = await handle.createWritable()
    try { await writable.write(markerBytes.buffer as ArrayBuffer) } finally { await writable.close() }

    // Mirror the LAYER bytes (not marker bytes) into the preloader cache
    // — sig→content lookups want the layer JSON, not the marker JSON.
    this.#preloaderCache.set(sig, bytes.buffer as ArrayBuffer)
    this.#parsedLayerCache.set(sig, empty)
  }

  /**
   * Return the sig of the lineage's CURRENT layer bytes.
   *
   * Source of truth: the lineage sigbag at `<root>/<lineageSig>/` (the
   * OPFS root; legacy `__history__`/`__hive__`/`hypercomb.io` bags are
   * read-fallback drain sources, union-promoted on touch). If it has
   * markers, return the latest marker's content sig. If it's empty (or
   * doesn't exist yet), MATERIALIZE the empty marker `00000000` on
   * disk for this name, then return the sig of those real bytes.
   *
   * No virtual / name-derived sigs. Every sig the cascade hands to a
   * parent is the hash of bytes that physically exist in the bag.
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
    const bag = await this.getBag(lineageSig)

    let latestName = ''
    for await (const [entryName, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(entryName)) continue
      if (entryName > latestName) latestName = entryName
    }

    if (!latestName) {
      // Brand-new bag: materialize the empty marker on disk so its
      // sig is the hash of real file bytes, not a virtual computation.
      await this.#ensureEmptyMarker(bag, name, lineageSig)
      latestName = '00000000'
    }

    const handle = await bag.getFileHandle(latestName, { create: false })
    const file = await handle.getFile()
    const bytes = await file.arrayBuffer()
    // Extract layer sig — handles both modern pointer records and
    // legacy markers (where bytes ARE the layer JSON).
    const { layerSig, isPointer } = await extractLayerSigFromMarker(bytes)
    if (!isPointer) {
      // Legacy: marker bytes == layer bytes. Cache them, and migrate
      // the marker to a pointer record (and the bytes into the pool)
      // so subsequent reads find the canonical shape.
      this.#preloaderCache.set(layerSig, bytes)
      this.#opportunisticMigrateMarker(layerSig, bytes, handle)
    }
    this.#latestSigByLineage.set(lineageSig, layerSig)
    return layerSig
  }

  /**
   * Opportunistic legacy-marker migration: when a marker is read in its
   * legacy bytes-in-marker shape, (1) write its bytes as a sig-named file
   * at the OPFS root (store.writeLayerBytes), then (2) rewrite the marker file itself
   * as a pointer record `{"layer":"<sig>"}`. After this the marker is
   * indistinguishable from a fresh commit. Best-effort, idle-deferred —
   * no caller waits.
   *
   * Sequencing matters: the pool write must complete before the marker
   * rewrite, otherwise a concurrent reader could see the new
   * pointer-shape marker pointing at bytes that aren't in the pool yet.
   *
   * Marker filename (NNNNNNNN) stays sequential — only its content
   * shape changes. Layer-sig identity (what `latestMarkerSigFor` and
   * `getLayerBySig` use) is unchanged because the layer bytes are
   * unchanged; the marker rewrite is purely a shape migration.
   */
  #opportunisticMigrateMarker = (
    layerSig: string,
    bytes: ArrayBuffer,
    markerHandle: FileSystemFileHandle | null,
  ): void => {
    const store = get<{
      writeLayerBytes?: (sig: string, b: ArrayBuffer) => Promise<void>
    }>('@hypercomb.social/Store')
    if (!store?.writeLayerBytes) return
    const schedule: (cb: () => void) => void =
      typeof (window as any).requestIdleCallback === 'function'
        ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 5_000 })
        : (cb) => setTimeout(cb, 0)
    schedule(async () => {
      try {
        // 1. Pool write FIRST — marker rewrite must point at present bytes.
        await store.writeLayerBytes!(layerSig, bytes)
        // 2. Rewrite the marker file as a pointer record.
        if (!markerHandle) return
        const record = JSON.stringify({ layer: layerSig })
        const recordBytes = new TextEncoder().encode(record)
        const writable = await markerHandle.createWritable()
        try { await writable.write(recordBytes.buffer as ArrayBuffer) } finally { await writable.close() }
      } catch { /* best-effort */ }
    })
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
  /**
   * Cheap list of every marker file in the bag — names only, no bytes
   * read, no parse, no filter beyond the marker-name regex. The viewer
   * uses this as the source of truth for "what files exist right now"
   * and resolves content lazily through `readMarker` with a per-bag
   * per-filename cache. Returns empty array if the bag doesn't exist
   * yet.
   *
   * Marker contents are immutable (markers are append-only and content-
   * addressed at write), so a filename-keyed cache never needs
   * invalidation. Re-reading the directory listing on every render is
   * cheap (an OPFS dir enumeration is one syscall-ish, no I/O on the
   * files themselves) and guarantees the viewer reflects whatever is
   * currently on disk — no stale "X says total=N but only 1 row
   * rendered" desync.
   */
  public readonly listMarkerFilenames = async (
    locationSig: string,
  ): Promise<readonly string[]> => {
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(locationSig)
    } catch {
      return []
    }
    const names: string[] = []
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      names.push(name)
    }
    names.sort((a, b) => a.localeCompare(b))
    return names
  }

  /**
   * Read and parse one marker by filename. Returns the raw bytes, the
   * parsed JSON (or null on parse failure — caller decides how to
   * surface it), the file's lastModified timestamp, and the bytes' sig.
   * No filtering — even non-canonical files come back so the viewer
   * can display "something is here, here's what it looks like" instead
   * of silently dropping the row.
   */
  public readonly readMarker = async (
    locationSig: string,
    filename: string,
  ): Promise<{ bytes: ArrayBuffer; parsed: LayerContent | null; layerSig: string; at: number; rawText: string } | null> => {
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(locationSig)
    } catch {
      return null
    }
    let handle: FileSystemFileHandle
    try {
      handle = await bag.getFileHandle(filename)
    } catch {
      return null
    }
    try {
      const file = await handle.getFile()
      const bytes = await file.arrayBuffer()
      const rawText = new TextDecoder().decode(bytes)

      // Extract the canonical layer sig from either marker shape.
      // Pointer record → sig is the value inside the marker; legacy
      // → sig is hash(bytes).
      const { layerSig, isPointer } = await extractLayerSigFromMarker(bytes)

      // Resolve the actual layer content for the viewer. Pointer markers
      // have their layer bytes in the pool — go through getLayerBySig
      // so the viewer sees `{name, children, ...}`, not `{layer:<sig>}`.
      // Legacy markers parse directly.
      let parsed: LayerContent | null = null
      if (isPointer) {
        parsed = await this.getLayerBySig(layerSig)
      } else {
        try {
          const obj = JSON.parse(rawText)
          if (obj && typeof obj === 'object' && typeof obj.name === 'string') {
            parsed = HistoryService.#hydrateLayer(obj as LayerContent)
            // Legacy marker surfaced via the viewer — migrate it so
            // subsequent reads route through the pool exclusively.
            this.#preloaderCache.set(layerSig, bytes)
            this.#opportunisticMigrateMarker(layerSig, bytes, handle)
          }
        } catch { /* leave parsed null; viewer surfaces raw */ }
      }
      return { bytes, parsed, layerSig, at: file.lastModified, rawText }
    } catch {
      return null
    }
  }

  public readonly listLayers = async (
    locationSig: string,
  ): Promise<Array<LayerEntry & { index: number; filename: string }>> => {
    // Warm path: the in-memory marker list is maintained by commitLayer
    // (append) and invalidated by every marker-deleting path. Returning
    // it here keeps cursor.onNewLayer — which runs after EVERY commit —
    // from re-reading the whole bag (O(history-depth) OPFS reads).
    const cachedList = this.#layerListCache.get(locationSig)
    if (cachedList) {
      return cachedList.map((entry, position) => ({ ...entry, index: position }))
    }

    // SKIP non-canonical entries; do NOT delete them. Auto-delete on
    // every read is destructive and not user-driven — a single bad
    // detection rule could erase real markers and lose history. To
    // explicitly purge non-canonical files, the user can run /flatten
    // which calls #quarantineNonLayerFiles via a dedicated path.
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(locationSig)
    } catch {
      return []
    }

    const markers: Array<LayerEntry & { filename: string }> = []
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const bytes = await file.arrayBuffer()
        // Drop pre-merkle bare-sig markers; `/flatten` is the only path
        // that purges them from disk.
        const text = new TextDecoder().decode(bytes)
        const trimmed = text.trim()
        if (HistoryService.#SIG_RE.test(trimmed)) continue
        // Canonical reader for marker bytes. In the new architecture
        // every marker is a pointer record `{layer:<sig>,…}` and the
        // layer JSON lives in the pool. Legacy inline-layer markers
        // `{name,children?,…}` are still readable; we migrate them on
        // first touch so subsequent reads route exclusively through
        // the pool. Anything else (op-JSON from the pre-layer recorder,
        // malformed files) is skipped — markers must resolve to a real
        // canonical layer to surface here.
        const { layerSig, isPointer } = await extractLayerSigFromMarker(bytes)
        if (!HistoryService.#SIG_RE.test(layerSig)) continue
        if (!isPointer) {
          // Validate that the inline bytes really are a layer (have
          // a non-empty `name`). Op-JSON files left over from the
          // pre-layer recorder land here and must be filtered.
          let parsed: Partial<LayerContent>
          try { parsed = JSON.parse(text) as Partial<LayerContent> } catch { continue }
          if (typeof parsed.name !== 'string' || parsed.name.length === 0) continue
          this.#preloaderCache.set(layerSig, bytes)
          this.#opportunisticMigrateMarker(layerSig, bytes, handle as FileSystemFileHandle)
        }
        markers.push({ layerSig, at: file.lastModified, filename: name })
      } catch { /* skip unreadable */ }
    }
    markers.sort((a, b) => a.filename.localeCompare(b.filename))
    // Populate the warm-path cache. commitLayer appends to this array
    // in place on every subsequent commit; deletion paths drop it.
    this.#layerListCache.set(locationSig, markers)
    return markers.map((entry, position) => ({ ...entry, index: position }))
  }

  /**
   * Allocate the next sequential marker name for this bag. Format is
   * 8-digit zero-padded starting at 00000001 — max live marker + 1.
   * The __temporary__ archive is a SIGNATURE pool now (sig-named, not
   * sequence-numbered), so there are no archived numbers to collide with;
   * the old archive scan is gone.
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
   * Resolve `layerSig` → parsed layer content.
   *
   * Canonical path: layer bytes are sig-named files at the OPFS root,
   * routed through {@link getLayerBySig} (Store resolves root-first with
   * legacy `__layers__`/`__optimized__` fallbacks). Pointer-record markers
   * carry only the sig; the bytes always come from that content read.
   *
   * Legacy fallback: pre-migration markers store the layer JSON inline
   * (bytes IS the layer). The cold scan below recovers those and
   * triggers an opportunistic migration so the next read hits the pool.
   *
   * Per-lineage hot cache (`#markerBytesCache`) is a write-through from
   * `commitLayer` — useful when a freshly committed layer is read back
   * in the same lineage; pointer-shape markers do not populate it.
   */
  public readonly getLayerContent = async (
    locationSig: string,
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null

    // 0. Parsed-cache hit — bypass JSON.parse + #hydrateLayer entirely.
    //    Layers are content-addressed, so the parsed object is valid
    //    regardless of which bag the caller asked through.
    const parsedHit = this.#parsedLayerCache.get(layerSig)
    if (parsedHit) return parsedHit

    // 1. Hot bytes cache. listLayers populates this with LAYER bytes for
    //    legacy markers (where marker bytes ARE layer bytes); pointer
    //    markers don't get cached here under layerSig — they go through
    //    the pool path below.
    const cache = this.#markerBytesCache.get(locationSig)
    const cachedBytes = cache?.get(layerSig)
    if (cachedBytes) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(cachedBytes)) as Partial<LayerContent>
        if (typeof parsed.name === 'string' && parsed.name.length > 0) {
          const hydrated = HistoryService.#hydrateLayer(parsed as LayerContent)
          this.#parsedLayerCache.set(layerSig, hydrated)
          return hydrated
        }
      } catch { /* fall through to pool / cold scan */ }
    }

    // 2. Content + preloader caches. Pointer-record markers stash layer
    //    bytes as sig-named files at the OPFS root; getLayerBySig handles
    //    that path plus parsed-/preloader-cache lookups.
    const fromPool = await this.getLayerBySig(layerSig)
    if (fromPool) return fromPool

    // 3. Cold scan — handles legacy bytes-in-marker bags whose layer
    //    bytes never made it into the pool. Use extractLayerSigFromMarker
    //    so we recognise either shape and don't match marker-hash
    //    against a pointer record's layer-hash by accident.
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(locationSig)
    } catch { return null }

    const cacheMap = this.#markerBytesCache.get(locationSig)
      ?? (this.#markerBytesCache.set(locationSig, new Map()), this.#markerBytesCache.get(locationSig)!)

    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const fileBytes = await file.arrayBuffer()
        const { layerSig: extractedSig, isPointer } = await extractLayerSigFromMarker(fileBytes)
        if (extractedSig !== layerSig) continue
        if (isPointer) {
          // Pointer matched but pool didn't have the layer (getLayerBySig
          // tried already). Nothing more we can do.
          return null
        }
        // Legacy: marker bytes ARE layer bytes. Cache, parse, then
        // migrate the marker so future reads route through the pool.
        cacheMap.set(layerSig, fileBytes)
        this.#preloaderCache.set(layerSig, fileBytes)
        const parsed = JSON.parse(new TextDecoder().decode(fileBytes)) as Partial<LayerContent>
        if (typeof parsed.name !== 'string' || parsed.name.length === 0) return null
        const hydrated = HistoryService.#hydrateLayer(parsed as LayerContent)
        this.#parsedLayerCache.set(layerSig, hydrated)
        this.#opportunisticMigrateMarker(layerSig, fileBytes, handle as FileSystemFileHandle)
        return hydrated
      } catch { /* skip unreadable */ }
    }
    return null
  }

  /**
   * Pure projection from raw parsed JSON to a LayerContent. Defers to
   * `canonicalizeLayer` so the read-side filter (drop empty arrays /
   * empty objects / null / undefined) is mechanically identical to the
   * write-side filter — single source of truth, slot-agnostic, no
   * per-slot special cases. Reader output bytes are now also key-
   * sorted, which is harmless for readers and preserves the round-trip
   * invariant for any caller that re-signs the result.
   */
  static readonly #hydrateLayer = (parsed: Partial<LayerContent>): LayerContent =>
    HistoryService.canonicalizeLayer(parsed as LayerContent)

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
   * Parsed-layer cache: sig → already-decoded LayerContent. Layer bytes
   * are content-addressed and immutable, so once parsed the result is
   * valid forever. Without this, every getLayerBySig / getLayerContent
   * call re-runs JSON.parse + #hydrateLayer over the same bytes — hot
   * during render (resolveChildNames touches every child's layer per
   * frame) and cascade (layer-committer reads prev layers for every
   * ancestor on every commit).
   */
  readonly #parsedLayerCache = new Map<string, LayerContent>()

  /**
   * Per-lineage current-sig cache. Updated on every commit so
   * "what's the latest sig for /A/B?" doesn't have to re-walk the bag.
   */
  readonly #latestSigByLineage = new Map<string, string>()

  /**
   * Persisted snapshot of #latestSigByLineage. The map is a pure
   * derivation of on-disk state (each bag's max marker), but re-deriving
   * it from scratch means enumerating every bag × every marker — the
   * 13.6s preloadAllBags rebuild that ran on every reload. Caching the
   * derivation (canonical = the bag's max marker; cache = this localStorage
   * index) makes a warm boot a single localStorage read, so first paint
   * never waits on a bag scan. Same dual-store pattern as tile properties.
   * Participant-local (it's a cache, not part of the signed layer tree).
   */
  static readonly #HEAD_INDEX_KEY = 'hc:history:head-index'
  #headPersistTimer: ReturnType<typeof setTimeout> | null = null

  /** Load the persisted head index into #latestSigByLineage. Synchronous
   *  (localStorage) so it's ready before the first currentLayerAt. Bad/stale
   *  entries are self-correcting: currentLayerAt re-derives any head whose
   *  bytes don't resolve, and the reconciliation tail overwrites the file. */
  readonly #restoreHeadIndex = (): void => {
    try {
      const raw = localStorage.getItem(HistoryService.#HEAD_INDEX_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, string>
      let n = 0
      for (const [lineageSig, layerSig] of Object.entries(obj)) {
        if (HistoryService.#SIG_RE.test(lineageSig) && HistoryService.#SIG_RE.test(layerSig)) {
          this.#latestSigByLineage.set(lineageSig, layerSig)
          n++
        }
      }
      if (n) console.log(`[preload] head index restored from cache: ${n} lineages (first paint skips the bag scan)`)
    } catch { /* corrupt/unavailable cache — fall back to derivation, no harm */ }
  }

  /** Debounced persist. Cheap to call from every head mutation; coalesces
   *  bursts (a cascade touches many lineages) into one write. */
  readonly #scheduleHeadPersist = (): void => {
    if (this.#headPersistTimer) return
    this.#headPersistTimer = setTimeout(this.#flushHeadIndex, 1500)
  }

  /** Write the current head index now. Called by the debounce and on
   *  tab-hide so the next boot starts warm. */
  readonly #flushHeadIndex = (): void => {
    if (this.#headPersistTimer) { clearTimeout(this.#headPersistTimer); this.#headPersistTimer = null }
    try {
      const obj: Record<string, string> = {}
      for (const [lineageSig, layerSig] of this.#latestSigByLineage) obj[lineageSig] = layerSig
      localStorage.setItem(HistoryService.#HEAD_INDEX_KEY, JSON.stringify(obj))
    } catch { /* quota / unavailable — non-fatal, only costs a cold next boot */ }
  }

  /**
   * Per-lineage marker list — the in-memory mirror of what listLayers
   * reads off disk. Without it, EVERY commit re-enumerated the bag and
   * re-read EVERY marker file (cursor.onNewLayer → listLayers), making
   * create cost O(history-depth) — measured at ~1.8s per create at
   * 2000 markers. The cache turns that into an O(1) append.
   *
   * Coherence contract (same as #latestSigByLineage): commitLayer
   * appends the entry it just wrote; every path that deletes or
   * archives markers (removeEntries, archiveEntries, quarantine,
   * refreshLineageCache, #ensureEmptyMarker's first-touch plant)
   * drops the lineage's entry so the next listLayers re-scans disk.
   * promoteToHead / mergeEntries route through commitLayer and need
   * no special handling. Opportunistic marker migration rewrites a
   * marker's SHAPE in place (same filename, same layerSig) so cached
   * entries stay valid.
   */
  readonly #layerListCache = new Map<string, Array<LayerEntry & { filename: string }>>()

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
  /** Seed an already-parsed layer into the in-memory cache. Used by
   *  readers that obtained full layer JSON through a side channel (the
   *  children manifest inlines each child's layer) so the subsequent
   *  per-child getLayerBySig calls on the render path are O(1) hits
   *  instead of cold pool reads — and can never fall into the
   *  preloadAllBags join. No disk I/O; hydration only. */
  public readonly seedParsedLayer = (layerSig: string, layer: Partial<LayerContent>): void => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return
    if (!layer || typeof layer !== 'object' || !layer.name) return
    if (this.#parsedLayerCache.has(layerSig)) return
    this.#parsedLayerCache.set(layerSig, HistoryService.#hydrateLayer(layer))
  }

  /**
   * Local-only layer resolution: parsed cache → preloader cache →
   * canonical layer pool. Returns null on miss WITHOUT triggering the
   * global preloadAllBags. This is the warm path: getLayerBySig adds the
   * cold-miss preload on top, while currentLayerAt's head-cache hit calls
   * this directly so a restored / stale head can never drag the 13s scan
   * back onto the first-paint path.
   */
  readonly #resolveLayerLocal = async (
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null
    const parsedHit = this.#parsedLayerCache.get(layerSig)
    if (parsedHit) return parsedHit
    const cached = this.#preloaderCache.get(layerSig)
    if (cached) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(cached)) as Partial<LayerContent>
        if (parsed.name) {
          const hydrated = HistoryService.#hydrateLayer(parsed)
          this.#parsedLayerCache.set(layerSig, hydrated)
          return hydrated
        }
      } catch { /* fall through to pool */ }
    }

    // Sig-direct lookup through Store's content read. Markers in the
    // lineage sigbags are revision-pointers; layer bytes live as sig-named
    // files at the OPFS root (legacy `__layers__`/`__optimized__` are
    // read-fallback drain sources). Content-addressed, no mirrors.
    const store = get<{
      getLayerPoolBytes?: (sig: string) => Promise<Uint8Array | null>
    }>('@hypercomb.social/Store')
    if (store?.getLayerPoolBytes) {
      const poolBytes = await store.getLayerPoolBytes(layerSig)
      if (poolBytes) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(poolBytes)) as Partial<LayerContent>
          if (parsed.name) {
            const hydrated = HistoryService.#hydrateLayer(parsed)
            this.#parsedLayerCache.set(layerSig, hydrated)
            this.#preloaderCache.set(layerSig, poolBytes.buffer as ArrayBuffer)
            return hydrated
          }
        } catch { /* malformed pool file — fall through */ }
      }
    }
    return null
  }

  public readonly getLayerBySig = async (
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null
    const local = await this.#resolveLayerLocal(layerSig)
    if (local) return local
    const store = get<{
      getLayerPoolBytes?: (sig: string) => Promise<Uint8Array | null>
    }>('@hypercomb.social/Store')

    // On-demand, content-addressed resolution — NEVER a brute-force scan.
    // #resolveLayerLocal already tried memory + a direct pool read; do ONE
    // more direct read by signature in case the bytes were written/relocated
    // by another reader since that check. A layer is found by its sig in O(1),
    // or it is a genuine miss. We do NOT fall back to preloadAllBags (a full-
    // hive enumeration) on a render hop: that turns one tile resolution into
    // an O(N) scan and drags the whole hive onto first paint. A genuine miss
    // returns null; the caller re-renders as the neighbourhood warms (the
    // manifest fast-path and the bounded passive warmer fill the cache), and
    // the full marker history is only ever read when working with history.
    if (store?.getLayerPoolBytes) {
      const bytes = await store.getLayerPoolBytes(layerSig)
      if (bytes) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LayerContent>
          if (parsed.name) {
            const hydrated = HistoryService.#hydrateLayer(parsed)
            this.#parsedLayerCache.set(layerSig, hydrated)
            this.#preloaderCache.set(layerSig, bytes.buffer as ArrayBuffer)
            return hydrated
          }
        } catch { /* malformed pool file */ }
      }
    }
    return null
  }

  /**
   * Read the current head layer at a location WITHOUT auto-minting an
   * empty marker if the bag doesn't exist. Used by readers that just
   * want the present state — UI consumers, slot-cache warmers, the
   * notes strip — and must NOT side-effect the disk for cells that were
   * never touched.
   *
   * Strategy: consult `#latestSigByLineage` first (kept current by every
   * commitLayer / latestMarkerSigFor path). On miss, trigger
   * `preloadAllBags` (idempotent, completes once per session) which fills
   * the lineage cache for every existing bag. Returns null when the
   * location truly has no committed marker.
   *
   * `stats.cold` (optional out-param) distinguishes the two null cases —
   * a distinction callers CANNOT make from the return value alone:
   *   cold=true  → TRANSIENT miss (history root not ready, or a head sig
   *                exists but its bytes aren't in the local pool yet).
   *                The caller should retry/re-render; caching this null
   *                as "no layer" poisons downstream state (the tile-index
   *                scramble was exactly this: a cold index read cached as
   *                "no index" → viewport score-fill → wrong slot forever).
   *   cold unset → AUTHORITATIVE absence: the bag genuinely has no
   *                committed marker. Safe to cache as empty.
   */
  public readonly currentLayerAt = async (
    locationSig: string,
    stats?: { cold?: boolean },
  ): Promise<LayerContent | null> => {
    if (!HistoryService.#SIG_RE.test(locationSig)) return null
    const cached = this.#latestSigByLineage.get(locationSig)
    if (cached) {
      // Warm path. The head may have come from a previous session via the
      // restored head index — resolve it LOCALLY (parsed/preloader/pool),
      // never through getLayerBySig, whose cold-miss fallback would drag
      // the whole 13s preloadAllBags onto this first-paint hop.
      const hit = await this.#resolveLayerLocal(cached)
      if (hit) return hit
      // Stale head (cross-session drift, or its bytes aren't in the pool):
      // drop it and re-derive from disk rather than returning a wrong null.
      this.#latestSigByLineage.delete(locationSig)
      this.#scheduleHeadPersist()
    }
    // SINGLE-LINEAGE cold path — first paint must be linear in "this
    // layer + its tiles", never in tree size. Warm just THIS lineage's
    // head (one dir listing + one marker read). Do NOT kick the full
    // preloadAllBags here: on real data it's a multi-second tail that
    // would steal the main thread from this very first paint. The
    // idle-deferred reconciliation (runtime-initializer's requestIdleCallback)
    // owns the full pass. Fall back to it only when the history root isn't
    // ready yet (Store still initializing — preloadAllBags owns that poll).
    try {
      await this.#warmLineageHead(locationSig)
    } catch {
      // History root not ready yet (Store still initializing). Do NOT
      // brute-force preloadAllBags — return null and let the caller re-render
      // once the single-lineage head warm can run. COLD: this null says
      // nothing about whether the bag has a marker.
      if (stats) stats.cold = true
      return null
    }
    const refreshed = this.#latestSigByLineage.get(locationSig)
    // Warm succeeded and found no marker — the bag genuinely has none.
    // AUTHORITATIVE absence: cold stays unset.
    if (!refreshed) return null
    const layer = await this.getLayerBySig(refreshed)
    // A head sig EXISTS but its bytes didn't resolve (pool miss — sync
    // still landing, cross-session drift). COLD: retrying can succeed.
    if (!layer && stats) stats.cold = true
    return layer
  }

  // ── merkle SEAL for sharing (leaf-only-commit safe) ───────────────────
  // Consolidated-sig cache: locationSig → { key, sealedSig }. `key` folds the
  // location's live head sig + its children's sealed sigs, so any change at or
  // below a node invalidates exactly that node's entry.
  readonly #sealCache = new Map<string, { key: string; sealedSig: string }>()

  /**
   * Seal a tile's subtree into a merkle-correct root sig for SHARING, WITHOUT
   * touching history. Under leaf-only commit (per-page history — the cascade is
   * stopped) a parent layer's `children` sigs are frozen at the parent's LAST
   * commit, so a descendant added since (a page added under a site) is invisible
   * to any consumer that walks the content-sig chain: broker.adopt,
   * flattenLayerTree, and the swarm publish handle. Local navigation is
   * unaffected — it resolves each location's LIVE head via currentLayerAt — so
   * the staleness only surfaces when the tree leaves this machine. Sharing the
   * raw child sig therefore ships a CHILDLESS snapshot: the adopter gets the
   * host tile and none of its pages ("adopted, but no tiles").
   *
   * sealSubtree re-runs the merkle cascade for `segments` from LIVE location
   * heads. Bottom-up, each internal node is re-signed with its children pointing
   * at their freshly-sealed sigs; the consolidated bytes are pool-written by sig
   * (store.writeLayerBytes) with NO marker, NO head advance, NO history entry —
   * leaf-only commit and the participant's history stay exactly as they are. The
   * sealed layers live in this pool and are served to peers over the mesh, so a
   * peer adopting the sealed root walks the whole subtree with the UNCHANGED
   * content-sig walk; nothing downstream of the publish handle changes.
   *
   * Returns the sealed root sig, or null when the subtree can't be fully
   * resolved right now (a cold / unpooled child) so the caller shares the live
   * sig rather than a lossy seal. Memoised per location by (headSig + children)
   * so an unchanged subtree re-seals in O(nodes) map hits with no re-hash /
   * re-write; `visited` guards against corrupt cycles.
   */
  public readonly sealSubtree = async (
    segments: readonly string[],
    visited: Set<string> = new Set(),
  ): Promise<string | null> => {
    const locSig = await this.sign({ explorerSegments: () => [...segments] })
    if (!locSig || visited.has(locSig)) return null
    visited.add(locSig)

    const head = await this.currentLayerAt(locSig)
    if (!head) return null
    const headSig = this.#latestSigByLineage.get(locSig) ?? null

    // A location's DIRECT children are authoritative at its own head (adding,
    // removing or renaming a direct child re-commits THIS head). Seal each child
    // through its OWN live head — recursing by LOCATION, never by the possibly-
    // stale child sig, is what freshens grandchildren and deeper.
    const childSigs = Array.isArray(head.children) ? head.children : []
    const sealedChildren: string[] = []
    for (const cs of childSigs) {
      const child = await this.getLayerBySig(String(cs))
      const name = (child?.name ?? '').trim()
      if (!name) return null // cold / unresolvable child — refuse a lossy seal
      const sealed = await this.sealSubtree([...segments, name], visited)
      if (!sealed) return null
      sealedChildren.push(sealed)
    }

    // Leaf: the head is already a correct merkle node. getLayerBySig ===
    // canonicalizeLayer (a round-trip invariant), so re-signing reproduces the
    // SAME sig — reuse the head sig when known, else materialise it.
    if (sealedChildren.length === 0) {
      if (headSig) return headSig
      const leaf = await HistoryService.#signLayer(head)
      await HistoryService.#poolWriteLayer(leaf.sig, leaf.bytes)
      return leaf.sig
    }

    // Internal node: rebuild with children → sealed sigs; memoise on the fold.
    const key = `${headSig ?? ''}|${sealedChildren.join(',')}`
    const memo = this.#sealCache.get(locSig)
    if (memo && memo.key === key) return memo.sealedSig
    const { sig, bytes } = await HistoryService.#signLayer({ ...head, children: sealedChildren })
    await HistoryService.#poolWriteLayer(sig, bytes)
    this.#sealCache.set(locSig, { key, sealedSig: sig })
    return sig
  }

  /** Canonicalize → encode → sha256 a layer, exactly as commitLayer does, but
   *  WITHOUT committing it. Backs sealSubtree's node materialisation. */
  static readonly #signLayer = async (
    layer: LayerContent,
  ): Promise<{ sig: string; bytes: Uint8Array }> => {
    const canonical = HistoryService.canonicalizeLayer(layer)
    const bytes = new TextEncoder().encode(JSON.stringify(canonical))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    return { sig, bytes }
  }

  /** Pool-write layer bytes by sig (additive, content-addressed, dedup) with NO
   *  marker — the seal's only side effect. */
  static readonly #poolWriteLayer = async (sig: string, bytes: Uint8Array): Promise<void> => {
    const store = get<{ writeLayerBytes?: (s: string, b: ArrayBuffer) => Promise<void> }>('@hypercomb.social/Store')
    if (store?.writeLayerBytes) await store.writeLayerBytes(sig, bytes.buffer as ArrayBuffer)
  }

  /**
   * The child NAMES directly under a location path — the SAME source of
   * truth the renderer uses (`currentLayerAt` → each child sig's own
   * `.name`), so a membership test here matches what actually paints as a
   * navigable tile. Returns `{ names, authoritative }`. `authoritative` is
   * false when the answer is uncertain — the location's head is cold, or a
   * child layer's bytes aren't pooled yet — so callers can refuse to act on
   * an incomplete read (never conclude "not a child" from a cold miss).
   */
  readonly #childNamesOf = async (
    segments: readonly string[],
  ): Promise<{ names: Set<string>; authoritative: boolean }> => {
    const names = new Set<string>()
    const locSig = await this.sign({ explorerSegments: () => [...segments] })
    if (!locSig) return { names, authoritative: false }
    const stats = { cold: false }
    const layer = await this.currentLayerAt(locSig, stats)
    if (!layer) {
      // No committed layer here. If the read was cold the absence is not
      // authoritative; otherwise the location genuinely has zero children.
      return { names, authoritative: !stats.cold }
    }
    const childSigs = Array.isArray(layer.children) ? layer.children : []
    let miss = false
    await Promise.all(childSigs.map(async (sig) => {
      const child = await this.getLayerBySig(sig)
      if (!child) { miss = true; return } // cold pool miss — set is incomplete
      const nm = (child.name ?? '').trim()
      if (nm) names.add(nm)
    }))
    return { names, authoritative: !miss }
  }

  /**
   * Walk a lineage path and return the DEEPEST prefix that is fully real —
   * every segment at depth ≥ 1 must be a genuine child of its parent. The
   * self-heal oracle: a too-early / double-click can append a segment for a
   * child that doesn't exist at the new level (e.g. `/a/b/c/c`); clamping to
   * this prefix repairs the address instead of letting it "run up" disjoint
   * phantom segments.
   *
   * Safety contract:
   *  - Segment[0] is treated as an always-valid root. Under variable roots a
   *    first segment can be a standalone tree root (a set, launcher, adopted
   *    domain) that is NOT a child of the empty root, so it must never be
   *    clamped away. Healing only ever trims phantom CHILDREN (depth ≥ 1).
   *  - `cold: true` is returned the moment resolution stops being
   *    authoritative (a cold head, an unpooled child). The walk stops there
   *    and the caller MUST NOT clamp on a cold result — a false clamp of a
   *    real-but-not-yet-warm location is worse than the phantom it heals.
   *  - Empty-but-real leaves and dir-less virtual sub-layers are preserved:
   *    they are real children of their parent, so they stay in the prefix.
   */
  public readonly deepestRealPrefix = async (
    segments: readonly string[],
  ): Promise<{ prefix: string[]; cold: boolean }> => {
    const path = segments.map((s) => String(s ?? '').trim()).filter(Boolean)
    if (path.length <= 1) return { prefix: [...path], cold: false }

    let validDepth = 1 // root (index 0) always kept
    let cold = false
    for (let i = 1; i < path.length; i++) {
      const parent = path.slice(0, i) // known-valid: we only continue while valid
      const { names, authoritative } = await this.#childNamesOf(parent)
      if (!authoritative) { cold = true; break } // uncertain — stop, don't trim below
      if (names.has(path[i])) { validDepth = i + 1; continue }
      break // path[i] is not a real child of `parent` → clamp here
    }
    return { prefix: path.slice(0, validDepth), cold }
  }

  /**
   * Warm ONE lineage's head into `#latestSigByLineage`: filename-only
   * enumeration to find the latest NNNN marker, then a single byte read —
   * the per-lineage analog of preloadAllBags' two-pass discipline. The
   * scan spans the ROOT bag and every legacy drain source WITHOUT the
   * promotion copy (first paint must never pay a whole-bag copy): the
   * HIGHEST marker across all sources wins, whichever dir holds it — a
   * stale source can never time-travel the head backwards. An absent bag
   * returns silently (the location truly has no committed marker, no
   * minting); a missing store root THROWS so the caller flags the null
   * as cold instead of authoritative absence.
   */
  readonly #warmLineageHead = async (lineageSig: string): Promise<void> => {
    const root = this.hiveRoot
    if (!root) throw new Error('history: store not ready')
    let latestName = ''
    let latestBag: FileSystemDirectoryHandle | null = null
    const scan = async (source: FileSystemDirectoryHandle | undefined): Promise<void> => {
      if (!source) return
      let bag: FileSystemDirectoryHandle
      try { bag = await source.getDirectoryHandle(lineageSig, { create: false }) } catch { return }
      for await (const [name, handle] of (bag as any).entries()) {
        if (handle.kind !== 'file') continue
        if (!HistoryService.#MARKER_RE.test(name)) continue
        if (name > latestName) { latestName = name; latestBag = bag }
      }
    }
    await scan(root)
    for (const src of this.#legacyBagSources()) {
      try { await scan(src) } catch { /* source unreadable — union what we have */ }
    }
    if (!latestName || !latestBag) return
    try {
      const fileHandle = await (latestBag as FileSystemDirectoryHandle).getFileHandle(latestName, { create: false })
      const bytes = await (await fileHandle.getFile()).arrayBuffer()
      const { layerSig, isPointer } = await extractLayerSigFromMarker(bytes)
      if (!isPointer) this.#preloaderCache.set(layerSig, bytes)
      this.#latestSigByLineage.set(lineageSig, layerSig)
      this.#scheduleHeadPersist()
    } catch { /* unreadable head — stay cold; the passive preload may resolve it */ }
  }

  /**
   * Synchronous peek at the current head layer at a location. Returns
   * null on cache miss — caller must have already awaited
   * `preloadAllBags` (or some path that warmed `#latestSigByLineage` and
   * `#parsedLayerCache` for this location). For UI reads on hot paths
   * (notes strip per render), this avoids the round-trip through
   * Promise.then while the data is already in memory.
   */
  public readonly peekCurrentLayer = (
    locationSig: string,
  ): LayerContent | null => {
    if (!HistoryService.#SIG_RE.test(locationSig)) return null
    const sig = this.#latestSigByLineage.get(locationSig)
    if (!sig) return null
    return this.#parsedLayerCache.get(sig) ?? null
  }

  /**
   * Synchronous peek at a layer by its content sig. Returns null on
   * cache miss. Mirror of `getLayerBySig` for the parsed-cache hot path.
   */
  public readonly peekLayerBySig = (
    layerSig: string,
  ): LayerContent | null => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null
    return this.#parsedLayerCache.get(layerSig) ?? null
  }

  /**
   * Every layer sig the preloader has touched in this session. Used by
   * slot-aware subsystems (HiveParticipant.warmup) to walk the layer
   * universe looking for slot occurrences. After `preloadAllBags`, the
   * returned set covers every marker in every bag on disk.
   */
  public readonly allKnownLayerSigs = (): readonly string[] => {
    return [...this.#preloaderCache.keys()]
  }

  /** Number of lineages with a known head marker. A cheap O(1) change
   *  signal — it grows when a bag is adopted / synced / first-committed —
   *  so consumers (e.g. the substrate reconcile) can detect "the hive
   *  changed" and skip an expensive full-tree walk when it hasn't. */
  public readonly headIndexCount = (): number => this.#latestSigByLineage.size

  /**
   * One-shot session preload: walk every lineage sigbag (root bags plus
   * any legacy `__history__`/`__hive__`/`hypercomb.io` drain sources, via
   * enumerateBags), hash every NNNNNNNN marker, populate `#preloaderCache` and
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
  /**
   * Boot-time index: for every existing bag, identify the LATEST marker
   * (by filename, no byte read) and only read+sign THAT one. The cache
   * holds head sigs only — sufficient for rendering the current layer
   * tree. Historical sigs (undo / time-travel) are lazy on demand.
   *
   * Before this change, this method read+signed every marker in every
   * bag — for a tree with N bags × M markers each, that's N×M file reads
   * + SHA-256 ops on the main thread per session. Cold boot for a tree
   * of moderate size measured in tens of seconds; the page presented
   * "Install Hypercomb" but was wedged on this scan.
   *
   * After: one filename-enumeration per bag (no byte reads) + one
   * file read + sign per bag. O(bags + total markers stat-only)
   * vs the old O(bags × markers byte+sign).
   */
  public readonly preloadAllBags = async (): Promise<void> => {
    if (this.#preloadAllBagsPromise) return this.#preloadAllBagsPromise
    // Defensive root resolution: Store.initialize() is async, and any
    // caller that fires before it resolves (early swarm publish, boot-
    // time tile selection, show-cell's layer-driven children read on
    // first paint) would land here with `historyRoot` undefined.
    //
    // CRITICAL: do NOT return early on miss. show-cell now reads tile
    // membership EXCLUSIVELY from history.currentLayerAt → which calls
    // here. An early return leaves `#latestSigByLineage` empty forever
    // (nothing schedules a re-warm), so the canvas shows zero tiles
    // even after Store finishes initializing. Instead: AWAIT Store
    // becoming ready by polling Store.initialize() — once it resolves,
    // historyRoot is guaranteed defined (or `#opfsAvailable === false`,
    // in which case we bail with an empty cache, which is correct for
    // a session running without persistent storage).
    this.#preloadAllBagsPromise = (async () => {
      const rootStore = get<{
        hypercombRoot?: FileSystemDirectoryHandle
        initialize?: () => Promise<void>
        opfsAvailable?: boolean
      }>('@hypercomb.social/Store')

      // Wait for Store.initialize() to resolve. The promise is memoized
      // inside Store so multiple awaits share one boot. If Store isn't
      // even registered yet (race against module load order), poll
      // briefly and retry — bounded so we don't spin forever.
      let store = rootStore
      let polls = 0
      // Readiness keys off `hypercombRoot` (always create:true), NOT
      // `history` — the legacy `__history__` pool is now optional (Phase-2)
      // and absent for fresh participants / after gcLegacyHistory, but the
      // hive root is the OPFS-ready signal and the bag scan spans both pools.
      while ((!store?.initialize || !store?.hypercombRoot) && polls < 50) {
        if (store?.initialize) await store.initialize()
        if (store?.hypercombRoot) break
        await new Promise(r => setTimeout(r, 100))
        store = get<{
          hypercombRoot?: FileSystemDirectoryHandle
          initialize?: () => Promise<void>
          opfsAvailable?: boolean
        }>('@hypercomb.social/Store')
        polls++
      }
      const root = store?.hypercombRoot
      if (!root) {
        // OPFS unavailable for the whole session (Store gave up). Leave
        // the preloader cache empty — currentLayerAt returns null for
        // every location, which is correct for a no-persistence run.
        console.warn('[preload] preloadAllBags: Store never became ready; running with empty cache')
        return
      }

      const startMs = performance.now()
      let bagCount = 0
      let markerCount = 0
      let cachedCount = 0
      const previewSigs: string[] = []

      // Cooperative time-slicing. On real data this scan covers hundreds
      // of bags / thousands of markers (measured 5.1s over 293 bags) —
      // its dir enumerations, file reads, JSON parses and hashes are all
      // main-thread continuations, and run un-sliced they starve an
      // in-flight first render of the event loop. Yield whenever a slice
      // exceeds ~12ms so paint and input always interleave; wall-clock
      // grows slightly, responsiveness doesn't degrade at all.
      let sliceStart = performance.now()
      const yieldIfDue = async (): Promise<void> => {
        if (performance.now() - sliceStart < 12) return
        await new Promise<void>(r => setTimeout(r, 0))
        sliceStart = performance.now()
      }

      // Union of root bags (promoted) and every legacy drain source
      // (`__history__`/`__hive__`/`hypercomb.io`), deduped with highest
      // marker winning. `root` was only needed to gate on Store readiness
      // above; the scan itself spans every source.
      const bags = await this.enumerateBags()
      for (const [lineageSig, dirHandle] of bags) {
        await yieldIfDue()
        bagCount++
        const bag = dirHandle as FileSystemDirectoryHandle

        // Pass 1: filename-only enumeration to find the latest marker.
        // No bytes read, no signing. Sliced too — the ROOT bag gains a
        // marker on every change made anywhere, so a single bag can hold
        // thousands of entries.
        let latestName = ''
        for await (const [name, fileHandle] of (bag as any).entries()) {
          if (fileHandle.kind !== 'file') continue
          if (!HistoryService.#MARKER_RE.test(name)) continue
          markerCount++
          if (name > latestName) latestName = name
          if (markerCount % 200 === 0) await yieldIfDue()
        }
        if (!latestName) continue

        // Pass 2: read latest marker, extract layer sig. Handles BOTH
        // pointer-record markers (modern) and legacy layer-byte markers
        // — extractLayerSigFromMarker tries pointer-shape first, falls
        // back to hashing bytes (which IS the layer sig in legacy data).
        try {
          const fileHandle = await bag.getFileHandle(latestName, { create: false })
          const file = await fileHandle.getFile()
          const bytes = await file.arrayBuffer()
          const { layerSig, isPointer } = await extractLayerSigFromMarker(bytes)
          if (!isPointer) {
            // Legacy: marker bytes == layer bytes. Cache them + actively
            // migrate the marker file to pointer-record shape, with bytes
            // landing in the canonical pool. After this drains the marker
            // is indistinguishable from a fresh commit.
            this.#preloaderCache.set(layerSig, bytes)
            this.#opportunisticMigrateMarker(layerSig, bytes, fileHandle)
          }
          this.#latestSigByLineage.set(lineageSig, layerSig)
          cachedCount++
          if (previewSigs.length < 10) previewSigs.push(layerSig.slice(0, 12))
        } catch { /* skip unreadable */ }
      }

      // Reconciliation complete — persist the freshly-derived head index so
      // the NEXT boot warm-starts from it instead of re-running this scan.
      this.#flushHeadIndex()

      const elapsed = Math.round(performance.now() - startMs)
      console.log(
        `[preload] preloadAllBags done: ${cachedCount} heads cached / ${bagCount} bags scanned / ${markerCount} markers seen (${elapsed}ms). ` +
        `first sigs: [${previewSigs.join(', ')}${cachedCount > previewSigs.length ? ', …' : ''}]`
      )
    })()
    // Belt-and-braces: if the IIFE itself rejects (e.g. OPFS handle revoked
    // mid-walk), clear the cached promise so a later call can re-attempt.
    // Without this, one transient failure would poison every subsequent
    // currentLayerAt for the rest of the session.
    this.#preloadAllBagsPromise.catch(() => {
      this.#preloadAllBagsPromise = null
    })

    // Phase 2 — DETACHED but PROMPT: walk from the root layer to warm the
    // parsed cache for every reachable descendant. This used to be CHAINED
    // into the shared promise, so a single cold getLayerBySig miss on the
    // render path awaited the WHOLE serial tree walk — seconds on real
    // data. Awaiters of preloadAllBags() only need phase-1
    // (#latestSigByLineage heads); the walk is pure cache warming, and
    // "real-time supersedes preloader": it must never sit on an awaited
    // render hop. Scheduled once (memoized promise means this .then chain
    // attaches on first construction only).
    //
    // It is NOT idle-deferred. It used to wait behind requestIdleCallback
    // ({timeout: 8000}) ON TOP of phase-1's own 5s idle defer — so for the
    // first ~10-15s of a session the descendant parsed cache stayed cold,
    // and the user's first navigation into a big tile (many children) beat
    // the warm to the punch: resolveChildNames paid N cold pool reads
    // (0.5-1s), instant only on the SECOND visit. Phase-1 has already
    // completed by the time this .then fires (seconds in — first paint is
    // long done), so there is nothing left to protect by deferring. The
    // walk is now parallel + cooperatively sliced (preloadFromRoot yields
    // every ~12ms), so starting it eagerly cannot starve paint or input.
    void this.#preloadAllBagsPromise.then(() => {
      void (async () => {
        try {
          const rootLineageSig = await this.sign({ explorerSegments: () => [] })
          const rootHeadSig = await this.latestMarkerSigFor(rootLineageSig, '/')
          if (rootHeadSig) {
            await this.preloadFromRoot(rootHeadSig)
          } else {
            console.log('[preload] preloadFromRoot skipped: no root head sig')
          }
        } catch (err) {
          console.warn('[preload] preloadFromRoot failed (non-fatal):', err)
        }
      })()
    })
    return this.#preloadAllBagsPromise
  }

  /**
   * Walk the layer tree from a root sig, fetching every descendant and
   * warming the cache. Two-path-strict discipline: every fetch routes
   * through {@link getLayerBySig}, which itself checks the cache first
   * and only falls back to a cold bag scan on miss. By the time this
   * returns, the render path can navigate to any reachable sub-layer
   * and hit the cache exclusively — no further walks.
   *
   * BREADTH-FIRST + BOUNDED-PARALLEL. The walk used to be a serial DFS:
   * one `await getLayerBySig` at a time, so on a tree of hundreds of
   * layers the warm took many seconds to reach any given branch — the
   * user routinely navigated into a big tile before the walk got there,
   * paying cold per-child pool reads on first visit. Each layer fetch is
   * an independent OPFS read; running them through a fixed worker pool
   * (level by level) warms the whole tree in a fraction of the wall-clock
   * while a ~12ms slice budget yields the main thread back to paint and
   * input between batches. Breadth-first so the SHALLOW tiles a user is
   * most likely to open next warm first.
   *
   * Logs progress every 50 layers so a long boot doesn't look frozen,
   * and emits a summary at the end with depth-binned counts.
   */
  // Bounded neighbourhood warm: root pool → children → … up to this depth,
  // one file per tile. NOT the whole hive — an unbounded walk fetched every
  // reachable layer (~1500 on a big tree) and its OPFS churn starved paint
  // and input. Deeper tiles warm ON DEMAND (one file per tile) as the user
  // navigates into them; there is no need to pull the entire universe ahead.
  static readonly #PRELOAD_MAX_DEPTH = 3
  public readonly preloadFromRoot = async (
    rootSig: string,
    maxDepth: number = HistoryService.#PRELOAD_MAX_DEPTH,
  ): Promise<void> => {
    if (!HistoryService.#SIG_RE.test(rootSig)) return
    const startMs = performance.now()
    const visited = new Set<string>([rootSig])
    const depthHistogram = new Map<number, number>()
    let cacheHits = 0
    let walked = 0

    // Cooperative slicing — mirror preloadAllBags: yield whenever a slice
    // exceeds ~12ms so an in-flight render keeps the event loop.
    let sliceStart = performance.now()
    const yieldIfDue = async (): Promise<void> => {
      if (performance.now() - sliceStart < 12) return
      await new Promise<void>(r => setTimeout(r, 0))
      sliceStart = performance.now()
    }

    const CONCURRENCY = 12
    let frontier: string[] = [rootSig]
    let depth = 0

    // BOUNDED: stop once we've warmed `maxDepth` levels out from the root.
    // Beyond that is on-demand (getLayerBySig cold path, one file per tile).
    while (frontier.length && depth < maxDepth) {
      const nextFrontier = new Set<string>()
      // Bounded worker pool over this depth level. A shared cursor hands
      // each idle worker the next sig; visited is pre-seeded so no sig is
      // fetched twice even when several parents reference the same child.
      let cursor = 0
      const drainLevel = frontier
      const worker = async (): Promise<void> => {
        while (cursor < drainLevel.length) {
          const sig = drainLevel[cursor++]
          const wasCached = this.#parsedLayerCache.has(sig) || this.#preloaderCache.has(sig)
          const layer = await this.getLayerBySig(sig)
          await yieldIfDue()
          if (!layer) continue
          walked++
          depthHistogram.set(depth, (depthHistogram.get(depth) ?? 0) + 1)
          if (wasCached) cacheHits++
          if (walked % 50 === 0) {
            console.log(`[preload] preloadFromRoot progress: ${walked} layers walked (depth ≤ ${depth})`)
          }
          const children = Array.isArray(layer.children) ? layer.children : []
          for (const childSig of children) {
            if (HistoryService.#SIG_RE.test(childSig) && !visited.has(childSig)) {
              visited.add(childSig)
              nextFrontier.add(childSig)
            }
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, frontier.length) }, () => worker()),
      )
      frontier = [...nextFrontier]
      depth++
    }
    const elapsed = Math.round(performance.now() - startMs)
    const depthSummary = [...depthHistogram.entries()]
      .sort(([a], [b]) => a - b)
      .map(([d, n]) => `d${d}:${n}`)
      .join(' ')
    console.log(
      `[preload] preloadFromRoot done: ${walked} layers reachable from ${rootSig.slice(0, 12)} ` +
      `(${cacheHits} already cached, ${walked - cacheHits} newly warmed) in ${elapsed}ms. depths: ${depthSummary}`
    )
  }

  // Bounded NEIGHBOURHOOD pre-warm — the "passive warmer" the disabled boot
  // preload alludes to. 79c36e63 removed the whole-hive substrate walk that, as
  // a SIDE EFFECT, warmed the click targets — so the FIRST interaction at any
  // location was cold and show-cell's completeness gate held the canvas blank
  // until the current layer's children landed (project_boot_first_click_warming,
  // and the same gate behind the "post-adopt nothing shows" symptom). Restore
  // the warm WITHOUT the O(hive) cost: resolve THIS location's head, then
  // breadth-warm its bounded subtree (depth ≤ #PRELOAD_MAX_DEPTH) through the
  // cooperatively-sliced preloadFromRoot. Dedup on the head sig so back-to-back
  // fs-churn 'change' events at one location don't re-walk. Driven from
  // runtime-initializer on boot + every lineage 'change' (debounced + idle
  // there). Non-fatal: a cold render is correct, just slower.
  #lastWarmedHead = ''
  public readonly preloadNeighbourhood = async (
    locationSig: string,
    maxDepth: number = HistoryService.#PRELOAD_MAX_DEPTH,
  ): Promise<void> => {
    if (!HistoryService.#SIG_RE.test(locationSig)) return
    // Resolve (warming if needed) this location's head layer sig the SAME way
    // currentLayerAt does — #latestSigByLineage is the per-lineage head map.
    let headSig = this.#latestSigByLineage.get(locationSig)
    if (!headSig) {
      try { await this.#warmLineageHead(locationSig) } catch { return }
      headSig = this.#latestSigByLineage.get(locationSig)
    }
    if (!headSig || headSig === this.#lastWarmedHead) return
    this.#lastWarmedHead = headSig
    await this.preloadFromRoot(headSig, maxDepth)
  }

  /**
   * Per-lineage refresh: invalidate the cached latest for one lineage
   * and re-read its bag. Use after destructive ops on that lineage
   * (already invoked automatically by removeEntries/promoteToHead/
   * mergeEntries, but exposed for callers that mutate a bag directly).
   */
  public readonly refreshLineageCache = async (lineageSig: string): Promise<void> => {
    this.#latestSigByLineage.delete(lineageSig)
    this.#layerListCache.delete(lineageSig)
    this.#scheduleHeadPersist()
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(lineageSig)
    } catch { return }
    let latestName = ''
    let latestSig = ''
    for await (const [name, handle] of (bag as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!HistoryService.#MARKER_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const bytes = await file.arrayBuffer()
        // extractLayerSigFromMarker yields the canonical LAYER sig for
        // either marker shape; the marker-bytes hash is the pointer's
        // hash, not the layer's, and would corrupt #latestSigByLineage.
        const { layerSig, isPointer } = await extractLayerSigFromMarker(bytes)
        if (!isPointer) this.#preloaderCache.set(layerSig, bytes)
        if (name > latestName) { latestName = name; latestSig = layerSig }
      } catch { /* skip */ }
    }
    if (latestSig) { this.#latestSigByLineage.set(lineageSig, latestSig); this.#scheduleHeadPersist() }
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
   * /flatten, which the user invokes deliberately.
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
      bag = await this.bagForRead(locationSig)
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
    if (drop.length > 0) this.#layerListCache.delete(locationSig)
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
  //   mergeEntries(markers[])   → cherry-pick: union all slot arrays
  //                                across selected layers, newest layer
  //                                wins on `name`, commit the merged
  //                                content as a fresh marker at head.
  //                                Source markers are preserved so the
  //                                user keeps the lineage trail.
  //
  //   projectMerge(markers[])   → same union as mergeEntries but no
  //                                write — returns the projected layer
  //                                content for preview.

  /**
   * Bring a layer sig back to head by appending a fresh marker that
   * carries that layer's content. Resolves the sig to its canonical
   * layer JSON and routes through {@link commitLayer} so the new
   * marker is a canonical JSON marker (the only format
   * {@link listLayers} surfaces).
   *
   * Returns the resulting layer sig — which equals the input
   * `layerSig` whenever the content is byte-identical (the normal
   * case). If the sig matches the bag's current head, commitLayer's
   * dedup makes this a no-op (no spurious marker for "promote
   * already-head").
   *
   * Returns null when the sig cannot be resolved to a layer (dead
   * pointer; refuse to write a placeholder).
   */
  public readonly promoteToHead = async (
    locationSig: string,
    layerSig: string,
  ): Promise<string | null> => {
    if (!HistoryService.#SIG_RE.test(layerSig)) return null
    const layer = await this.getLayerBySig(layerSig)
    if (!layer) return null
    return await this.commitLayer(locationSig, layer)
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
      bag = await this.bagForRead(locationSig)
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
    if (removed > 0) {
      this.#latestSigByLineage.delete(locationSig)
      this.#layerListCache.delete(locationSig)
      this.#scheduleHeadPersist()
    }
    return removed
  }

  /**
   * Soft-delete into the sign('temporary') POOL at the OPFS root: each
   * archived marker is keyed by the layer sig it points at, so identical
   * archived states dedup to one entry — globally, across every bag. The
   * marker bytes are preserved under the sig key; restore = re-commit a
   * marker pointing at that sig. Markers whose sig can't be resolved fall
   * back to their positional filename. (The legacy per-bag `__temporary__`
   * subdirs are drain sources — absorbed into this pool by the self-clean,
   * never written again.)
   *
   * USED ONLY BY /collapse-history AND /flatten. These are the rare
   * paths that wipe non-head markers in bulk; everywhere else
   * (single-entry UI delete, mergeEntries) stays on the hard-delete
   * primitive `removeEntries`.
   */
  public readonly archiveEntries = async (
    locationSig: string,
    filenames: string[],
  ): Promise<number> => {
    if (filenames.length === 0) return 0
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(locationSig)
    } catch { return 0 }

    // Never delete a marker that hasn't been archived: no pool, no soft-delete.
    const archive = await this.#temporaryPool()
    if (!archive) return 0

    let archived = 0
    for (const filename of filenames) {
      try {
        const srcHandle = await bag.getFileHandle(filename, { create: false })
        const file = await srcHandle.getFile()
        const bytes = await file.arrayBuffer()
        // Pool key = the layer sig this marker points at (sign(MEANING)),
        // so identical archived states collapse to one file. Fall back to
        // the positional filename only if the sig can't be resolved.
        const { layerSig } = await extractLayerSigFromMarker(bytes)
        const poolName = HistoryService.#SIG_RE.test(layerSig) ? layerSig : filename
        // Dedup: only write if this meaning isn't already pooled.
        let pooled = true
        try { await archive.getFileHandle(poolName, { create: false }) } catch { pooled = false }
        if (!pooled) {
          const dstHandle = await archive.getFileHandle(poolName, { create: true })
          const writable = await dstHandle.createWritable()
          try { await writable.write(bytes) } finally { await writable.close() }
        }
        await bag.removeEntry(filename)
        archived++
      } catch { /* already gone or unreadable — skip */ }
    }
    if (archived > 0) {
      this.#latestSigByLineage.delete(locationSig)
      this.#layerListCache.delete(locationSig)
      this.#scheduleHeadPersist()
    }
    return archived
  }

  /**
   * Multi-select cherry-pick "merge into head". Reads every selected
   * marker's layer, computes the projected union (newest wins on
   * `name`, every other slot is the deduped union of all selected
   * layers' sig arrays), then commits the merged content as a fresh
   * marker at head. Source markers are preserved so the user keeps
   * the lineage trail visible.
   *
   * Single-selection callers are routed through {@link promoteToHead}
   * by the viewer; this path always merges N ≥ 2 layers' contents.
   */
  public readonly mergeEntries = async (
    locationSig: string,
    filenames: string[],
  ): Promise<string | null> => {
    const merged = await this.projectMerge(locationSig, filenames)
    if (!merged) return null
    return await this.commitLayer(locationSig, merged)
  }

  /**
   * Compute the projected merged layer for a set of selected markers
   * without committing. Used by the viewer's merge preview so the user
   * sees exactly what the new head would contain before they confirm.
   *
   * Merge rules:
   *  - `name` = newest selected layer's name (chronological by marker
   *    filename, which is monotonic per-bag).
   *  - Every other slot = deduplicated union of every selected layer's
   *    array values, preserving chronological order (oldest first).
   *    Non-array slot values are ignored.
   *  - Empty slots are dropped from the result — sparse-layer invariant.
   */
  public readonly projectMerge = async (
    locationSig: string,
    filenames: string[],
  ): Promise<LayerContent | null> => {
    if (filenames.length === 0) return null

    // Read each marker's parsed layer content in chronological order
    // (markers are 8-digit monotonic names, so filename sort gives the
    // timeline). Markers carry the layer JSON inline — readMarker
    // parses the bytes directly, so we don't need to resolve a sig.
    const ordered = [...filenames]
      .filter(name => HistoryService.#MARKER_RE.test(name))
      .sort((a, b) => a.localeCompare(b))
    if (ordered.length === 0) return null

    const layers: LayerContent[] = []
    for (const filename of ordered) {
      const m = await this.readMarker(locationSig, filename)
      if (m?.parsed) layers.push(m.parsed)
    }
    if (layers.length === 0) return null

    // Newest wins on name — last entry in the chronologically-sorted
    // list. Fall back to empty string if the newest layer somehow has
    // no name set (shouldn't happen for committed layers).
    const newestName = layers[layers.length - 1].name ?? ''

    // Union every other slot. Walk every layer in order and accumulate
    // sig arrays per slot, deduping by string equality. Inline values
    // (non-string array elements) pass through with JSON-keyed dedupe.
    const slotUnions = new Map<string, unknown[]>()
    const slotSeen = new Map<string, Set<string>>()
    for (const layer of layers) {
      for (const key of Object.keys(layer)) {
        if (key === 'name') continue
        const value = (layer as Record<string, unknown>)[key]
        if (!Array.isArray(value) || value.length === 0) continue
        let bucket = slotUnions.get(key)
        let seen = slotSeen.get(key)
        if (!bucket) {
          bucket = []
          seen = new Set<string>()
          slotUnions.set(key, bucket)
          slotSeen.set(key, seen)
        }
        for (const entry of value) {
          const dedupeKey = typeof entry === 'string' ? entry : JSON.stringify(entry)
          if (seen!.has(dedupeKey)) continue
          seen!.add(dedupeKey)
          bucket.push(entry)
        }
      }
    }

    const merged: LayerContent = { name: newestName }
    for (const [key, values] of slotUnions) {
      (merged as Record<string, unknown>)[key] = values
    }
    return merged
  }

  // -------------------------------------------------
  // marker labels + marks (participant timeline metadata)
  // -------------------------------------------------
  //
  // A marked / named history point is annotation on the MARKER, not the
  // layer: the marker record gains `label` / `marked` fields alongside
  // `layer`. The layer sig is unchanged (it's hashed from the layer
  // bytes in the pool, independent of the marker), so labeling a past
  // point does NOT cascade to root — and it travels with the bag when
  // history is shared/deployed. Marker bytes change, so callers that
  // cache marker content by filename must drop that key on edit.

  /**
   * Read the label/mark annotation on a single marker. Returns
   * `{ label, marked }` (both optional) or null if the marker is
   * missing / unparseable.
   */
  public readonly readMarkerMeta = async (
    locationSig: string,
    filename: string,
  ): Promise<{ label?: string; marked?: boolean } | null> => {
    const m = await this.readMarker(locationSig, filename)
    if (!m) return null
    try {
      const parsed = JSON.parse(m.rawText)
      const out: { label?: string; marked?: boolean } = {}
      if (typeof parsed?.label === 'string') out.label = parsed.label
      if (typeof parsed?.marked === 'boolean') out.marked = parsed.marked
      return out
    } catch {
      return {}
    }
  }

  /**
   * Set (or clear) a marker's label / mark. Rewrites the marker file in
   * place, preserving its `layer` pointer and any other fields. Passing
   * `label: ''` or `marked: false` clears that annotation (the field is
   * dropped from the record). No-op when the marker can't be read.
   */
  public readonly setMarkerMeta = async (
    locationSig: string,
    filename: string,
    meta: { label?: string; marked?: boolean; path?: readonly string[] },
  ): Promise<void> => {
    if (!HistoryService.#MARKER_RE.test(filename)) return
    let bag: FileSystemDirectoryHandle
    try {
      bag = await this.bagForRead(locationSig)
    } catch { return }
    let handle: FileSystemFileHandle
    try {
      handle = await bag.getFileHandle(filename, { create: false })
    } catch { return }

    // Resolve the layer sig so the rewritten marker stays a valid pointer
    // record even if the original was a legacy inline-layer marker.
    let record: Record<string, unknown>
    try {
      const bytes = await (await handle.getFile()).arrayBuffer()
      const { layerSig } = await extractLayerSigFromMarker(bytes)
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes))
        record = (parsed && typeof parsed === 'object' && typeof parsed.layer === 'string')
          ? parsed as Record<string, unknown>
          : { layer: layerSig }
      } catch {
        record = { layer: layerSig }
      }
    } catch { return }

    if (meta.label !== undefined) {
      if (meta.label.trim().length > 0) record['label'] = meta.label.trim()
      else delete record['label']
    }
    if (meta.marked !== undefined) {
      if (meta.marked) record['marked'] = true
      else delete record['marked']
    }
    if (meta.path !== undefined) {
      const clean = meta.path.map(s => String(s ?? '').trim()).filter(Boolean)
      if (clean.length > 0) record['path'] = clean
      else delete record['path']
    }

    const out = new TextEncoder().encode(JSON.stringify(record))
    const writable = await handle.createWritable()
    try { await writable.write(out.buffer as ArrayBuffer) } finally { await writable.close() }
  }

  /**
   * Scan every bag for marked markers — the "marked places" list. Returns
   * one entry per marked marker with its location bag, filename, optional
   * label, and timestamp. Used by the viewer's marked-places view to jump
   * back to any point the user flagged, anywhere in the tree.
   */
  public readonly listMarkedPoints = async (): Promise<Array<{
    locationSig: string
    filename: string
    label: string | null
    path: string[] | null
    at: number
  }>> => {
    const out: Array<{ locationSig: string; filename: string; label: string | null; path: string[] | null; at: number }> = []
    const bags = await this.enumerateBags()
    for (const [lineageSig, dirHandle] of bags) {
      const bag = dirHandle as FileSystemDirectoryHandle
      for await (const [name, handle] of (bag as any).entries()) {
        if (handle.kind !== 'file') continue
        if (!HistoryService.#MARKER_RE.test(name)) continue
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const text = await file.text()
          if (!text.includes('"marked"')) continue
          const parsed = JSON.parse(text)
          if (parsed?.marked !== true) continue
          out.push({
            locationSig: lineageSig,
            filename: name,
            label: typeof parsed.label === 'string' ? parsed.label : null,
            path: Array.isArray(parsed.path) ? parsed.path.map((s: unknown) => String(s)) : null,
            at: file.lastModified,
          })
        } catch { /* skip unreadable */ }
      }
    }
    out.sort((a, b) => b.at - a.at)
    return out
  }

  // -------------------------------------------------
  // mechanical delta-record primitives
  // -------------------------------------------------
  //
  // Records are the pure-differential form of history. A record is
  // `{name, <op>: [sigs]}` serialised as raw line-oriented text (see
  // delta-record.ts). Records are immutable and content-addressed: the
  // record bytes live as a sig-named FILE inside the lineage sigbag
  // (`<root>/{locSig}/{sig}`), so publishing a bag ships its markers and
  // the records they reference together.
  //
  // Per-location markers live at the bag root as opaque zero-padded
  // entry files (`<root>/{locSig}/NNNNNNNN`, no extension).
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
   * tar up the lineage sigbag `<root>/{locSig}/` and the peer gets the
   * markers and the layer content they reference as one self-contained unit.
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

    // Record content at <root>/{locSig}/{sig} (inside the sigbag).
    // Content-addressed, immutable — skip the rewrite if the file already exists so live
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
      bag = await this.bagForRead(locationSig)
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
   * Load + parse the DeltaRecord at the given signature. Records live
   * inside each lineage sigbag (`<root>/{locSig}/{sig}`), so
   * resolution is scoped to the bag — callers pass the locationSig
   * along with the record sig. Returns null on missing or malformed
   * content.
   */
  public readonly resolveDeltaRecord = async (
    locationSig: string,
    sig: string,
  ): Promise<DeltaRecord | null> => {
    try {
      const bag = await this.bagForRead(locationSig)
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

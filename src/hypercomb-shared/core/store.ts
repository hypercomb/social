// hypercomb-shared/core/store.ts
// hypercomb-web/src/app/core/store.ts

import { Bee, EffectBus, SignatureService, isSignature, registerPoolMeaning } from '@hypercomb/core'

/** How long a host-resolution MISS is remembered before the cascade may be
 *  re-dialed for that sig. Render passes within the window get an instant
 *  null instead of a network storm; the egg stays retryable after it. */
const HOST_MISS_TTL_MS = 60_000

// SHA-256 of zero bytes — the ONLY signature whose valid content is empty.
// Any OTHER sig stored as a 0-byte file is a corrupt/interrupted write
// (see putResource): the read path treats it as a miss so the host fetch
// can heal it instead of serving emptiness forever.
const EMPTY_CONTENT_SIG = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export type DevManifest = {
  dependencies: Record<string, string>
  imports: Record<string, string>
  resources?: Record<string, string[]>
  domains?: Record<string, unknown> | unknown,
  root: string
}

export class Store extends EventTarget {

  /** THE STORAGE MODEL — no typed folders, ever.
   *
   *  The user-content root IS the OPFS root: content bytes are sig-named
   *  files at the root, lineage sigbags (`<lineageSig>/` holding `000x`
   *  markers, max marker = current) are sig-named dirs at the root, and
   *  POOLS OF MEANING are dirs named by `sign(meaning)` — sha256 of the
   *  UTF-8 bytes of the meaning string, derived by convention so any
   *  tier (swarm firewall, tooling, a peer) computes the identical
   *  address with no registry. Meaning is never a folder name; the
   *  signature is the address.
   *
   *  Every `__x__` name below is a LEGACY drain source: opened WITHOUT
   *  `create` (so it stays gone once drained), read as a fallback after
   *  the canonical location misses, and never written again. The
   *  user-content root was historically `hypercomb.io/`, then briefly
   *  `__hive__/` — both are drain sources for the flat root now. See
   *  documentation/sign-meaning-pool-migration-plan.md. */
  public static readonly BEES_MEANING = 'bees'
  public static readonly DEPENDENCIES_MEANING = 'dependencies'
  public static readonly CLIPBOARD_MEANING = 'clipboard'
  public static readonly THREADS_MEANING = 'threads'
  public static readonly COMPUTATION_MEANING = 'computation'
  /** Children manifests: per-parent derived cache that inlines the
   *  resolved child layer objects, KEYED BY PARENT LAYER SIG (not by
   *  content sig — it is a cache, not authored content). Lets show-cell
   *  skip the per-child sig→layer lookup on cold load. Orphaned when the
   *  parent is superseded — pure derived state, safe to GC. */
  public static readonly MANIFESTS_MEANING = 'manifests'
  /** Savvy-user i18n override layer (`overrides/i18n.json`) and the
   *  per-locale translation cache (`translations/`). Historically these
   *  were the last human-named folders at the OPFS root — NOT `__x__`,
   *  but still non-signed, which the standard forbids. Now sign(meaning)
   *  pools like everything else, self-cleaned from their legacy dirs. */
  public static readonly OVERRIDES_MEANING = 'overrides'
  public static readonly TRANSLATIONS_MEANING = 'translations'

  public static readonly LEGACY_HIVE_DIRECTORY = '__hive__'
  public static readonly LEGACY_HYPERCOMB_IO_DIRECTORY = 'hypercomb.io'
  public static readonly LEGACY_BEES_DIRECTORY = '__bees__'
  public static readonly LEGACY_DEPENDENCIES_DIRECTORY = '__dependencies__'
  /** Legacy layer-bytes pool. Layer bytes are content — they live as
   *  sig-named files at the flat root now; markers in lineage sigbags
   *  reference them. This dir (including its per-domain manifest
   *  subdirs) is read-fallback only. */
  public static readonly LEGACY_LAYERS_DIRECTORY = '__layers__'
  public static readonly LEGACY_RESOURCES_DIRECTORY = '__resources__'
  public static readonly LEGACY_CLIPBOARD_DIRECTORY = '__clipboard__'
  public static readonly LEGACY_HISTORY_DIRECTORY = '__history__'
  public static readonly LEGACY_THREADS_DIRECTORY = '__threads__'
  public static readonly LEGACY_COMPUTATION_DIRECTORY = '__computation__'
  /** Legacy sig-keyed layer-bytes mirror. Read-fallback only. */
  public static readonly LEGACY_OPTIMIZED_DIRECTORY = '__optimized__'
  public static readonly LEGACY_MANIFESTS_DIRECTORY = '__manifests__'
  /** Legacy non-signed i18n folders (no `__` wrapper, but still human
   *  labels — banned all the same). Drain sources: absorbed into their
   *  sign(meaning) pools and removed on boot. */
  public static readonly LEGACY_OVERRIDES_DIRECTORY = 'overrides'
  public static readonly LEGACY_TRANSLATIONS_DIRECTORY = 'translations'
  /** Persistent decoration substrate — the optimization POOL OF MEANING.
   *  Holds Q&A, comm threads, future optimization kinds — anything
   *  authored-or-derived that gets applied to base objects in memory at
   *  runtime without polluting their layer. Loaded at startup; entries
   *  survive reloads. Layer-untouched: the layer-commit primitive never
   *  reads or writes here. State-machine wrappers around base objects
   *  compose entries onto the cell view without mutating the underlying
   *  layer; the only legitimate bridge from this pool into the layer is
   *  when an optimization resolves into a note (Q&A answered → note
   *  appended). See `feedback_layer_purity_optimizations_external.md` /
   *  `project_optimization_substrate.md` in user memory.
   *
   *  Addressed by the SIGNATURE OF ITS MEANING — sign('optimization') =
   *  be92e94aba0be148ec1f142becadb01480a3c633ed6e675d98945416a5a3d24d —
   *  never a human label (typed __folders__ are banned; see
   *  documentation/sign-meaning-pool-migration-plan.md). The address is
   *  derived by convention — sha256 of the UTF-8 bytes of
   *  OPTIMIZATION_MEANING — so any tier (the swarm's publish firewall,
   *  tooling, a peer) computes the identical pool address with no
   *  registry. The legacy `__optimization__` folder is a migration
   *  source only: absorbed into the pool and deleted on boot, with
   *  dual-reads until it is gone. */
  public static readonly OPTIMIZATION_MEANING = 'optimization'
  public static readonly LEGACY_OPTIMIZATION_DIRECTORY = '__optimization__'

  private static readonly CACHE_NAME = 'hypercomb-modules-v2'

  /** How long after init the content self-clean waits before draining
   *  legacy folders — clear of first paint and the warmup walk. */
  static readonly #SELF_CLEAN_DELAY_MS = 20_000

  public opfsRoot!: FileSystemDirectoryHandle
  /** The user-content root IS the OPFS root (assigned `= opfsRoot` in
   *  `#doInit`). Content sig files, lineage sigbags and sign(meaning)
   *  pools all live directly at the root. The property survives so
   *  `store.hypercombRoot` consumers are untouched. */
  public hypercombRoot!: FileSystemDirectoryHandle
  /** sign('bees') pool — sig-named bee bundles. */
  public bees!: FileSystemDirectoryHandle
  /** sign('dependencies') pool — sig-named dependency bundles (alias in
   *  each file's first-line comment, as before). */
  public dependencies!: FileSystemDirectoryHandle
  /** sign('clipboard') pool — participant-local clipboard records. */
  public clipboard!: FileSystemDirectoryHandle
  /** sign('threads') pool — thread state. */
  public threads!: FileSystemDirectoryHandle
  /** sign('computation') pool — compute receipts. */
  public computation!: FileSystemDirectoryHandle
  /** sign('manifests') pool — children manifests keyed by parent layer sig. */
  public manifests!: FileSystemDirectoryHandle
  /** sign('optimization') pool — decoration substrate records. */
  public optimization!: FileSystemDirectoryHandle
  /** sign('overrides') pool — i18n override layer (`i18n.json` member). */
  public overrides!: FileSystemDirectoryHandle
  /** sign('translations') pool — per-locale translation cache. */
  public translations!: FileSystemDirectoryHandle

  // ---- Legacy drain sources. Opened WITHOUT create (undefined when
  // ---- absent or already drained); read-fallback only, never written.
  /** Legacy `__hive__/` content root (the brief-lived rename of the
   *  user-content root). Content reads fall back here after the flat
   *  root misses; lineage readers union its bags with the root's
   *  (highest marker wins). Drained by `/consolidate-content`. */
  public legacyHive?: FileSystemDirectoryHandle
  /** Legacy `hypercomb.io/` content root (pre-`__hive__`). Same
   *  fallback + drain lifecycle as `legacyHive` — rescues any tree
   *  stranded by the earlier root renames. */
  public legacyHypercombIo?: FileSystemDirectoryHandle
  /** Legacy `__layers__` pool. Read-fallback after the flat root misses.
   *  May retain per-domain manifest subdirs that defer its GC. */
  public layers?: FileSystemDirectoryHandle
  /** Legacy `__resources__` pool. Read-fallback after the flat root
   *  misses (see `#readContentFile`). */
  public resources?: FileSystemDirectoryHandle
  /** Legacy `__history__` pool. Lineage sigbags live at the root now;
   *  history reads fall through via the dual-resolver and
   *  `gcLegacyHistory` drains it. */
  public history?: FileSystemDirectoryHandle
  public legacyBees?: FileSystemDirectoryHandle
  public legacyDependencies?: FileSystemDirectoryHandle
  public legacyClipboard?: FileSystemDirectoryHandle
  public legacyThreads?: FileSystemDirectoryHandle
  public legacyComputation?: FileSystemDirectoryHandle
  /** Legacy `__optimized__` layer-bytes mirror. Read-fallback only. */
  public optimized?: FileSystemDirectoryHandle
  public legacyManifests?: FileSystemDirectoryHandle
  #legacyOptimization?: FileSystemDirectoryHandle
  /** Legacy non-signed i18n `overrides/` and `translations/` dirs.
   *  Read-fallback + absorb source only. */
  public legacyOverrides?: FileSystemDirectoryHandle
  public legacyTranslations?: FileSystemDirectoryHandle

  /** sign(meaning) → pool address: sha256 of the UTF-8 bytes of the
   *  meaning string, memoized. The derivation IS the address — any tier
   *  computes the identical one.
   *
   *  Deriving also REGISTERS the meaning in the core pool registry.
   *  Pools and lineage sigbags share one flat OPFS root namespace and a
   *  bare-word meaning hashes to exactly the same address as a same-named
   *  root tile, so every walker of the root needs to be able to tell the
   *  two apart — and only the registry can answer, since any module may
   *  mint a pool. Registering here means addressing a pool is enough; no
   *  caller has to remember to declare it. */
  public static poolSignature = (meaning: string): Promise<string> =>
    registerPoolMeaning(meaning)

  /** Open (creating if needed) the pool dir for a meaning — for IoC
   *  consumers that need a pool Store doesn't pre-open. Null when OPFS
   *  is unavailable. */
  public getPool = async (meaning: string): Promise<FileSystemDirectoryHandle | null> => {
    if (!this.#opfsAvailable) return null
    try {
      return await this.opfsRoot.getDirectoryHandle(await Store.poolSignature(meaning), { create: true })
    } catch { return null }
  }

  // -------------------------------------------------
  // content-addressed document pools
  // -------------------------------------------------
  //
  // A "document pool" holds a single CURRENT mutable document as a member
  // named by sign(its bytes) — never a human filename. Config that used
  // to live under a fixed label (`overrides/i18n.json`, `translations/
  // <locale>.json`) is content-addressed like everything else: the
  // signature IS the address, identical content dedupes, and a stale
  // reader can't be poisoned by a name. Editing the document writes a new
  // sig member and drops the old one, so the pool holds exactly one. An
  // optional `subKey` selects a sign(subKey) sub-bucket so one pool can
  // hold several independent documents (translations keys by locale).

  /** Write `bytes` as the current member of a document pool: sign the
   *  bytes, write `<pool>[/<sign(subKey)>]/<sign(bytes)>`, then remove
   *  every other sig-named member so exactly one current document
   *  remains. New member is fully written BEFORE the old is dropped, so
   *  a concurrent read never sees zero members. Returns the content sig,
   *  or null on failure. */
  public putPoolDoc = async (
    pool: FileSystemDirectoryHandle,
    bytes: ArrayBuffer,
    subKey?: string,
  ): Promise<string | null> => {
    try {
      const target = subKey
        ? await pool.getDirectoryHandle(await Store.poolSignature(subKey), { create: true })
        : pool
      const sig = await SignatureService.sign(bytes)
      const handle = await target.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
      // Drop prior document members only — FILES named by a sig. The
      // `kind === 'file'` guard keeps a mixed pool safe: sign(subKey)
      // sub-bucket dirs are also 64-hex, and must never be removed here.
      for await (const [name, h] of (target as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (h.kind === 'file' && name !== sig && isSignature(name)) {
          try { await target.removeEntry(name) } catch { /* raced; harmless */ }
        }
      }
      return sig
    } catch { return null }
  }

  /** Read the current member of a document pool. Enumerates
   *  `<pool>[/<sign(subKey)>]` and returns the (single) sig-named
   *  member's bytes, or null when the pool/sub-bucket is absent or empty. */
  public getPoolDoc = async (
    pool: FileSystemDirectoryHandle | undefined,
    subKey?: string,
  ): Promise<ArrayBuffer | null> => {
    if (!pool) return null
    try {
      const target = subKey
        ? await pool.getDirectoryHandle(await Store.poolSignature(subKey), { create: false })
        : pool
      for await (const [name, handle] of (target as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file' || !isSignature(name)) continue
        const file = await (handle as FileSystemFileHandle).getFile()
        if (file.size > 0) return await file.arrayBuffer()
      }
      return null
    } catch { return null }
  }

  #initPromise: Promise<void> | null = null
  #opfsAvailable = true

  /** False when Chrome's OPFS state is wedged (timeout or InvalidStateError
   *  during init). Boot continues without persistence so the app doesn't
   *  go blank — user can fix by restarting the browser. */
  get opfsAvailable(): boolean { return this.#opfsAvailable }

  // -------------------------------------------------
  // init
  // -------------------------------------------------

  public initialize = (): Promise<void> => {
    return this.#initPromise ??= this.#doInit()
  }

  #doInit = async (): Promise<void> => {
    try {
      this.opfsRoot = await Promise.race([
        navigator.storage.getDirectory(),
        // A cold or busy OPFS (Chrome initialises it lazily; the heavier
        // pool/migration boot below adds contention) can take several seconds
        // to hand back the root. A 3s cap abandoned a slow-but-working OPFS
        // into no-persistence mode, silently dropping every write for the
        // session — creating a tile "did nothing" because nothing was saved.
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OPFS timed out')), 10_000)
        )
      ])
    } catch (err) {
      console.warn('[store] OPFS root unavailable — running without persistent storage', err)
      this.#opfsAvailable = false
      // Recoverable: clearing the memoised init lets the NEXT initialize()
      // re-attempt instead of leaving the store dead (no persistence) for the
      // whole session. A single transient timeout must not permanently disable
      // saving — the previous behaviour meant one slow boot = every subsequent
      // tile create silently lost until a full page reload.
      this.#initPromise = null
      return
    }

    // Pool-of-meaning addresses are DERIVED, never registered: sha256
    // of the UTF-8 bytes of the meaning string (see `poolSignature`).
    // No typed folder is ever created — the only dirs this init makes
    // are sign(meaning) pools at the root.
    const pool = async (meaning: string) =>
      this.opfsRoot.getDirectoryHandle(await Store.poolSignature(meaning), { create: true })
    // Legacy `__x__`/`hypercomb.io` drain sources: opened WITHOUT create
    // so a drained dir stays gone (create:true would resurrect it empty
    // every boot). Absent → undefined; every reader tolerates that.
    const legacy = async (name: string) => {
      try { return await this.opfsRoot.getDirectoryHandle(name) } catch { return undefined }
    }

    try {
      // The user-content root IS the OPFS root. Root inventory: sig
      // files (content bytes), sig dirs (lineage sigbags), sign(meaning)
      // dirs (pools) — plus, until drained, the legacy sources below.
      this.hypercombRoot = this.opfsRoot
      ;[
        this.bees,
        this.dependencies,
        this.clipboard,
        this.threads,
        this.computation,
        this.manifests,
        this.optimization,
        this.overrides,
        this.translations,
      ] = await Promise.all([
        pool(Store.BEES_MEANING),
        pool(Store.DEPENDENCIES_MEANING),
        pool(Store.CLIPBOARD_MEANING),
        pool(Store.THREADS_MEANING),
        pool(Store.COMPUTATION_MEANING),
        pool(Store.MANIFESTS_MEANING),
        pool(Store.OPTIMIZATION_MEANING),
        pool(Store.OVERRIDES_MEANING),
        pool(Store.TRANSLATIONS_MEANING),
      ])
      ;[
        this.legacyHive,
        this.legacyHypercombIo,
        this.layers,
        this.resources,
        this.history,
        this.legacyBees,
        this.legacyDependencies,
        this.legacyClipboard,
        this.legacyThreads,
        this.legacyComputation,
        this.optimized,
        this.legacyManifests,
        this.#legacyOptimization,
        this.legacyOverrides,
        this.legacyTranslations,
      ] = await Promise.all([
        legacy(Store.LEGACY_HIVE_DIRECTORY),
        legacy(Store.LEGACY_HYPERCOMB_IO_DIRECTORY),
        legacy(Store.LEGACY_LAYERS_DIRECTORY),
        legacy(Store.LEGACY_RESOURCES_DIRECTORY),
        legacy(Store.LEGACY_HISTORY_DIRECTORY),
        legacy(Store.LEGACY_BEES_DIRECTORY),
        legacy(Store.LEGACY_DEPENDENCIES_DIRECTORY),
        legacy(Store.LEGACY_CLIPBOARD_DIRECTORY),
        legacy(Store.LEGACY_THREADS_DIRECTORY),
        legacy(Store.LEGACY_COMPUTATION_DIRECTORY),
        legacy(Store.LEGACY_OPTIMIZED_DIRECTORY),
        legacy(Store.LEGACY_MANIFESTS_DIRECTORY),
        legacy(Store.LEGACY_OPTIMIZATION_DIRECTORY),
        legacy(Store.LEGACY_OVERRIDES_DIRECTORY),
        legacy(Store.LEGACY_TRANSLATIONS_DIRECTORY),
      ])
      // Bounded absorbs, detached from the boot path: small RECORD
      // pools drain copy→remove per record into their sign(meaning)
      // pool, with a non-recursive final removeEntry that only succeeds
      // once the dir is empty (stragglers survive to a later boot).
      // Reads stay correct meanwhile via each pool's dual-read fallback.
      // DEFERRED off the boot path (like the content self-clean below): a
      // bare `void` still starts the absorb on the very next microtask, so
      // its per-record copy→remove OPFS churn ran DURING first paint and
      // contended with the render's own head/child reads — on a bloated
      // tree that turned a ~4ms head-layer read into multiple seconds
      // (measured 4.6s vs 4ms idle). First paint must touch only the
      // current pool → children handful; this bulk drain waits until after,
      // reads dual-fallback to the legacy source meanwhile.
      setTimeout(() => { void this.#absorbLegacyRecordPools() }, Store.#SELF_CLEAN_DELAY_MS)
      // SELF-CLEANING: when legacy CONTENT sources are found
      // (`__resources__`, `__layers__`, `__optimized__`, `__hive__`,
      // `hypercomb.io/`), migrate everything to the signed locations
      // and remove the orphaned folders — automatically. DELAYED and
      // detached so it never competes with first paint or the warmup
      // walk; the 0-byte incomplete-write guard in `#readContentFile`
      // keeps a concurrent read falling through to wherever the
      // COMPLETE bytes live while a copy is mid-flight. Idempotent and
      // resumable; every source is removed only via the gated
      // fully-drained check. `/consolidate-content` remains as a
      // manual force-run of the same pass.
      if (this.legacyHive || this.legacyHypercombIo || this.layers ||
          this.resources || this.optimized) {
        setTimeout(() => { void this.migrateContentPoolToRoot() }, Store.#SELF_CLEAN_DELAY_MS)
      }
    } catch (err) {
      console.warn('[store] OPFS subdirectory init failed — running without persistent storage', err)
      this.#opfsAvailable = false
      // Same recovery as the root-init catch: allow a later initialize() to
      // retry rather than leaving the store dead for the session.
      this.#initPromise = null
    }
    // The content self-clean is DELAYED (see #SELF_CLEAN_DELAY_MS), not
    // run inline here: a whole-pool enumerate-and-copy during boot
    // hammers single-threaded OPFS ahead of first paint. The render
    // race a relocation copy could cause (a 0-byte target landing
    // before its bytes) is neutralized by `#readContentFile`'s
    // incomplete-write guard — a concurrent read falls through to the
    // source that still holds the complete bytes. Steady state costs
    // nothing: once the legacy sources are drained and removed, their
    // handles come up undefined and the self-clean never schedules.
  }

  // All layers live flat at the root (`<root>/<sig>`) regardless of
  // source (boot install, sentinel sync, user commit, peer pull). Sig
  // identity makes per-domain partitioning unnecessary — same content
  // gets the same address from anywhere. `store.layers` survives only
  // as the legacy read-fallback handle.

  // -------------------------------------------------
  // bee loader
  // -------------------------------------------------

  public getBee = async (
    signature: string,
    buffer: ArrayBuffer
  ): Promise<Bee | null> => {

    const tryImport = async (url: string): Promise<Record<string, unknown> | null> => {
      try {
        const mod = await import(/* @vite-ignore */ url)
        return mod as any
      } catch (err) {
        console.log(`[store] failed to import ${url}:`, err)
        return null
      }
    }

    // Bee modules come in two shapes: processor bees (Drone/Worker
    // subclasses with pulse) and EventTarget UI drones (command palette,
    // toast, notes — constructor-wired, NO pulse method). Both are
    // legitimate module products; the preloader skips pulse on entries
    // that lack it. Pulse-having instances are preferred when one module
    // registers several values (e.g. a service plus its drone).
    const hasPulse = (v: unknown): boolean =>
      !!v && typeof v === 'object' && typeof (v as any).pulse === 'function'
    const isInstance = (v: unknown): boolean =>
      !!v && typeof v === 'object'

    // Track IoC registrations that happen as side effects of THIS import.
    // Bee modules self-register at module scope (`register(key, new X())`),
    // so the captured instance is ground truth for "which singleton did
    // this module produce". Class-identity scans alone break when two
    // modules declare same-named classes, or when a module registers its
    // instance without exporting the class at all (then `mod` has no
    // exports to match and the old path returned null for a bee that
    // loaded fine).
    const captured: unknown[] = []
    const unhook = window.ioc.onRegister?.((_key: string, value: unknown) => {
      captured.push(value)
    })

    try {

      let mod: Record<string, unknown> | null = null

      // Import directly from the verified buffer via blob URL.
      // This bypasses the service worker entirely — no /opfs/ round-trip,
      // no cache seeding, no dependency on SW controlling the page.
      const blob = new Blob([buffer], { type: 'application/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      try {
        mod = await tryImport(blobUrl)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }

      if (!mod || typeof mod !== 'object') return null

      const exportedCtors = new Set<unknown>()
      for (const value of Object.values(mod)) {
        if (typeof value === 'function' && (value as any).prototype) {
          exportedCtors.add(value)
        }
      }

      // 1) Self-registration during import. When the module exports its
      //    class, require constructor identity so a concurrent load's
      //    registration can't be mistaken for ours (bee loads run under
      //    Promise.allSettled). A module with no class exports can't be
      //    identity-checked — take the latest captured instance as best
      //    effort. Two passes: pulse-having instances win over plain
      //    EventTarget drones/services registered by the same module.
      const capturedMatch = (wantPulse: boolean): Bee | null => {
        for (let i = captured.length - 1; i >= 0; i--) {
          const candidate = captured[i]
          if (!isInstance(candidate)) continue
          if (wantPulse && !hasPulse(candidate)) continue
          if (exportedCtors.size === 0 || exportedCtors.has((candidate as any).constructor)) {
            return candidate as Bee
          }
        }
        return null
      }
      const fromCapture = capturedMatch(true) ?? capturedMatch(false)
      if (fromCapture) return fromCapture

      // 2) Class-identity scan over IoC — covers a re-evaluation of a
      //    module whose instance registered on an earlier import (the
      //    register call is first-wins/no-op, so nothing is captured).
      //    Pulse-less UI drones match too — same two-pass preference.
      if (exportedCtors.size > 0) {
        let plainMatch: Bee | null = null
        for (const key of window.ioc.list()) {
          const candidate = window.ioc.get(key) as any
          if (!isInstance(candidate)) continue
          if (!exportedCtors.has(candidate.constructor)) continue
          if (hasPulse(candidate)) return candidate as Bee
          plainMatch = plainMatch ?? (candidate as Bee)
        }
        if (plainMatch) return plainMatch
      }

      // 3) Nothing captured and nothing matched. DO NOT construct an
      //    instance from the exports: bee modules self-register at module
      //    scope, so reaching here means this bundle's registrations were
      //    all rejected (first-wins — the logical drone is already alive
      //    under another generation's sig, and IoC disposed this bundle's
      //    ghost). Manufacturing a fresh instance here created a SECOND
      //    live drone that got pulsed and fought the canonical one over
      //    the canvas (tiles rendered, then the duplicate's pass tore
      //    them down). Null is the truthful answer: this sig is
      //    superseded; the preloader skips it.
      return null
    } catch {
      return null
    } finally {
      unhook?.()
    }
  }

  private cellResourceCache = async (
    signature: string,
    buffer: ArrayBuffer
  ): Promise<void> => {

    // Cache key under the sign('bees') pool address — the same derived
    // path shape the OPFS layout uses; never a typed folder name.
    const opfsUrl =
      new URL(`/opfs/${await Store.poolSignature(Store.BEES_MEANING)}/${signature}.js`, location.origin).toString()

    try {
      const cache = await caches.open(Store.CACHE_NAME)
      const existing = await cache.match(opfsUrl)
      if (!existing) {
        await cache.put(opfsUrl, new Response(buffer, { headers: this.jsImmutableHeaders() }))
      }
    } catch {
      // ignore
    }
  }

  private jsImmutableHeaders = (): Headers => {
    const h = new Headers()
    h.set('content-type', 'application/javascript')
    // sig-addressed bee: content can never change under this signature
    h.set('cache-control', 'public, max-age=31536000, immutable')
    return h
  }

  // -------------------------------------------------
  // content-addressed resource storage — sig files at the flat root
  // -------------------------------------------------

  public putResource = async (blob: Blob, options?: { emit?: boolean }): Promise<string> => {
    const bytes = await blob.arrayBuffer()
    const signature = await SignatureService.sign(bytes)
    // Content-addressed: same sig ⇒ same bytes, so if the file already
    // exists we're done. This is not just an optimisation — creating a
    // writable against an existing OPFS file and closing it atomically
    // replaces the underlying file, which invalidates every Blob that
    // was previously returned from handle.getFile() for that sig.
    // Subsequent reads on those cached Blobs throw NotReadableError
    // ("reference to a file acquired"), caches fall back to null, and
    // the tile renders blank with no indication why. Skipping the
    // rewrite keeps cached Blobs valid for their lifetime.
    try {
      // Resources write to the flat root (`<root>/<sig>`), never a
      // legacy typed pool. The existence/complete check below targets
      // the same root file we'll write, so the cached-Blob and
      // 0-byte-corruption guarantees still hold for the canonical location.
      const existing = await this.hypercombRoot.getFileHandle(signature)
      // "Exists" must also mean "complete". getFileHandle({create:true})
      // below creates a 0-byte target BEFORE the write; if the write/close
      // is interrupted (reload, crash, navigation — the lingering .crswap
      // swap files are the fingerprint) the file stays empty. The old
      // early-return then locked that corruption in forever: every retry
      // saw the file "exists" and skipped the rewrite, so the store served
      // 0 bytes for this sig to render AND to host-sync (which PUT empty
      // bytes → 422 on every drain). A content-addressed file whose size
      // differs from the incoming bytes is definitively corrupt — a valid
      // file's bytes hash to this exact sig — so overwriting is safe, and
      // it cannot invalidate a live cached Blob (none was ever derived from
      // a short file). Matching size ⇒ complete: keep the cached-Blob-safe
      // skip the comment below describes.
      if ((await existing.getFile()).size === bytes.byteLength) {
        // Complete file already on disk. Seed the memory cache too (see
        // below) so a reader right after this put never pays an OPFS hop.
        this.#resourceCache.set(signature, new Blob([bytes], { type: blob.type }))
        return signature
      }
    } catch { /* fall through and create */ }
    const handle = await this.hypercombRoot.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
    } finally {
      await writable.close()
    }
    // Seed the in-memory cache with a DETACHED copy of the bytes we just
    // wrote. The layer commit path already hot-caches its bytes; the
    // resource path did not, so every read of a freshly-put resource fell
    // through to an OPFS round-trip — the just-committed props blob a move
    // writes is read back on the very next render, and that read-after-
    // write hop widened the window for the nurse in-flight-read race. A
    // memory hit makes the read instant and timing-independent. Detached
    // (own ArrayBuffer, not the input blob) so it can't be invalidated by
    // a later writable against the same sig (see the cached-Blob caveat
    // above in this method).
    this.#resourceCache.set(signature, new Blob([bytes], { type: blob.type }))
    // Mirror up to DCP. PushQueueService (in essentials) subscribes to
    // `content:wrote` and queues the bytes for sentinel intake. Going
    // through EffectBus avoids a shared→essentials import.
    //
    // Suppressed (emit: false) for cache-fill writes — bytes pulled FROM a
    // host via getResource's cold-miss fallback must NOT echo back into
    // HostSync/PushQueue as if we authored them. Only genuine local
    // authoring emits.
    if (options?.emit !== false) {
      EffectBus.emit('content:wrote', { sig: signature, kind: 'resource' as const, bytes })
    }
    return signature
  }

  readonly #resourceCache = new Map<string, Blob>()
  readonly #resourcePending = new Map<string, Promise<Blob | null>>()
  readonly #hostFetchPending = new Map<string, Promise<Blob | null>>()
  // Host-miss NEGATIVE cache (egg semantics): a sig the cascade could not
  // resolve is "not yet delivered", and re-dialing the network for it on
  // every render pass turned one missing image into a per-synchronize
  // fetch storm (~175ms × N tiles × every pass — measured). A miss is
  // remembered for a TTL and the host step returns null instantly during
  // that window; local arrival bypasses this entirely (memory/OPFS are
  // checked first), and the TTL keeps the egg retryable — "not yet
  // delivered", never "failed".
  readonly #hostFetchMissUntil = new Map<string, number>()

  /**
   * Local-only resource read: in-memory cache → OPFS. Never touches the
   * network. This is the pure-local primitive the content broker uses for
   * its fast-path / responder lookup — it MUST NOT trigger the host
   * fallback, or the broker re-enters getResource and deadlocks:
   *   getResource → #fetchResourceFromHost → broker.fetchBySig
   *     → #readLocal → getResource → (coalesced) awaits its own pending fetch.
   */
  /** Sigs already handed to the host-sync queue this session (dedupe —
   *  receipts make staging idempotent anyway; this just avoids re-resolving
   *  the service on every cache hit). */
  #stagedToHost = new Set<string>()

  /** Read-triggered staging: a tab that HOLDS the bytes (the author) hands
   *  them to HostSyncService so the participant's own host (self-domain)
   *  serves them — signed NIP-98 PUT, durable OPFS queue, confirmed
   *  read-back receipts. This is the byte-path's PUSH half for content the
   *  author reads (warmup walk, cache hits) rather than writes — `content:
   *  wrote` covers fresh authoring; this covers everything that predates it.
   *  The app NEVER dials localhost or any host other than the configured
   *  self-domain: with host-sync disabled (the default) this is a no-op and
   *  the staging functionality is simply absent. Resolved via IoC so shared
   *  never imports essentials. */
  // Staging RATE LIMITER. Read-triggered staging fires on every local read,
  // and background warm sweeps read THOUSANDS of sigs in bursts — each
  // enqueue is a durable-queue OPFS WRITE plus a full byte copy, and a burst
  // of them starves the single OPFS service queue (measured: multi-second
  // render stalls during navigation while a warm swept, plus a per-sig probe
  // storm against an unhealthy host). Cap enqueues per window; sigs over
  // budget are NOT marked, so a later read stages them once the bucket
  // refills — staging trickles across the session instead of bursting.
  // Instant-click doctrine: a read must never carry more than O(1) cheap
  // side-effect work.
  #stageWindowStart = 0
  #stageWindowCount = 0
  static readonly #STAGE_MAX_PER_WINDOW = 3
  static readonly #STAGE_WINDOW_MS = 1000

  #stageToHost(signature: string, kind: 'resource' | 'layer', data: Blob | Uint8Array): void {
    try {
      if (this.#stagedToHost.has(signature)) return
      const hostSync = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(
        '@diamondcoreprocessor.com/HostSyncService',
      ) as { isEnabled?: () => boolean; enqueue?: (sig: string, kind: string, bytes: ArrayBuffer) => Promise<void> } | undefined
      if (!hostSync?.isEnabled?.() || !hostSync.enqueue) return
      const now = Date.now()
      if (now - this.#stageWindowStart >= Store.#STAGE_WINDOW_MS) {
        this.#stageWindowStart = now
        this.#stageWindowCount = 0
      }
      if (this.#stageWindowCount >= Store.#STAGE_MAX_PER_WINDOW) return  // over budget — a later read stages it
      this.#stageWindowCount++
      this.#stagedToHost.add(signature)
      void (async () => {
        try {
          const bytes = data instanceof Blob
            ? await data.arrayBuffer()
            : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
          await hostSync.enqueue!(signature, kind, bytes)
        } catch {
          // KEEP the mark. Receipts make staging idempotent across sessions,
          // and un-marking here re-armed every failed sig on its next read —
          // against an unhealthy host that became a perpetual re-stage storm
          // (thousands of enqueue retries riding every warm sweep).
        }
      })()
    } catch { /* non-fatal */ }
  }

  public getResourceLocal = async (signature: string): Promise<Blob | null> => {
    const cached = this.#resourceCache.get(signature)
    if (cached) { this.#stageToHost(signature, 'resource', cached); return cached }
    const blob = await this.#loadResource(signature)
    if (blob) this.#stageToHost(signature, 'resource', blob)
    return blob
  }

  public getResource = async (signature: string): Promise<Blob | null> => {
    // Hot path: memory → OPFS (getResourceLocal). The host fetch is a
    // STRICT fallback after a local miss — never reorder it ahead of the
    // local read, or the warm case (we already have the bytes) pays a
    // network round-trip it shouldn't. Ordering is the contract:
    // memory → OPFS → host.
    const local = await this.getResourceLocal(signature)
    if (local) return local
    return this.#fetchResourceFromHost(signature)
  }

  /** Prefetch a resource into the in-memory cache. Safe to call concurrently
   *  for the same signature — in-flight loads are deduped. */
  public preheatResource = async (signature: string): Promise<Blob | null> =>
    this.getResource(signature)

  /**
   * Cold-miss fallback for getResource: resolve the bytes from a host via
   * the content broker (essentials), then silently write them through to
   * OPFS so the next read is a local hit — and offline-safe. The broker
   * verifies sha256 before returning, so the bytes are guaranteed to match
   * `signature`; OPFS becomes a cache of the host's flat sig directory
   * rather than the sole source.
   *
   * Resolved through window.ioc, NOT an import: Store lives in shared and
   * must never import essentials. Same runtime-IoC pattern the rest of
   * shared already uses (controls-bar → ViewportPersistence; the bee scan
   * above at L241). Inert when no broker is registered or no host domains
   * are configured — returns null, exactly today's miss behavior, so a
   * solo/offline participant is unaffected.
   *
   * Concurrent callers coalesce on #hostFetchPending; the broker also
   * coalesces its own fetches, so a double-miss never double-fetches.
   */
  /** Effective negative-cache expiry for a sig: the LATER of Store's own
   *  fixed window and the broker's exponential-backoff window (missUntil).
   *  Store's fixed HOST_MISS_TTL_MS re-dialed every 60s even after the
   *  broker had backed a dead sig off to minutes — the two caches never
   *  talked. Resolved via IoC, optional-chained: with no broker registered
   *  Store's own window is the sole authority, exactly as before. */
  #effectiveMissUntil(signature: string, own: number | undefined): number {
    let until = own ?? 0
    try {
      const broker = (window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')) as
        | { missUntil?: (sig: string) => number }
        | undefined
      const brokerUntil = broker?.missUntil?.(signature) ?? 0
      if (brokerUntil > until) until = brokerUntil
    } catch { /* no ioc — own window only */ }
    return until
  }

  #fetchResourceFromHost = (signature: string): Promise<Blob | null> => {
    const existing = this.#hostFetchPending.get(signature)
    if (existing) return existing
    // Within a miss window → answer null instantly, no network. The egg
    // re-tries when the window lapses (or the bytes arrive locally first).
    // The window is the LATER of Store's own and the broker's backoff.
    const missUntil = this.#effectiveMissUntil(signature, this.#hostFetchMissUntil.get(signature))
    if (missUntil) {
      if (Date.now() < missUntil) return Promise.resolve(null)
      this.#hostFetchMissUntil.delete(signature)
    }
    const promise = (async (): Promise<Blob | null> => {
      try {
        const broker = (window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')) as
          | { fetchBySig?: (sig: string, type: string, timeoutMs?: number) => Promise<Uint8Array | null> }
          | undefined
        const bytes = await broker?.fetchBySig?.(signature, 'resource')
        if (!bytes || bytes.byteLength === 0) {
          this.#hostFetchMissUntil.set(signature, Date.now() + HOST_MISS_TTL_MS)
          return null
        }
        // Copy into a fresh ArrayBuffer-backed view: TS 5.9's BlobPart
        // excludes Uint8Array<ArrayBufferLike> (SharedArrayBuffer guard).
        // Negligible vs the network fetch we just did.
        const blob = new Blob([new Uint8Array(bytes)])
        this.#resourceCache.set(signature, blob)
        // Silent write-through: persist for offline + future local hits
        // WITHOUT the content:wrote echo (these are someone else's bytes).
        try { await this.putResource(blob, { emit: false }) } catch { /* cache-only is acceptable */ }
        return blob
      } catch {
        this.#hostFetchMissUntil.set(signature, Date.now() + HOST_MISS_TTL_MS)
        return null
      } finally {
        this.#hostFetchPending.delete(signature)
      }
    })()
    this.#hostFetchPending.set(signature, promise)
    return promise
  }

  readonly #layerHostFetchPending = new Map<string, Promise<Uint8Array | null>>()
  readonly #layerHostMissUntil = new Map<string, number>()

  /**
   * Detached self-heal for LAYER bytes — the layer-side mirror of
   * #fetchResourceFromHost. Resources always healed through the broker on
   * a local miss; layers did NOT, so a shared/adopted subtree whose layer
   * closure never fully landed stayed unresolvable forever (the render's
   * completeness gate exhausted and dropped its tiles for the session).
   * Same contract as the resource path: the broker verifies sha256 before
   * returning, misses are negative-cached for HOST_MISS_TTL_MS ("not yet
   * delivered", never "failed"), and concurrent callers coalesce. Arrival
   * is written through to the OPFS root and announced on the EffectBus
   * (`content:arrived`) so gated renders can retry. Callers must NOT
   * await this on a render path — render never awaits network.
   */
  public fetchLayerFromHost = (signature: string): Promise<Uint8Array | null> => {
    const existing = this.#layerHostFetchPending.get(signature)
    if (existing) return existing
    // LATER of Store's own window and the broker's backoff — see
    // #effectiveMissUntil.
    const missUntil = this.#effectiveMissUntil(signature, this.#layerHostMissUntil.get(signature))
    if (missUntil) {
      if (Date.now() < missUntil) return Promise.resolve(null)
      this.#layerHostMissUntil.delete(signature)
    }
    const promise = (async (): Promise<Uint8Array | null> => {
      try {
        const broker = (window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')) as
          | { fetchBySig?: (sig: string, type: string, timeoutMs?: number) => Promise<Uint8Array | null> }
          | undefined
        const bytes = await broker?.fetchBySig?.(signature, 'layer')
        if (!bytes || bytes.byteLength === 0) {
          this.#layerHostMissUntil.set(signature, Date.now() + HOST_MISS_TTL_MS)
          return null
        }
        const copy = new Uint8Array(bytes)
        this.#layerBytesCache.set(signature, copy)
        // Silent write-through: persist for offline + future local hits.
        // Someone else's bytes — no content:wrote echo back into the
        // push/host-sync queues.
        try { await this.writeLayerBytes(signature, copy.buffer as ArrayBuffer) } catch { /* cache-only is acceptable */ }
        EffectBus.emit('content:arrived', { sig: signature, kind: 'layer' as const })
        return copy
      } catch {
        this.#layerHostMissUntil.set(signature, Date.now() + HOST_MISS_TTL_MS)
        return null
      } finally {
        this.#layerHostFetchPending.delete(signature)
      }
    })()
    this.#layerHostFetchPending.set(signature, promise)
    return promise
  }

  // -------------------------------------------------
  // persistent decoration substrate — the sign('optimization') pool
  // -------------------------------------------------
  //
  // Holds optimization objects (Q&A, comms, future kinds) outside the
  // layer. Content-addressed members in a pool whose ADDRESS is itself
  // the signature of its meaning — identical content dedupes, and the
  // pool is derivable by convention (no registry). The state-machine
  // wrappers around base objects read from here at access time; the
  // layer-commit primitive never sees this pool. Legacy
  // `__optimization__` records dual-read until the boot absorb has
  // drained and deleted that folder.

  public putOptimization = async (blob: Blob, options?: { emit?: boolean }): Promise<string> => {
    if (!this.optimization) throw new Error('optimization dir not initialized')
    const bytes = await blob.arrayBuffer()
    const signature = await SignatureService.sign(bytes)
    try {
      await this.optimization.getFileHandle(signature)
      return signature
    } catch { /* not present — create */ }
    const handle = await this.optimization.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(blob) } finally { await writable.close() }
    // Mirror the loop's cross-OPFS records onto the durable feedback channel.
    // FeedbackChannelDrone (essentials) subscribes to `optimization:wrote`;
    // routing through EffectBus avoids a shared→essentials import — the same
    // pattern putResource uses for `content:wrote`. Only feedback/qa/qa-answer
    // cross to a routine in another OPFS; routine-local bookkeeping
    // (feedback-seen, notes-digest) stays put. Suppressed (emit:false) for
    // channel INGEST writes so a pulled item never echoes straight back out.
    if (options?.emit !== false && Store.#isSyncableOptimization(bytes)) {
      EffectBus.emit('optimization:wrote', { sig: signature, bytes })
    }
    return signature
  }

  /** Optimization kinds that must reach a feedback-loop routine in another
   *  OPFS (see documentation/feedback-channel.md). Bookkeeping kinds
   *  (feedback-seen, notes-digest) belong to whoever owns them and never
   *  publish. */
  static readonly #SYNCABLE_OPTIMIZATION_KINDS = new Set(['feedback', 'qa', 'qa-answer'])
  static readonly #isSyncableOptimization = (bytes: ArrayBuffer): boolean => {
    try {
      const rec = JSON.parse(new TextDecoder().decode(bytes)) as { kind?: unknown }
      return typeof rec?.kind === 'string' && Store.#SYNCABLE_OPTIMIZATION_KINDS.has(rec.kind)
    } catch { return false }
  }

  public getOptimization = async (signature: string): Promise<Blob | null> => {
    if (!this.optimization) return null
    try {
      const handle = await this.optimization.getFileHandle(signature)
      return await handle.getFile()
    } catch { /* miss — fall through to the legacy migration source */ }
    if (!this.#legacyOptimization) return null
    try {
      const handle = await this.#legacyOptimization.getFileHandle(signature)
      return await handle.getFile()
    } catch { return null }
  }

  // ── Optimized-visual cache ─────────────────────────────────────────
  // A tile's visual is stored at its ORIGINAL resolution. The atlas resizes
  // it down to the cell on every COLD load, and `createImageBitmap` of a
  // large original is the dominant first-paint image cost (measured
  // 486–665ms per image on a bloated boot). This pool caches the
  // already-resized, re-encoded form keyed by the SOURCE image sig, so the
  // NEXT session decodes a small image instead of the full original —
  // "optimized after first load". Pure derived cache: recomputable and safe
  // to GC; a miss just re-optimizes from the raw. Keyed by source sig (not
  // content hash) because the whole point is O(1) lookup FROM the source.
  public static readonly VISUAL_OPTIMIZATION_MEANING = 'visual-optimization'
  #visualOptimPool?: FileSystemDirectoryHandle
  // Matches HexImageAtlas's own resize target (cellPx 256 × 2). Storing at
  // this size means the atlas never re-resizes the optimized form.
  static readonly #VISUAL_OPTIM_TARGET = 512

  #visualOptimDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (this.#visualOptimPool) return this.#visualOptimPool
    const pool = await this.getPool(Store.VISUAL_OPTIMIZATION_MEANING)
    if (pool) this.#visualOptimPool = pool
    return pool
  }

  /** The cached cell-sized visual for a source image sig, or null on miss. */
  public getOptimizedVisual = async (sourceSig: string): Promise<Blob | null> => {
    try {
      const dir = await this.#visualOptimDir()
      if (!dir) return null
      const handle = await dir.getFileHandle(sourceSig, { create: false })
      const file = await handle.getFile()
      return file.size > 0 ? file : null
    } catch { return null }
  }

  #putOptimizedVisual = async (sourceSig: string, bytes: ArrayBuffer): Promise<void> => {
    try {
      const dir = await this.#visualOptimDir()
      if (!dir) return
      const handle = await dir.getFileHandle(sourceSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort cache */ }
  }

  /** Produce + persist the cell-sized optimized form of a raw visual so the
   *  next COLD load decodes a small image instead of the full original.
   *  Idempotent (skips when already cached) and a no-op when the raw is
   *  already within the atlas target (nothing to gain). Best-effort: a
   *  failure just means the raw is re-decoded next session. */
  public optimizeVisual = async (sourceSig: string, rawBlob: Blob): Promise<void> => {
    try {
      if (await this.getOptimizedVisual(sourceSig)) return
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return
      const raw = await createImageBitmap(rawBlob)
      const target = Store.#VISUAL_OPTIM_TARGET
      // Already within the atlas target — caching a same-size copy buys
      // nothing, so leave the raw as the source of truth.
      if (raw.width <= target && raw.height <= target) { raw.close(); return }
      const aspect = raw.width / raw.height
      const w = aspect >= 1 ? target : Math.max(1, Math.round(target * aspect))
      const h = aspect >= 1 ? Math.max(1, Math.round(target / aspect)) : target
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) { raw.close(); return }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'low'
      ctx.drawImage(raw, 0, 0, w, h)
      raw.close()
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
      await this.#putOptimizedVisual(sourceSig, await blob.arrayBuffer())
    } catch { /* best-effort — re-decode raw next session on failure */ }
  }

  public removeOptimization = async (signature: string): Promise<boolean> => {
    if (!this.optimization) return false
    let removed = false
    try { await this.optimization.removeEntry(signature); removed = true } catch { /* not in pool */ }
    if (this.#legacyOptimization) {
      try { await this.#legacyOptimization.removeEntry(signature); removed = true } catch { /* not in legacy */ }
    }
    return removed
  }

  public listOptimizations = async (): Promise<string[]> => {
    if (!this.optimization) return []
    const sigs = new Set<string>()
    const collect = async (pool: FileSystemDirectoryHandle): Promise<void> => {
      for await (const [name] of (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (/^[0-9a-f]{64}$/.test(name)) sigs.add(name)
      }
    }
    await collect(this.optimization)
    if (this.#legacyOptimization) {
      try { await collect(this.#legacyOptimization) } catch { /* deleted mid-absorb — pool holds everything */ }
    }
    return [...sigs]
  }

  /** Drain each legacy record dir into its sign(meaning) pool, then
   *  delete the emptied dir. Detached from boot (see `#doInit`);
   *  sequential so single-threaded OPFS isn't hammered. */
  #absorbLegacyRecordPools = async (): Promise<void> => {
    if (this.#legacyOptimization && await this.#absorbLegacyPool(
      this.#legacyOptimization, this.optimization, Store.LEGACY_OPTIMIZATION_DIRECTORY)) {
      this.#legacyOptimization = undefined
    }
    if (this.legacyBees && await this.#absorbLegacyPool(
      this.legacyBees, this.bees, Store.LEGACY_BEES_DIRECTORY)) {
      this.legacyBees = undefined
    }
    if (this.legacyDependencies && await this.#absorbLegacyPool(
      this.legacyDependencies, this.dependencies, Store.LEGACY_DEPENDENCIES_DIRECTORY)) {
      this.legacyDependencies = undefined
    }
    if (this.legacyClipboard && await this.#absorbLegacyPool(
      this.legacyClipboard, this.clipboard, Store.LEGACY_CLIPBOARD_DIRECTORY)) {
      this.legacyClipboard = undefined
    }
    // Threads and computation store sig-named SUB-BUCKETS (a thread-id
    // dir holding its manifest; a lookupKey dir holding receipts), not
    // flat files — the file-only absorb above skips directories, so they
    // need the bucket-aware drain or an upgrading user's conversations /
    // receipts never migrate and become unreadable.
    if (this.legacyThreads && await this.#absorbLegacyBucketDir(
      this.legacyThreads, this.threads, Store.LEGACY_THREADS_DIRECTORY)) {
      this.legacyThreads = undefined
    }
    if (this.legacyComputation && await this.#absorbLegacyBucketDir(
      this.legacyComputation, this.computation, Store.LEGACY_COMPUTATION_DIRECTORY)) {
      this.legacyComputation = undefined
    }
    if (this.legacyManifests && await this.#absorbLegacyPool(
      this.legacyManifests, this.manifests, Store.LEGACY_MANIFESTS_DIRECTORY)) {
      this.legacyManifests = undefined
    }
    // i18n dirs held fixed-name docs ('i18n.json', '<locale>.json') — they
    // absorb by CONTENT-ADDRESSING each file into its document pool, not by
    // name (the human filename is exactly what we're eliminating).
    if (this.legacyOverrides && await this.#absorbLegacyDocDir(
      this.legacyOverrides, this.overrides, Store.LEGACY_OVERRIDES_DIRECTORY, false)) {
      this.legacyOverrides = undefined
    }
    if (this.legacyTranslations && await this.#absorbLegacyDocDir(
      this.legacyTranslations, this.translations, Store.LEGACY_TRANSLATIONS_DIRECTORY, true)) {
      this.legacyTranslations = undefined
    }
  }

  static #bytesEqual = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
    if (a.byteLength !== b.byteLength) return false
    const ua = new Uint8Array(a), ub = new Uint8Array(b)
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false
    return true
  }

  /** Absorb a legacy dir whose members are sig-named SUB-BUCKETS (threads
   *  keyed by thread id, computation keyed by lookup key) into the pool.
   *  The file-only `#absorbLegacyPool` skips directories, so those buckets
   *  would never migrate; this moves each sub-bucket's FILES into the
   *  same-named pool bucket (present-guard by BYTE CONTENT — index-named
   *  computation receipts can collide on name with differing bytes, so a
   *  collision keeps both and defers), removes a source bucket once drained,
   *  and removes the legacy dir when fully empty. Files copy by name — a
   *  thread's legacy `manifest.json` lands beside any content-addressed
   *  member and loses to it on read (loadThread prefers the sig member),
   *  self-cleaned on the next saveThread. Returns true iff drained. */
  #absorbLegacyBucketDir = async (
    legacy: FileSystemDirectoryHandle,
    pool: FileSystemDirectoryHandle,
    legacyName: string,
  ): Promise<boolean> => {
    try {
      for await (const [bucketName, bh] of (legacy as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (bh.kind !== 'directory' || !isSignature(bucketName)) continue
        const src = bh as FileSystemDirectoryHandle
        const dest = await pool.getDirectoryHandle(bucketName, { create: true })
        let bucketClean = true
        try {
          for await (const [fname, fh] of (src as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
            if (fh.kind !== 'file') { bucketClean = false; continue }
            try {
              const file = await (fh as FileSystemFileHandle).getFile()
              // Present-guard by BYTES, not size: in-bucket filenames are
              // not always content-addressed (thread manifests are sig
              // members, but computation receipts are monotonic indices
              // `00000001` with fixed-length payloads — so equal size does
              // NOT imply equal content). A same-name file with DIFFERENT
              // bytes is an index collision (legacy and pool both restart
              // numbering): never overwrite it and never delete the source
              // — defer the whole bucket so both survive. Only drop the
              // source when its bytes are confirmed present, or copy when
              // the name is genuinely absent.
              let destBytes: ArrayBuffer | null = null
              try { destBytes = await (await (await dest.getFileHandle(fname)).getFile()).arrayBuffer() } catch { /* absent */ }
              const srcBytes = await file.arrayBuffer()
              if (destBytes) {
                if (Store.#bytesEqual(destBytes, srcBytes)) {
                  await src.removeEntry(fname)          // identical copy confirmed — drop source
                } else {
                  bucketClean = false                   // name collision, differing bytes — keep both
                }
                continue
              }
              const dh = await dest.getFileHandle(fname, { create: true })
              const w = await dh.createWritable()
              try { await w.write(srcBytes) } finally { await w.close() }
              await src.removeEntry(fname)              // copied → safe to drop source
            } catch { bucketClean = false }
          }
        } catch { bucketClean = false }
        if (bucketClean) { try { await legacy.removeEntry(bucketName) } catch { /* not empty — next boot */ } }
      }
      await this.opfsRoot.removeEntry(legacyName)
      return true
    } catch {
      /* not yet empty — reads fall back to legacy; retry next boot */
      return false
    }
  }

  /** Content-addressing absorb for legacy document dirs: each legacy
   *  `<name>.json` file becomes a content-addressed member of `pool` via
   *  putPoolDoc — sub-keyed by the file's base name (the locale) when
   *  `perSubKey`, else a single document. putPoolDoc returns the sig only
   *  once the member is written, so the legacy file is removed strictly
   *  after its bytes are confirmed in the pool. Non-recursive final
   *  removeEntry, gated on the dir being empty. Returns true iff drained. */
  #absorbLegacyDocDir = async (
    legacy: FileSystemDirectoryHandle,
    pool: FileSystemDirectoryHandle,
    legacyName: string,
    perSubKey: boolean,
  ): Promise<boolean> => {
    try {
      for await (const [name, handle] of (legacy as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue
        try {
          const subKey = perSubKey ? name.replace(/\.json$/, '') : undefined
          // Pool is authoritative. If it already holds a current member,
          // that is a post-boot write/reset — NEWER than this legacy file
          // by construction — so drop the legacy file and NEVER overwrite.
          // (This absorb is detached and may reach overrides/translations
          // after the live app has already written the pool; without this
          // guard it would resurrect stale legacy over a `/i18n-override
          // reset` or the boot-time translation-cache migration.) Only
          // content-address the legacy bytes when the pool is still empty.
          if (await this.getPoolDoc(pool, subKey)) {
            await legacy.removeEntry(name)
            continue
          }
          const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
          const sig = await this.putPoolDoc(pool, bytes, subKey)
          if (sig) await legacy.removeEntry(name)  // confirmed in pool → drop legacy
        } catch { /* straggler — absorbed on a later boot */ }
      }
      await this.opfsRoot.removeEntry(legacyName)
      return true
    } catch {
      /* dir not yet empty — dual-reads keep working; retry next boot */
      return false
    }
  }

  /** One-time migration: drain a legacy record dir into its pool, then
   *  delete it. Copies EVERY plain file regardless of name (record
   *  pools may key by sig, parent sig, or a local name); a pool entry
   *  under the same name wins — the legacy copy is by definition older.
   *  Copy → remove per record so an interrupted absorb resumes on the
   *  next boot; the final removeEntry is non-recursive ON PURPOSE — it
   *  only succeeds once the folder is empty, so a straggler (or an
   *  unexpected subdir) is never destroyed. Returns true iff the legacy
   *  dir was fully drained and removed. */
  #absorbLegacyPool = async (
    legacy: FileSystemDirectoryHandle,
    target: FileSystemDirectoryHandle,
    legacyName: string,
  ): Promise<boolean> => {
    try {
      for await (const [name, handle] of (legacy as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file') continue
        try {
          const blob = await (handle as FileSystemFileHandle).getFile()
          // A non-empty pool entry under the same name wins (the legacy
          // copy is by definition older). A 0-byte pool entry is an
          // interrupted earlier copy — heal it from the source before
          // the source record is removed, or the bytes would be lost.
          let present = false
          try {
            const existing = await target.getFileHandle(name)
            present = (await existing.getFile()).size > 0 || blob.size === 0
          } catch { /* absent — copy */ }
          if (!present) {
            const dest = await target.getFileHandle(name, { create: true })
            const writable = await dest.createWritable()
            try { await writable.write(blob) } finally { await writable.close() }
          }
          await legacy.removeEntry(name)
        } catch { /* straggler — absorbed on a later boot */ }
      }
      await this.opfsRoot.removeEntry(legacyName)
      return true
    } catch {
      /* dir not yet empty — dual-reads keep working; retry next boot */
      return false
    }
  }

  // -------------------------------------------------
  // universal signature resolver
  // -------------------------------------------------
  //
  // Every content read in the platform bottlenecks through resolve /
  // deepResolve / preload. The rule is: if a value is a signature,
  // expand it to its resource; otherwise return as-is. Recursion
  // through nested objects/arrays is free — one primitive handles the
  // entire graph.
  //
  // Because resolution is identity-keyed and reuses the existing
  // #resourceCache + in-flight dedup, visiting a historical layer a
  // second time is a memory hit. Warmup, undo, and redo are all the
  // same operation: walk the layer, resolve every signature inside,
  // cache is populated, render is instant.

  /** JSON type shape for parsed resource payloads. */
  readonly #parsedResourceCache = new Map<string, unknown>()
  readonly #parsedResourcePending = new Map<string, Promise<unknown>>()

  /**
   * If `value` is a signature, fetch the resource, parse as JSON, and
   * return the parsed value. Otherwise return `value` unchanged.
   *
   * The parsed-JSON cache is separate from the raw-blob cache so
   * consumers that want the Blob (images) keep getting it via
   * getResource, while consumers that want the JSON pay the parse
   * cost exactly once per signature.
   */
  public resolve = async <T = unknown>(value: unknown, localOnly = false): Promise<T> => {
    if (!isSignature(value)) return value as T
    const cached = this.#parsedResourceCache.get(value)
    if (cached !== undefined) return cached as T
    const pending = this.#parsedResourcePending.get(value)
    if (pending) return pending as Promise<T>
    const promise = (async (): Promise<T> => {
      try {
        // localOnly (warmup pre-cache): memory → OPFS only, NEVER the host. A
        // missing historical resource must not trigger a host fetch — that
        // logs a 404 in the console for a purely best-effort warm. A real
        // on-demand read (localOnly=false) still falls through to the host.
        const blob = localOnly ? await this.getResourceLocal(value) : await this.getResource(value)
        if (!blob) return value as T
        const parsed = JSON.parse(await blob.text()) as T
        this.#parsedResourceCache.set(value, parsed)
        return parsed
      } catch {
        return value as T
      } finally {
        this.#parsedResourcePending.delete(value)
      }
    })()
    this.#parsedResourcePending.set(value, promise)
    return promise
  }

  /**
   * Recursively resolve every signature in an arbitrary value. Objects
   * and arrays are walked; scalar values and non-signature strings pass
   * through unchanged. All signatures in the same call resolve in
   * parallel — one deepResolve on a layer warms every field at once
   * rather than serially.
   */
  public deepResolve = async <T = unknown>(value: unknown): Promise<T> => {
    if (isSignature(value)) {
      const resolved = await this.resolve<unknown>(value)
      if (resolved === value) return resolved as T
      return this.deepResolve<T>(resolved)
    }
    if (Array.isArray(value)) {
      return (await Promise.all(value.map(v => this.deepResolve<unknown>(v)))) as T
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      const resolvedEntries = await Promise.all(
        entries.map(async ([k, v]) => [k, await this.deepResolve<unknown>(v)] as const)
      )
      const out: Record<string, unknown> = {}
      for (const [k, v] of resolvedEntries) out[k] = v
      return out as T
    }
    return value as T
  }

  /**
   * Warm the resource cache for a batch of signatures. Non-signature
   * values are ignored. Safe to call concurrently — in-flight loads
   * are deduped at the getResource layer. Returns when every
   * signature has either loaded or failed; failures don't reject the
   * batch so a single bad blob doesn't poison warmup.
   */
  public preload = async (values: readonly unknown[]): Promise<void> => {
    const signatures = new Set<string>()
    for (const value of values) if (isSignature(value)) signatures.add(value)
    if (signatures.size === 0) return
    await Promise.all(
      [...signatures].map(signature =>
        this.resolve(signature).catch(() => undefined)
      )
    )
  }

  /**
   * Collect every signature referenced inside a value (recursively).
   * Useful when a caller wants to inspect or preload dependencies
   * without triggering resolution itself.
   */
  public collectSignatures = (value: unknown, out: Set<string> = new Set<string>()): Set<string> => {
    if (isSignature(value)) {
      out.add(value)
      return out
    }
    if (Array.isArray(value)) {
      for (const v of value) this.collectSignatures(v, out)
      return out
    }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) this.collectSignatures(v, out)
    }
    return out
  }

  /** Resolve a content signature to its File: the flat root
   *  (`<root>/<sig>`) first, then the legacy content roots
   *  (`__hive__/<sig>`, `hypercomb.io/<sig>`), then the caller's legacy
   *  typed dir. New bytes land at the root; the manual relocation pass
   *  drains the legacy sources — until then they still resolve from
   *  there. Content-addressed, so a hit anywhere is provably the same
   *  bytes: the order is pure preference, never correctness. Returns
   *  null when absent everywhere. */
  #readContentFile = async (
    signature: string,
    legacy: FileSystemDirectoryHandle | undefined,
  ): Promise<File | null> => {
    // A 0-byte file under a non-empty sig is an INCOMPLETE write, not real
    // content: `getFileHandle({create:true})` (a relocation copy, or
    // putResource/writeLayerBytes) lands a 0-byte target before its bytes are
    // written. Returning it would resolve a layer as wiped / let a resource
    // short-circuit the host heal. Treat it as not-here and keep looking, so
    // the read lands on wherever the COMPLETE bytes currently live — the
    // legacy pool while a relocation is mid-flight — instead of a local miss
    // that demotes to a runtime host fetch. Content-addressed, so this is
    // provably safe: the only sig whose valid content is 0 bytes is the
    // empty-content sig, which both pools represent identically.
    const complete = (file: File): File | null =>
      file.size > 0 || signature === EMPTY_CONTENT_SIG ? file : null
    for (const source of [this.hypercombRoot, this.legacyHive, this.legacyHypercombIo, legacy]) {
      if (!source) continue
      try {
        const handle = await source.getFileHandle(signature, { create: false })
        const file = complete(await handle.getFile())
        if (file) return file
      } catch { /* not in this source — keep falling back */ }
    }
    return null
  }

  #loadResource = (signature: string): Promise<Blob | null> => {
    const existing = this.#resourcePending.get(signature)
    if (existing) return existing
    const promise = (async () => {
      try {
        // `#readContentFile` already drops an incomplete 0-byte file under a
        // non-empty sig — falling through to wherever the complete bytes live
        // (the legacy pool mid-move) rather than serving emptiness — so a
        // returned file is real content; only the empty-content sig is
        // legitimately 0 bytes. No size guard needed here.
        const file = await this.#readContentFile(signature, this.resources)
        if (!file) return null
        // Detach from the OPFS backing file by copying bytes into
        // memory and wrapping a fresh Blob. A raw File returned from
        // handle.getFile() keeps a live reference to the OPFS storage;
        // if anything later writes to that sig (a re-put of identical
        // content is enough) the File goes stale and every subsequent
        // .text() / .arrayBuffer() on it throws NotReadableError.
        // Readers then cache the error as a null image and the tile
        // renders blank indefinitely. Caching the bytes themselves
        // makes the cached Blob independent of the filesystem.
        const bytes = await file.arrayBuffer()
        const blob = new Blob([bytes], { type: file.type })
        this.#resourceCache.set(signature, blob)
        return blob
      } catch {
        return null
      } finally {
        this.#resourcePending.delete(signature)
      }
    })()
    this.#resourcePending.set(signature, promise)
    return promise
  }

  // Sig-addressed bytes are immutable, so this cache is safe across the session.
  readonly #layerBytesCache = new Map<string, Uint8Array>()
  readonly #layerBytesPending = new Map<string, Promise<Uint8Array | null>>()

  // PERF INSTRUMENTATION (temporary — remove after diagnosis)
  #perfStats = {
    cacheHits: 0,
    cacheMisses: 0,
    pendingHits: 0,
    loadCalls: 0,
    totalLoadMs: 0,
  }
  public dumpPerfStats(): void {
    const s = this.#perfStats
    console.log('[store-perf]', JSON.stringify(s, null, 2))
    console.log(`[store-perf] avg load ms: ${s.loadCalls ? (s.totalLoadMs / s.loadCalls).toFixed(2) : 0}`)
  }

  /** Read layer bytes by signature. Resolves through:
   *    1. In-memory layerBytesCache (hot, instant)
   *    2. The flat root (`<root>/<sig>`), then the legacy sources
   *  Once read, cached in memory for subsequent calls. */
  public getLayerBytes = async (signature: string): Promise<Uint8Array | null> => {
    const cached = this.#layerBytesCache.get(signature)
    if (cached) { this.#perfStats.cacheHits++; this.#stageToHost(signature, 'layer', cached); return cached }
    const pending = this.#layerBytesPending.get(signature)
    if (pending) { this.#perfStats.pendingHits++; return pending }
    this.#perfStats.cacheMisses++
    const promise = this.#loadLayerBytes(signature)
    this.#layerBytesPending.set(signature, promise)
    try {
      const bytes = await promise
      if (bytes) { this.#layerBytesCache.set(signature, bytes); this.#stageToHost(signature, 'layer', bytes) }
      return bytes
    } finally {
      this.#layerBytesPending.delete(signature)
    }
  }

  /** Read layer bytes by signature, root-first: the flat root
   *  (`<root>/<sig>`) then the legacy sources (see `#readContentFile`).
   *  Absent everywhere → null. Content-addressed: sig === hash(bytes),
   *  so an entry can never be stale, only present or absent, and which
   *  source serves it is immaterial. Markers in lineage sigbags
   *  reference into this content. */
  public getLayerPoolBytes = async (signature: string): Promise<Uint8Array | null> => {
    try {
      const file = await this.#readContentFile(signature, this.layers)
      if (!file) return null
      const bytes = new Uint8Array(await file.arrayBuffer())
      // The warmup/preloader reads layers through the pool directly (not via
      // getLayerBytes), so without this the author only pushed the branches it
      // navigated, leaving sibling tiles 404 on the relay. Push here too so the
      // FULL walked tree reaches the host.
      this.#stageToHost(signature, 'layer', bytes)
      return bytes
    } catch { return null }
  }

  /** Write layer bytes as a sig-named file at the flat root.
   *  Idempotent (sig === hash(bytes), so identical writes produce
   *  identical bytes). Best-effort; the marker is the canonical
   *  reference, the root entry is its resolved content. Every writer —
   *  participant commits AND the install/sentinel path — targets the
   *  root; no code writes a legacy typed pool. */
  public writeLayerBytes = async (signature: string, bytes: ArrayBuffer): Promise<void> => {
    if (!this.hypercombRoot) return
    try {
      const handle = await this.hypercombRoot.getFileHandle(signature, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort */ }
  }

  /** Content relocation: copy every sig-named file from the legacy
   *  typed pools (`__resources__`, `__layers__`, `__optimized__`) and
   *  the legacy content roots (`__hive__/`, `hypercomb.io/` — including
   *  their lineage sigbags, union-merged) up to the flat OPFS root,
   *  then GC each source once everything it holds is confirmed at the
   *  root AND it holds nothing else. Idempotent and resumable: a sig
   *  already at the root is skipped (content-addressed — identical
   *  bytes), so a re-run just finishes a partial pass. NEVER deletes a
   *  source entry individually and NEVER removes a source that still
   *  holds an un-shadowed or non-relocatable entry — the only safe gate
   *  on user data. Stale per-domain manifest subdirs inside
   *  `__layers__` legitimately defer its GC; the copy still runs so
   *  reads resolve root-first. Best-effort throughout — never throws.
   *
   *  Runs SELF-CLEANING: scheduled detached + delayed from `#doInit`
   *  whenever a legacy content source exists (never inline during boot —
   *  see the delay rationale there), and also invocable manually via the
   *  `/consolidate-content` queen as a force-run. Mirrors
   *  `gcLegacyHistory` on the history side. Idempotent and resumable, so
   *  a later run finishes a partial pass. */
  public migrateContentPoolToRoot = async (): Promise<void> => {
    if (!this.hypercombRoot) return
    try {
      if (await this.#relocatePool(this.resources, Store.LEGACY_RESOURCES_DIRECTORY)) {
        // Pool removed — drop the stale handle so this session can't read
        // through it and resurrect the dir.
        this.resources = undefined
      }
      if (await this.#relocatePool(this.layers, Store.LEGACY_LAYERS_DIRECTORY)) {
        this.layers = undefined
      }
      if (await this.#relocatePool(this.optimized, Store.LEGACY_OPTIMIZED_DIRECTORY)) {
        this.optimized = undefined
      }
      // The legacy content ROOTS also hold lineage sigbag dirs — they
      // relocate with a marker-UNION merge (see #relocateScopeDir).
      if (await this.#relocateScopeDir(this.legacyHive, Store.LEGACY_HIVE_DIRECTORY)) {
        this.legacyHive = undefined
      }
      if (await this.#relocateScopeDir(this.legacyHypercombIo, Store.LEGACY_HYPERCOMB_IO_DIRECTORY)) {
        this.legacyHypercombIo = undefined
      }
    } catch (err) {
      console.warn('[store] content-pool relocation aborted', err)
    }
  }

  /** Drain a legacy content ROOT (`__hive__/`, `hypercomb.io/`): sig
   *  FILES copy up to the flat root like a pool; sig-named SUBDIRS are
   *  lineage sigbags and merge into the root bag of the same lineage by
   *  UNION — copy the markers the root bag lacks, never touch existing
   *  root markers — so a stale source can never rewind a lineage (the
   *  max marker only grows; on a same-index divergence the root's
   *  marker wins — it is the live era, and the content bytes both
   *  markers point at remain at the root regardless). GC is gated like
   *  `#relocatePool`: the source is removed only when every entry is
   *  confirmed relocated and nothing unrelocatable remains. */
  #relocateScopeDir = async (
    source: FileSystemDirectoryHandle | undefined,
    sourceName: string,
  ): Promise<boolean> => {
    if (!source || !this.hypercombRoot) return false
    let total = 0
    let done = 0
    let unrelocatable = 0
    try {
      for await (const [name, handle] of (source as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === 'file' && isSignature(name)) {
          total++
          try {
            const file = await (handle as FileSystemFileHandle).getFile()
            // "Already at root" must mean COMPLETE at root: an existing
            // 0-byte/short target is an interrupted earlier copy, and
            // counting it as shadowed would let the gated GC delete the
            // only complete copy of these bytes. Content-addressed, so
            // size equality is the completeness proof.
            try {
              const existing = await this.hypercombRoot.getFileHandle(name, { create: false })
              if ((await existing.getFile()).size === file.size) { done++; continue }
            } catch { /* not at root yet — copy it up */ }
            const bytes = await file.arrayBuffer()
            const dest = await this.hypercombRoot.getFileHandle(name, { create: true })
            const writable = await dest.createWritable()
            try { await writable.write(bytes) } finally { await writable.close() }
            done++
          } catch (err) {
            console.warn(`[store] relocate ${sourceName}/${name.slice(0, 12)} → root failed`, err)
          }
        } else if (handle.kind === 'directory' && isSignature(name)) {
          total++
          if (await this.#mergeLineageBag(handle as FileSystemDirectoryHandle, name)) done++
        } else {
          // Non-sig entry (.crswap temp, stray artifact): not ours to
          // move; its presence defers the source's GC.
          unrelocatable++
        }
      }
    } catch (err) {
      console.warn(`[store] relocate scan of ${sourceName} failed — left in place`, err)
      return false
    }
    if (done === total && unrelocatable === 0) {
      try {
        await this.opfsRoot.removeEntry(sourceName, { recursive: true })
        console.log(`[store] ${sourceName}: ${total} entries relocated to the flat root — legacy root removed`)
        return true
      } catch (err) {
        console.warn(`[store] ${sourceName} GC failed — left in place`, err)
        return false
      }
    }
    console.log(`[store] ${sourceName}: ${done}/${total} relocated, ${unrelocatable} non-sig retained — kept for a later pass`)
    return false
  }

  /** Union-merge one legacy lineage sigbag into the root bag of the same
   *  lineage sig: copy every marker file the root bag lacks. Returns true
   *  only when every source marker is confirmed present in the root bag —
   *  the caller's GC gate. */
  #mergeLineageBag = async (
    sourceBag: FileSystemDirectoryHandle,
    lineageSig: string,
  ): Promise<boolean> => {
    if (!this.hypercombRoot) return false
    let rootBag: FileSystemDirectoryHandle
    try {
      rootBag = await this.hypercombRoot.getDirectoryHandle(lineageSig, { create: true })
    } catch { return false }
    let allPresent = true
    try {
      for await (const [name, handle] of (sourceBag as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file') { allPresent = false; continue }
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          // A non-empty root marker under the same index wins (the root
          // bag is the live era). A 0-byte root marker is an interrupted
          // copy, not a divergence — heal it from the source.
          try {
            const existing = await rootBag.getFileHandle(name, { create: false })
            if ((await existing.getFile()).size > 0 || file.size === 0) continue
          } catch { /* absent — copy */ }
          const bytes = await file.arrayBuffer()
          const dest = await rootBag.getFileHandle(name, { create: true })
          const writable = await dest.createWritable()
          try { await writable.write(bytes) } finally { await writable.close() }
        } catch { allPresent = false }
      }
    } catch { return false }
    return allPresent
  }

  /** Copy one legacy pool's sig files to the hive root; GC the pool when it
   *  is fully shadowed and otherwise empty. Returns true iff removed. */
  #relocatePool = async (
    source: FileSystemDirectoryHandle | undefined,
    poolName: string,
  ): Promise<boolean> => {
    if (!source || !this.hypercombRoot) return false
    let sigTotal = 0
    let shadowed = 0
    let copied = 0
    let unrelocatable = 0
    try {
      for await (const [name, handle] of (source as any).entries()) {
        // Skip subdirectories (bag dirs, per-domain manifests) and any
        // non-sig file (.crswap temp, stray artifacts): not ours to move,
        // and their presence defers the pool's GC.
        if (handle.kind !== 'file' || !isSignature(name)) { unrelocatable++; continue }
        sigTotal++
        try {
          const sourceFile = await (handle as FileSystemFileHandle).getFile()
          // Shadowed must mean COMPLETE at the root — size equality, not
          // mere existence. A 0-byte/short target from an interrupted
          // earlier copy would otherwise pass the gate and the GC would
          // delete the only complete copy. Content-addressed, so equal
          // size ⇒ identical bytes.
          try {
            const existing = await this.hypercombRoot.getFileHandle(name, { create: false })
            if ((await existing.getFile()).size === sourceFile.size) {
              shadowed++
              continue
            }
          } catch { /* not at root yet — copy it up */ }
          const bytes = await sourceFile.arrayBuffer()
          const dest = await this.hypercombRoot.getFileHandle(name, { create: true })
          const writable = await dest.createWritable()
          try { await writable.write(bytes) } finally { await writable.close() }
          shadowed++
          copied++
        } catch (err) {
          console.warn(`[store] relocate ${poolName}/${name.slice(0, 12)} → root failed`, err)
        }
      }
    } catch (err) {
      console.warn(`[store] relocate scan of ${poolName} failed — pool left in place`, err)
      return false
    }
    // Gated GC: remove the pool ONLY when every sig it holds is now at the
    // root and it holds no non-sig entries. A single un-shadowed or
    // unrelocatable entry defers deletion to a later boot — never ahead of
    // confirmation. This is the never-wipe guard for the content pools.
    // An EMPTY pool (sigTotal 0, nothing unrelocatable) is removed too —
    // no legacy writer exists to repopulate it, and lingering empty
    // `__x__` dirs are exactly what the migration eradicates.
    if (shadowed === sigTotal && unrelocatable === 0) {
      try {
        await this.opfsRoot.removeEntry(poolName, { recursive: true })
        console.log(`[store] ${poolName}: ${sigTotal} sigs relocated to hive root — pool removed`)
        return true
      } catch (err) {
        console.warn(`[store] ${poolName} GC failed — pool left in place`, err)
        return false
      }
    }
    if (sigTotal > 0 || copied > 0) {
      console.log(`[store] ${poolName}: ${shadowed}/${sigTotal} at root (${copied} copied this pass), ${unrelocatable} non-sig retained — pool kept`)
    }
    return false
  }

  /** Read from the legacy `__optimized__/<sig>` mirror. Pre-migration
   *  data lives here; readers fall back to it after the flat root
   *  misses. Read-only back-compat — nothing writes here anymore. */
  public getOptimizedBytes = async (signature: string): Promise<Uint8Array | null> => {
    if (!this.optimized) return null
    try {
      const handle = await this.optimized.getFileHandle(signature, { create: false })
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch { return null }
  }

  /** Legacy mirror writer, retargeted: the `__optimized__` dir is never
   *  written again — bytes land at the flat root like every other
   *  content write. Kept only so existing callers keep compiling;
   *  identical to `writeLayerBytes`. */
  public writeOptimizedBytes = async (signature: string, bytes: ArrayBuffer): Promise<void> => {
    await this.writeLayerBytes(signature, bytes)
  }

  /** Read the children manifest for a parent layer sig. Returns the
   *  parsed array of resolved child layer objects, or null if absent.
   *  Hot path on cold load — single file read, no per-child sig→layer
   *  walks against the bag. */
  public readChildrenManifest = async (
    parentLayerSig: string,
  ): Promise<Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> | null> => {
    // sign('manifests') pool first, then the legacy `__manifests__` dir
    // until the boot absorb drains it. Derived cache — a miss in both
    // just re-resolves and re-writes.
    for (const source of [this.manifests, this.legacyManifests]) {
      if (!source) continue
      try {
        const handle = await source.getFileHandle(parentLayerSig, { create: false })
        const file = await handle.getFile()
        const text = await file.text()
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) return null
        return parsed
      } catch { /* miss — try the next source */ }
    }
    return null
  }

  /** Write the children manifest for a parent layer sig. Best-effort;
   *  errors are swallowed because the manifest is pure cache (next read
   *  will fall back to the per-sig lookup and re-write). */
  public writeChildrenManifest = async (
    parentLayerSig: string,
    manifest: Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }>,
  ): Promise<void> => {
    if (!this.manifests) return
    try {
      const handle = await this.manifests.getFileHandle(parentLayerSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(JSON.stringify(manifest)) } finally { await writable.close() }
    } catch { /* cache miss on next read is fine */ }
  }

  #loadLayerBytes = async (signature: string): Promise<Uint8Array | null> => {
    const t0 = performance.now()
    this.#perfStats.loadCalls++
    try {
      // Layer bytes live at the flat root — boot install, sentinel
      // sync, user commits, peer pulls all write there. Legacy sources
      // resolve via the fallback chain until drained.
      return await this.getLayerPoolBytes(signature)
    } finally {
      this.#perfStats.totalLoadMs += performance.now() - t0
    }
  }

  // -------------------------------------------------
  // drone put
  // -------------------------------------------------

  public put = async (bytes: ArrayBuffer): Promise<string> => {
    const signature = await SignatureService.sign(bytes)

    const handle = await this.bees.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    return signature
  }
}

register('@hypercomb.social/Store', new Store())
console.log('[hypercomb] store: layer-bytes cache active (2026-05-01)')

// hypercomb-shared/core/store.ts
// hypercomb-web/src/app/core/store.ts

import { Bee, EffectBus, SignatureService, isSignature } from '@hypercomb/core'

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

  /** User-content root. Historically named `hypercomb.io/` — renamed to
   *  the underscored form so the OPFS root inventory is uniformly
   *  `__*__` per Jaime's directive. Property name on Store stays
   *  `hypercombRoot` (consumers untouched); only the on-disk dir name
   *  moved. Old `hypercomb.io/` dirs from prior sessions are orphans
   *  swept by `/sweep`. */
  public static readonly HIVE_DIRECTORY = '__hive__'
  public static readonly BEES_DIRECTORY = '__bees__'
  public static readonly DEPENDENCIES_DIRECTORY = '__dependencies__'
  /** Canonical layer-bytes pool. Sig-keyed entries at top level
   *  (`__layers__/<sig>`) hold the layer JSON for user content; markers
   *  in `__history__/<lineage>/<NNNN>` are pointer records that reference
   *  them. Per-domain subdirectories at `__layers__/<domain>/` hold
   *  install manifests (deployment artifacts) — distinguishable from
   *  sig entries by name shape (sig = 64 hex, domain = non-hex). */
  public static readonly LAYERS_DIRECTORY = '__layers__'
  public static readonly RESOURCES_DIRECTORY = '__resources__'
  public static readonly CLIPBOARD_DIRECTORY = '__clipboard__'
  public static readonly HISTORY_DIRECTORY = '__history__'
  public static readonly THREADS_DIRECTORY = '__threads__'
  public static readonly COMPUTATION_DIRECTORY = '__computation__'
  /** Legacy sig-keyed layer-bytes pool. Pre-migration data lives here;
   *  read path falls back to it after `__layers__/<sig>` misses. New
   *  writes go to the canonical `__layers__/<sig>` pool, not here.
   *  Sig-keyed pools are not "derived" — sig === hash(bytes), so an
   *  entry either matches its address or doesn't exist. Deletion is
   *  always safe in the sense that any peer with the same bytes can
   *  re-serve them under the same sig. */
  public static readonly OPTIMIZED_DIRECTORY = '__optimized__'
  /** Children manifests: per-parent decoration that inlines the resolved
   *  child layer objects. Keyed by parent layer sig. Lets show-cell skip
   *  the per-child sig-→-layer lookup on cold load. Written passively
   *  after every commitLayer that has children; orphaned when the parent
   *  is superseded — pure derived state, safe to GC. */
  public static readonly MANIFESTS_DIRECTORY = '__manifests__'
  /** Persistent decoration substrate. Holds Q&A, comm threads, future
   *  optimization kinds — anything authored-or-derived that gets applied
   *  to base objects in memory at runtime without polluting their layer.
   *  Loaded at startup; entries survive reloads. Layer-untouched: the
   *  layer-commit primitive never reads or writes here. State-machine
   *  wrappers around base objects compose entries onto the cell view
   *  without mutating the underlying layer; the only legitimate bridge
   *  from this directory into the layer is when an optimization resolves
   *  into a note (Q&A answered → note appended). See
   *  `feedback_layer_purity_optimizations_external.md` /
   *  `project_optimization_substrate.md` in user memory. */
  public static readonly OPTIMIZATION_DIRECTORY = '__optimization__'

  private static readonly CACHE_NAME = 'hypercomb-modules-v2'

  public opfsRoot!: FileSystemDirectoryHandle
  public hypercombRoot!: FileSystemDirectoryHandle
  public bees!: FileSystemDirectoryHandle
  public dependencies!: FileSystemDirectoryHandle
  public layers!: FileSystemDirectoryHandle
  public resources!: FileSystemDirectoryHandle
  public clipboard!: FileSystemDirectoryHandle
  public history!: FileSystemDirectoryHandle
  public threads!: FileSystemDirectoryHandle
  public computation!: FileSystemDirectoryHandle
  public optimized!: FileSystemDirectoryHandle
  public manifests!: FileSystemDirectoryHandle
  public optimization!: FileSystemDirectoryHandle

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
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OPFS timed out')), 3_000)
        )
      ])
    } catch (err) {
      console.warn('[store] OPFS root unavailable — running without persistent storage', err)
      this.#opfsAvailable = false
      return
    }

    const dir = (name: string) =>
      this.opfsRoot.getDirectoryHandle(name, { create: true })

    try {
      ;[
        this.hypercombRoot,
        this.bees,
        this.dependencies,
        this.layers,
        this.resources,
        this.clipboard,
        this.history,
        this.threads,
        this.computation,
        this.optimized,
        this.manifests,
        this.optimization,
      ] = await Promise.all([
        // Architectural rule: only `__*__` folders live at the OPFS root.
        // The user-content root was historically `hypercomb.io/` — that
        // name is the violation Jaime called out. Renamed to `__hive__`
        // so the root inventory reads as a clean set of system dirs.
        // Consumers continue to use `store.hypercombRoot` as the
        // property name; only the on-disk name changed. Pre-existing
        // `hypercomb.io/` directories from older sessions become orphan
        // and are cleaned by `/sweep` (task #50).
        dir(Store.HIVE_DIRECTORY),
        dir(Store.BEES_DIRECTORY),
        dir(Store.DEPENDENCIES_DIRECTORY),
        dir(Store.LAYERS_DIRECTORY),
        dir(Store.RESOURCES_DIRECTORY),
        dir(Store.CLIPBOARD_DIRECTORY),
        dir(Store.HISTORY_DIRECTORY),
        dir(Store.THREADS_DIRECTORY),
        dir(Store.COMPUTATION_DIRECTORY),
        dir(Store.OPTIMIZED_DIRECTORY),
        dir(Store.MANIFESTS_DIRECTORY),
        dir(Store.OPTIMIZATION_DIRECTORY),
      ])
    } catch (err) {
      console.warn('[store] OPFS subdirectory init failed — running without persistent storage', err)
      this.#opfsAvailable = false
    }
  }

  // `domainLayersDirectory` removed: `__layers__/` has no subdirectories.
  // All layers live flat at `__layers__/<sig>` regardless of source
  // (boot install, sentinel sync, user commit, peer pull). Sig
  // identity makes per-domain partitioning unnecessary — same content
  // gets the same address from anywhere. Callers use `store.layers`
  // directly when they need the dir handle.

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

    const opfsUrl =
      new URL(`/opfs/${Store.BEES_DIRECTORY}/${signature}.js`, location.origin).toString()

    try {
      const cache = await caches.open(Store.CACHE_NAME)
      const existing = await cache.match(opfsUrl)
      if (!existing) {
        await cache.put(opfsUrl, new Response(buffer, { headers: this.jsNoStoreHeaders() }))
      }
    } catch {
      // ignore
    }
  }

  private jsNoStoreHeaders = (): Headers => {
    const h = new Headers()
    h.set('content-type', 'application/javascript')
    h.set('cache-control', 'no-store')
    return h
  }

  // -------------------------------------------------
  // content-addressed resource storage (__resources__)
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
      const existing = await this.resources.getFileHandle(signature)
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
      if ((await existing.getFile()).size === bytes.byteLength) return signature
    } catch { /* fall through and create */ }
    const handle = await this.resources.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
    } finally {
      await writable.close()
    }
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
  #stageToHost(signature: string, kind: 'resource' | 'layer', data: Blob | Uint8Array): void {
    try {
      if (this.#stagedToHost.has(signature)) return
      const hostSync = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(
        '@diamondcoreprocessor.com/HostSyncService',
      ) as { isEnabled?: () => boolean; enqueue?: (sig: string, kind: string, bytes: ArrayBuffer) => Promise<void> } | undefined
      if (!hostSync?.isEnabled?.() || !hostSync.enqueue) return
      this.#stagedToHost.add(signature)
      void (async () => {
        try {
          const bytes = data instanceof Blob
            ? await data.arrayBuffer()
            : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
          await hostSync.enqueue!(signature, kind, bytes)
        } catch {
          this.#stagedToHost.delete(signature)  // enqueue hiccup → retry on next read
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
  #fetchResourceFromHost = (signature: string): Promise<Blob | null> => {
    const existing = this.#hostFetchPending.get(signature)
    if (existing) return existing
    // Within a miss window → answer null instantly, no network. The egg
    // re-tries when the window lapses (or the bytes arrive locally first).
    const missUntil = this.#hostFetchMissUntil.get(signature)
    if (missUntil !== undefined) {
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

  // -------------------------------------------------
  // persistent decoration substrate (__optimization__)
  // -------------------------------------------------
  //
  // Holds optimization objects (Q&A, comms, future kinds) outside the
  // layer. Content-addressed by sha-256 of the bytes, same as
  // __resources__/, so identical content dedupes. The state-machine
  // wrappers around base objects read from here at access time; the
  // layer-commit primitive never sees this directory.

  public putOptimization = async (blob: Blob): Promise<string> => {
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
    return signature
  }

  public getOptimization = async (signature: string): Promise<Blob | null> => {
    if (!this.optimization) return null
    try {
      const handle = await this.optimization.getFileHandle(signature)
      return await handle.getFile()
    } catch { return null }
  }

  public removeOptimization = async (signature: string): Promise<boolean> => {
    if (!this.optimization) return false
    try { await this.optimization.removeEntry(signature); return true }
    catch { return false }
  }

  public listOptimizations = async (): Promise<string[]> => {
    if (!this.optimization) return []
    const sigs: string[] = []
    for await (const [name] of (this.optimization as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (/^[0-9a-f]{64}$/.test(name)) sigs.push(name)
    }
    return sigs
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

  #loadResource = (signature: string): Promise<Blob | null> => {
    const existing = this.#resourcePending.get(signature)
    if (existing) return existing
    const promise = (async () => {
      try {
        const handle = await this.resources.getFileHandle(signature)
        const file = await handle.getFile()
        // A 0-byte file under a non-empty sig is a corrupt/interrupted
        // write (see putResource — getFileHandle({create:true}) lands a
        // 0-byte target before the write completes). A raw Blob of size 0
        // is truthy, so returning it makes getResource short-circuit BEFORE
        // the host fallback — the bytes never re-fetch and render serves
        // emptiness forever. Treat it as a MISS so getResource falls
        // through to the host, whose write-through heals the file. Only the
        // empty-content sig may legitimately be 0 bytes.
        if (file.size === 0 && signature !== EMPTY_CONTENT_SIG) return null
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
   *    2. `__layers__/<sig>` pool (single file read)
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

  /** Read bytes from the sig-keyed layer pool at `__layers__/<sig>`.
   *  Single direct file read; absent → null. The pool is content-
   *  addressed: sig === hash(bytes), so an entry can never be stale,
   *  only present or absent. Markers in `__history__/<lineage>/<NNNN>`
   *  reference into this pool. */
  public getLayerPoolBytes = async (signature: string): Promise<Uint8Array | null> => {
    if (!this.layers) return null
    try {
      const handle = await this.layers.getFileHandle(signature, { create: false })
      const file = await handle.getFile()
      const bytes = new Uint8Array(await file.arrayBuffer())
      // The warmup/preloader reads layers through the pool directly (not via
      // getLayerBytes), so without this the author only pushed the branches it
      // navigated, leaving sibling tiles 404 on the relay. Push here too so the
      // FULL walked tree reaches the host.
      this.#stageToHost(signature, 'layer', bytes)
      return bytes
    } catch { return null }
  }

  /** Write bytes to the sig-keyed layer pool at `__layers__/<sig>`.
   *  Idempotent (sig === hash(bytes), so identical writes produce
   *  identical bytes). Best-effort; the marker is the canonical
   *  reference, the pool entry is its resolved content. */
  public writeLayerBytes = async (signature: string, bytes: ArrayBuffer): Promise<void> => {
    if (!this.layers) return
    try {
      const handle = await this.layers.getFileHandle(signature, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort */ }
  }

  /** Legacy alias for `getLayerPoolBytes` against `__optimized__/<sig>`.
   *  Pre-migration data lives here; readers fall back to it after the
   *  sig-keyed `__layers__/<sig>` pool misses. New writes go to the
   *  pool only; this method exists for back-compat with stored data. */
  public getOptimizedBytes = async (signature: string): Promise<Uint8Array | null> => {
    if (!this.optimized) return null
    try {
      const handle = await this.optimized.getFileHandle(signature, { create: false })
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch { return null }
  }

  /** Legacy mirror writer — keeps `__optimized__/<sig>` populated for
   *  pre-migration readers. New code should call `writeLayerBytes`
   *  (which targets the canonical `__layers__/<sig>` pool). */
  public writeOptimizedBytes = async (signature: string, bytes: ArrayBuffer): Promise<void> => {
    if (!this.optimized) return
    try {
      const handle = await this.optimized.getFileHandle(signature, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort */ }
  }

  /** Read the children manifest for a parent layer sig. Returns the
   *  parsed array of resolved child layer objects, or null if absent.
   *  Hot path on cold load — single file read, no per-child sig→layer
   *  walks against the bag. */
  public readChildrenManifest = async (
    parentLayerSig: string,
  ): Promise<Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> | null> => {
    if (!this.manifests) return null
    try {
      const handle = await this.manifests.getFileHandle(parentLayerSig, { create: false })
      const file = await handle.getFile()
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) return null
      return parsed
    } catch { return null }
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
      // `__layers__/<sig>` is the only place layer bytes live —
      // boot install, sentinel sync, user commits, peer pulls all
      // write here. One pool, content-addressed, no fallbacks.
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

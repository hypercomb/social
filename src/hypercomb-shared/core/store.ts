// hypercomb-shared/core/store.ts
// hypercomb-web/src/app/core/store.ts

import { Bee, EffectBus, SignatureService, isSignature } from '@hypercomb/core'

type BeeCtor = new () => Bee

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

    const buildInstance = (mod: Record<string, unknown>): Bee | null => {
      const ctors: BeeCtor[] = []

      for (const value of Object.values(mod)) {
        if (typeof value !== 'function') continue
        const proto = (value as any).prototype
        if (!proto) continue
        ctors.push(value as unknown as BeeCtor)
      }

      if (!ctors.length) return null

      for (const Ctor of ctors) {
        try {
          const instance = new Ctor()
          if (instance) return instance
        } catch {
          // ignore and try next export
        }
      }

      return null
    }

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

      // Find the bee by class identity. Each bee module exports its
      // class; its side-effect `register(key, new SomeClass())` puts an
      // instance in IoC whose constructor === SomeClass. We scan IoC for
      // the entry whose constructor matches one of this module's exports.
      //
      // This is parallel-safe (class identity is stable across imports)
      // unlike the previous "new keys since snapshot" scan, which under
      // concurrent loads returned the same first-registered instance to
      // every caller.
      const exportedCtors = new Set<unknown>()
      for (const value of Object.values(mod)) {
        if (typeof value === 'function' && (value as any).prototype) {
          exportedCtors.add(value)
        }
      }
      if (exportedCtors.size > 0) {
        for (const key of window.ioc.list()) {
          const candidate = window.ioc.get(key) as any
          if (candidate == null || typeof candidate !== 'object') continue
          if (typeof candidate.pulse !== 'function') continue
          if (exportedCtors.has(candidate.constructor)) {
            return candidate as Bee
          }
        }
      }

      // No singleton match — fall back to buildInstance (creates fresh).
      return buildInstance(mod)
    } catch {
      return null
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

  public putResource = async (blob: Blob): Promise<string> => {
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
      await this.resources.getFileHandle(signature)
      return signature
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
    EffectBus.emit('content:wrote', { sig: signature, kind: 'resource' as const, bytes })
    return signature
  }

  readonly #resourceCache = new Map<string, Blob>()
  readonly #resourcePending = new Map<string, Promise<Blob | null>>()

  public getResource = async (signature: string): Promise<Blob | null> => {
    const cached = this.#resourceCache.get(signature)
    if (cached) return cached
    return this.#loadResource(signature)
  }

  /** Prefetch a resource into the in-memory cache. Safe to call concurrently
   *  for the same signature — in-flight loads are deduped. */
  public preheatResource = async (signature: string): Promise<Blob | null> =>
    this.getResource(signature)

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
  public resolve = async <T = unknown>(value: unknown): Promise<T> => {
    if (!isSignature(value)) return value as T
    const cached = this.#parsedResourceCache.get(value)
    if (cached !== undefined) return cached as T
    const pending = this.#parsedResourcePending.get(value)
    if (pending) return pending as Promise<T>
    const promise = (async (): Promise<T> => {
      try {
        const blob = await this.getResource(value)
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
    if (cached) { this.#perfStats.cacheHits++; return cached }
    const pending = this.#layerBytesPending.get(signature)
    if (pending) { this.#perfStats.pendingHits++; return pending }
    this.#perfStats.cacheMisses++
    const promise = this.#loadLayerBytes(signature)
    this.#layerBytesPending.set(signature, promise)
    try {
      const bytes = await promise
      if (bytes) this.#layerBytesCache.set(signature, bytes)
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
      return new Uint8Array(await file.arrayBuffer())
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

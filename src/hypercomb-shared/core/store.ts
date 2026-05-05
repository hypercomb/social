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

  public static readonly BEES_DIRECTORY = '__bees__'
  public static readonly DEPENDENCIES_DIRECTORY = '__dependencies__'
  public static readonly LAYERS_DIRECTORY = '__layers__'
  public static readonly RESOURCES_DIRECTORY = '__resources__'
  public static readonly CLIPBOARD_DIRECTORY = '__clipboard__'
  public static readonly HISTORY_DIRECTORY = '__history__'
  public static readonly THREADS_DIRECTORY = '__threads__'
  public static readonly COMPUTATION_DIRECTORY = '__computation__'
  /** Render-cache decorations: pre-expanded, sig-keyed snapshots produced
   *  passively after first render. Lookups for a sig check this directory
   *  first — single file read, content already inlined — before falling
   *  back to walking history bags. Pure derived state; can be deleted and
   *  regenerated from the merkle truth in `__history__/`. */
  public static readonly OPTIMIZED_DIRECTORY = '__optimized__'

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
      ] = await Promise.all([
        dir('hypercomb.io'),
        dir(Store.BEES_DIRECTORY),
        dir(Store.DEPENDENCIES_DIRECTORY),
        dir(Store.LAYERS_DIRECTORY),
        dir(Store.RESOURCES_DIRECTORY),
        dir(Store.CLIPBOARD_DIRECTORY),
        dir(Store.HISTORY_DIRECTORY),
        dir(Store.THREADS_DIRECTORY),
        dir(Store.COMPUTATION_DIRECTORY),
        dir(Store.OPTIMIZED_DIRECTORY),
      ])
    } catch (err) {
      console.warn('[store] OPFS subdirectory init failed — running without persistent storage', err)
      this.#opfsAvailable = false
    }
  }

  public domainLayersDirectory = async (
    domain: string,
    create: boolean = false
  ): Promise<FileSystemDirectoryHandle> => {
    return await this.layers.getDirectoryHandle(domain, { create })
  }

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

      // Snapshot IoC keys before import so we can detect self-registration
      const keysBefore = new Set(window.ioc.list())

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

      // If the module's side-effect already registered a bee, reuse it
      // instead of creating a duplicate via buildInstance().
      // Use duck-typing instead of instanceof: bee bundles import Bee from the
      // import-mapped runtime URL, while this file uses the Vite-resolved path —
      // two different class objects, so instanceof always fails across the boundary.
      let selfRegistered = false
      for (const key of window.ioc.list()) {
        if (keysBefore.has(key)) continue
        selfRegistered = true
        const value = window.ioc.get(key)
        if (value != null && typeof (value as any).pulse === 'function') return value as Bee
      }

      // Module self-registered as non-Bee — skip buildInstance to avoid duplicates
      if (selfRegistered) return null

      // Fallback for modules without self-registration side-effects
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

  // Sig → "<domain>/<filename>" index, built on first lookup miss by scanning
  // every domain dir once. After that, getFileHandle goes directly to the right
  // place — no per-fetch domain scan, no exception loop.
  // The index covers what's on disk at build time; new commits add entries.
  #layerIndex = new Map<string, { domain: string; filename: string }>()
  #layerIndexBuilt = false
  #layerIndexBuilding: Promise<void> | null = null

  // PERF INSTRUMENTATION (temporary — remove after diagnosis)
  #perfStats = {
    cacheHits: 0,
    cacheMisses: 0,
    pendingHits: 0,
    loadCalls: 0,
    totalLoadMs: 0,
    indexHits: 0,
    indexBuildMs: 0,
    indexEntries: 0,
  }
  public dumpPerfStats(): void {
    const s = this.#perfStats
    console.log('[store-perf]', JSON.stringify(s, null, 2))
    console.log(`[store-perf] avg load ms: ${s.loadCalls ? (s.totalLoadMs / s.loadCalls).toFixed(2) : 0}`)
  }

  /** Read a layer JSON by signature. Tiered lookup:
   *    1. In-memory layerBytesCache (hot, instant)
   *    2. `__optimized__/<sig>` (single file read, pre-expanded — fast)
   *    3. `__layers__/<domain>/<sig>` history fallback (slow)
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

  /** Read the pre-expanded render-cache decoration for a sig from
   *  `__optimized__/<sig>`. Returns null if absent. Single file read,
   *  no domain scan. Decorations are written passively after first render
   *  / commitLayer; safe to delete and regenerate from history. */
  public getOptimizedBytes = async (signature: string): Promise<Uint8Array | null> => {
    if (!this.optimized) return null
    try {
      const handle = await this.optimized.getFileHandle(signature, { create: false })
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch { return null }
  }

  /** Write a pre-expanded layer decoration to `__optimized__/<sig>`.
   *  Idempotent — same content overwrites same file. Best-effort; any
   *  error is silent because the decoration is pure cache. */
  public writeOptimizedBytes = async (signature: string, bytes: ArrayBuffer): Promise<void> => {
    if (!this.optimized) return
    try {
      const handle = await this.optimized.getFileHandle(signature, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* cache miss on next read is fine */ }
  }

  /** Scans every domain dir once and indexes every layer file by signature.
   *  Idempotent and lazy — only runs on first cache miss after construction. */
  #ensureLayerIndex = async (): Promise<void> => {
    if (this.#layerIndexBuilt) return
    if (this.#layerIndexBuilding) return this.#layerIndexBuilding
    this.#layerIndexBuilding = (async () => {
      const t0 = performance.now()
      const domainNames: string[] = []
      for await (const [name, entry] of (this.layers as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        if (entry.kind === 'directory') domainNames.push(name)
      }
      for (const domain of domainNames) {
        const domainDir = await this.layers.getDirectoryHandle(domain).catch(() => null)
        if (!domainDir) continue
        for await (const [filename, entry] of (domainDir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
          if (entry.kind !== 'file') continue
          const sig = filename.replace(/\.json$/i, '')
          if (!this.#layerIndex.has(sig)) {
            this.#layerIndex.set(sig, { domain, filename })
          }
        }
      }
      this.#layerIndexBuilt = true
      this.#perfStats.indexBuildMs = performance.now() - t0
      this.#perfStats.indexEntries = this.#layerIndex.size
      console.log(`[store-perf] layer index built: ${this.#layerIndex.size} entries in ${this.#perfStats.indexBuildMs.toFixed(2)}ms`)
    })()
    try { await this.#layerIndexBuilding } finally { this.#layerIndexBuilding = null }
  }

  #loadLayerBytes = async (signature: string): Promise<Uint8Array | null> => {
    const t0 = performance.now()
    this.#perfStats.loadCalls++
    try {
      // Tier 1: pre-expanded render decoration (single file, no scan).
      const optimized = await this.getOptimizedBytes(signature)
      if (optimized) return optimized

      // Tier 2: indexed history layer file (one direct file read).
      await this.#ensureLayerIndex()
      const hit = this.#layerIndex.get(signature)
      if (!hit) return null
      this.#perfStats.indexHits++
      const domainDir = await this.layers.getDirectoryHandle(hit.domain).catch(() => null)
      if (!domainDir) return null
      const handle = await domainDir.getFileHandle(hit.filename).catch(() => null)
      if (!handle) return null
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } finally {
      this.#perfStats.totalLoadMs += performance.now() - t0
    }
  }

  /** Update the layer index when a new layer is committed to OPFS. Callers that
   *  write layer files should invoke this so subsequent reads find them via the
   *  index rather than triggering a rebuild. */
  public registerLayer(signature: string, domain: string, filename = signature): void {
    if (!this.#layerIndex.has(signature)) {
      this.#layerIndex.set(signature, { domain, filename })
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

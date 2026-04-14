// hypercomb-shared/core/store.ts
// hypercomb-web/src/app/core/store.ts

import { Bee, SignatureService } from '@hypercomb/core'

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

  #initialized = false

  // -------------------------------------------------
  // init
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.opfsRoot = await navigator.storage.getDirectory()

    const dir = (name: string) =>
      this.opfsRoot.getDirectoryHandle(name, { create: true })

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
    ])
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
    const handle = await this.resources.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
    } finally {
      await writable.close()
    }
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

  #loadResource = (signature: string): Promise<Blob | null> => {
    const existing = this.#resourcePending.get(signature)
    if (existing) return existing
    const promise = (async () => {
      try {
        const handle = await this.resources.getFileHandle(signature)
        const blob = await handle.getFile()
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

  /** Read a layer JSON by signature, scanning per-domain subdirectories.
   *  Layers live at __layers__/<domain>/<sig> or __layers__/<domain>/<sig>.json. */
  public getLayerBytes = async (signature: string): Promise<Uint8Array | null> => {
    const domainNames: string[] = []
    for await (const [name, entry] of (this.layers as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (entry.kind === 'directory') domainNames.push(name)
    }
    for (const name of domainNames) {
      const domainDir = await this.layers.getDirectoryHandle(name).catch(() => null)
      if (!domainDir) continue
      for (const fileName of [signature, `${signature}.json`]) {
        try {
          const handle = await domainDir.getFileHandle(fileName)
          const file = await handle.getFile()
          return new Uint8Array(await file.arrayBuffer())
        } catch { /* try next */ }
      }
    }
    return null
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

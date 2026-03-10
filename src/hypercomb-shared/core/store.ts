// hypercomb-shared/core/store.ts

import { Bee, SignatureService, type LayerV2, computeLineageSig } from '@hypercomb/core'

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
  public static readonly RESOURCES_DIRECTORY = '__resources__'
  public static readonly HISTORY_DIRECTORY = '__history__'

  static readonly #SNAPSHOT_FILE = '__snapshot__.json'
  static readonly #CACHE_NAME = 'hypercomb-modules-v2'

  public opfsRoot!: FileSystemDirectoryHandle
  public bees!: FileSystemDirectoryHandle
  public dependencies!: FileSystemDirectoryHandle
  public resources!: FileSystemDirectoryHandle
  public history!: FileSystemDirectoryHandle

  #initialized = false

  // -------------------------------------------------
  // live cache (lineageSig → latest layer snapshot)
  // -------------------------------------------------

  #liveCache = new Map<string, LayerV2>()

  public get liveCache(): ReadonlyMap<string, LayerV2> { return this.#liveCache }

  public getLayer = (lineageSig: string): LayerV2 | null => {
    return this.#liveCache.get(lineageSig) ?? null
  }

  public resolveLayerForLineage = async (segments: string[]): Promise<LayerV2 | null> => {
    const sig = await computeLineageSig(segments)
    return this.getLayer(sig)
  }

  // -------------------------------------------------
  // list resources (__resources__/)
  // -------------------------------------------------

  public getListResource = async (listSig: string): Promise<string[]> => {
    try {
      const handle = await this.resources.getFileHandle(listSig)
      const file = await handle.getFile()
      const text = await file.text()
      if (text === '') return []
      return text.split('\n')
    } catch {
      return []
    }
  }

  // -------------------------------------------------
  // history bag operations
  // -------------------------------------------------

  public appendHistory = async (lineageSig: string, layer: LayerV2): Promise<void> => {
    const bagDir = await this.history.getDirectoryHandle(lineageSig, { create: true })

    // find next sequence number
    let maxSeq = 0
    for await (const name of (bagDir as any).keys()) {
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > maxSeq) maxSeq = n
    }

    const nextSeq = String(maxSeq + 1).padStart(8, '0')
    const handle = await bagDir.getFileHandle(nextSeq, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(JSON.stringify(layer))
    } finally {
      await writable.close()
    }

    // update live cache
    this.#liveCache.set(lineageSig, layer)
    this.dispatchEvent(new CustomEvent('change'))

    // persist snapshot (fire-and-forget)
    this.saveSnapshot().catch(() => {})
  }

  public replayHistory = async (lineageSig: string): Promise<LayerV2[]> => {
    const entries: LayerV2[] = []
    try {
      const bagDir = await this.history.getDirectoryHandle(lineageSig)
      const names: string[] = []
      for await (const name of (bagDir as any).keys()) names.push(name)
      names.sort()

      for (const name of names) {
        const handle = await bagDir.getFileHandle(name)
        const file = await handle.getFile()
        const text = await file.text()
        entries.push(JSON.parse(text) as LayerV2)
      }
    } catch {
      // bag doesn't exist yet
    }
    return entries
  }

  // -------------------------------------------------
  // snapshot (fast restore)
  // -------------------------------------------------

  public loadSnapshot = async (): Promise<boolean> => {
    try {
      const handle = await this.history.getFileHandle(Store.#SNAPSHOT_FILE)
      const file = await handle.getFile()
      const text = await file.text()
      const data = JSON.parse(text) as Record<string, LayerV2>

      this.#liveCache.clear()
      for (const [lineageSig, layer] of Object.entries(data)) {
        this.#liveCache.set(lineageSig, layer)
      }

      this.dispatchEvent(new CustomEvent('change'))
      return true
    } catch {
      return false
    }
  }

  public saveSnapshot = async (): Promise<void> => {
    const data: Record<string, LayerV2> = {}
    for (const [lineageSig, layer] of this.#liveCache) {
      data[lineageSig] = layer
    }

    const handle = await this.history.getFileHandle(Store.#SNAPSHOT_FILE, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(JSON.stringify(data))
    } finally {
      await writable.close()
    }
  }

  public rebuildFromHistory = async (): Promise<void> => {
    this.#liveCache.clear()

    // walk all history bag directories
    for await (const [name, entry] of (this.history as any).entries()) {
      if (entry.kind !== 'directory') continue
      if (name === Store.#SNAPSHOT_FILE) continue

      const bagDir = entry as FileSystemDirectoryHandle
      const fileNames: string[] = []
      for await (const fname of (bagDir as any).keys()) fileNames.push(fname)
      fileNames.sort()

      // latest entry = current state
      if (fileNames.length > 0) {
        const latestName = fileNames[fileNames.length - 1]!
        const handle = await bagDir.getFileHandle(latestName)
        const file = await handle.getFile()
        const text = await file.text()
        this.#liveCache.set(name, JSON.parse(text) as LayerV2)
      }
    }

    this.dispatchEvent(new CustomEvent('change'))
  }

  /**
   * Seed the live cache directly (used during install).
   */
  public seedLiveCache = (entries: Record<string, LayerV2>): void => {
    for (const [lineageSig, layer] of Object.entries(entries)) {
      this.#liveCache.set(lineageSig, layer)
    }
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -------------------------------------------------
  // init
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.opfsRoot = await navigator.storage.getDirectory()

    this.bees =
      await this.opfsRoot.getDirectoryHandle(Store.BEES_DIRECTORY, { create: true })

    this.dependencies =
      await this.opfsRoot.getDirectoryHandle(Store.DEPENDENCIES_DIRECTORY, { create: true })

    this.resources =
      await this.opfsRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })

    this.history =
      await this.opfsRoot.getDirectoryHandle(Store.HISTORY_DIRECTORY, { create: true })
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

      const opfsUrl = `/opfs/${Store.BEES_DIRECTORY}/${signature}.js`

      // Snapshot IoC keys before import so we can detect self-registration
      const keysBefore = new Set(window.ioc.list())

      let mod: Record<string, unknown> | null = null

      // seed bytes first so sw can serve exact module bytes, then import
      if (!mod) {
        await this.seedResourceCache(signature, buffer)
        mod = await tryImport(opfsUrl)
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

  #seedResourceCache = async (
    signature: string,
    buffer: ArrayBuffer
  ): Promise<void> => {

    const opfsUrl =
      new URL(`/opfs/${Store.BEES_DIRECTORY}/${signature}.js`, location.origin).toString()

    try {
      const cache = await caches.open(Store.#CACHE_NAME)
      const existing = await cache.match(opfsUrl)
      if (!existing) {
        await cache.put(opfsUrl, new Response(buffer, { headers: this.#jsNoStoreHeaders() }))
      }
    } catch {
      // ignore
    }
  }

  // keep old name for getBee compatibility
  private seedResourceCache = this.#seedResourceCache

  #jsNoStoreHeaders = (): Headers => {
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

  public getResource = async (signature: string): Promise<Blob | null> => {
    try {
      const handle = await this.resources.getFileHandle(signature)
      return await handle.getFile()
    } catch {
      return null
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

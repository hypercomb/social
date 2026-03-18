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

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb.io'
  public static readonly BEES_DIRECTORY = '__bees__'
  public static readonly DEPENDENCIES_DIRECTORY = '__dependencies__'
  public static readonly LAYERS_DIRECTORY = '__layers__'
  public static readonly RESOURCES_DIRECTORY = '__resources__'
  public static readonly CLIPBOARD_DIRECTORY = '__clipboard__'
  public static readonly HISTORY_DIRECTORY = '__history__'

  private static readonly CACHE_NAME = 'hypercomb-modules-v2'

  public opfsRoot!: FileSystemDirectoryHandle
  public hypercombRoot!: FileSystemDirectoryHandle
  public bees!: FileSystemDirectoryHandle
  public dependencies!: FileSystemDirectoryHandle
  public layers!: FileSystemDirectoryHandle
  public resources!: FileSystemDirectoryHandle
  public clipboard!: FileSystemDirectoryHandle
  public history!: FileSystemDirectoryHandle

  #initialized = false

  // -------------------------------------------------
  // current folder (within hypercomb root)
  // -------------------------------------------------

  public current!: FileSystemDirectoryHandle

  #currentSegments: readonly string[] = []

  public get currentSegments(): readonly string[] { return this.#currentSegments }

  public readonly setCurrentHandle = (
    dir: FileSystemDirectoryHandle,
    segments: readonly string[]
  ): void => {
    this.current = dir
    this.#currentSegments = [...segments]
    this.dispatchEvent(new CustomEvent('change'))
  }

  public readonly resetCurrent = (): void => {
    this.setCurrentHandle(this.hypercombRoot, [])
  }

  // caller can use this when "moving to a seed" (read-only traversal)
  public readonly setCurrent = async (
    segments: readonly string[]
  ): Promise<FileSystemDirectoryHandle | null> => {

    let dir = this.hypercombRoot
    const clean: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = (segments[i] ?? '').trim()
      if (!seg || seg === '.' || seg === '..') continue

      try {
        dir = await dir.getDirectoryHandle(seg)
        clean.push(seg)
      } catch {
        return null
      }
    }

    this.setCurrentHandle(dir, clean)
    return dir
  }

  // -------------------------------------------------
  // init
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.opfsRoot = await navigator.storage.getDirectory()

    this.hypercombRoot =
      await this.opfsRoot.getDirectoryHandle(Store.HYPERCOMB_DIRECTORY, { create: true })

    this.bees =
      await this.opfsRoot.getDirectoryHandle(Store.BEES_DIRECTORY, { create: true })

    this.dependencies =
      await this.opfsRoot.getDirectoryHandle(Store.DEPENDENCIES_DIRECTORY, { create: true })

    this.layers =
      await this.opfsRoot.getDirectoryHandle(Store.LAYERS_DIRECTORY, { create: true })

    this.resources =
      await this.opfsRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })

    this.clipboard =
      await this.opfsRoot.getDirectoryHandle(Store.CLIPBOARD_DIRECTORY, { create: true })

    this.history =
      await this.opfsRoot.getDirectoryHandle(Store.HISTORY_DIRECTORY, { create: true })

    // default current is the hypercomb root
    this.resetCurrent()
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

  private seedResourceCache = async (
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

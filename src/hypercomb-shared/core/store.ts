// hypercomb-shared/core/store.ts
// hypercomb-web/src/app/core/store.ts

import { signal } from '@angular/core'
import { Drone, SignatureService } from '@hypercomb/core'

type DroneCtor = new () => Drone

export type DevManifest = {
  dependencies: Record<string, string>
  imports: Record<string, string>
  resources?: Record<string, string[]>
  domains?: Record<string, unknown> | unknown,
  root: string
}

export class Store {

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb.io'
  public static readonly DRONES_DIRECTORY = '__drones__'
  public static readonly DEPENDENCIES_DIRECTORY = '__dependencies__'
  public static readonly LAYERS_DIRECTORY = '__layers__'

  private static readonly CACHE_NAME = 'hypercomb-modules-v2'

  public opfsRoot!: FileSystemDirectoryHandle
  public hypercombRoot!: FileSystemDirectoryHandle
  public drones!: FileSystemDirectoryHandle
  public dependencies!: FileSystemDirectoryHandle
  public layers!: FileSystemDirectoryHandle

  // -------------------------------------------------
  // current folder (within hypercomb root)
  // -------------------------------------------------

  public current!: FileSystemDirectoryHandle
  public readonly currentSegments = signal<readonly string[]>([])

  public readonly setCurrentHandle = (
    dir: FileSystemDirectoryHandle,
    segments: readonly string[]
  ): void => {
    this.current = dir
    this.currentSegments.set([...segments])
  }

  public readonly resetCurrent = (): void => {
    this.setCurrentHandle(this.hypercombRoot, [])
  }

  // caller can use this when "moving to a seed"
  public readonly setCurrent = async (
    segments: readonly string[],
    create: boolean = false
  ): Promise<FileSystemDirectoryHandle | null> => {

    let dir = this.hypercombRoot
    const clean: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = (segments[i] ?? '').trim()
      if (!seg || seg === '.' || seg === '..') continue

      try {
        dir = await dir.getDirectoryHandle(seg, { create })
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
    this.opfsRoot = await navigator.storage.getDirectory()

    this.hypercombRoot =
      await this.opfsRoot.getDirectoryHandle(Store.HYPERCOMB_DIRECTORY, { create: true })

    this.drones =
      await this.opfsRoot.getDirectoryHandle(Store.DRONES_DIRECTORY, { create: true })

    this.dependencies =
      await this.opfsRoot.getDirectoryHandle(Store.DEPENDENCIES_DIRECTORY, { create: true })

    this.layers =
      await this.opfsRoot.getDirectoryHandle(Store.LAYERS_DIRECTORY, { create: true })

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
  // drone loader
  // -------------------------------------------------

  public getDrone = async (
    signature: string,
    buffer: ArrayBuffer
  ): Promise<Drone | null> => {

    const tryImport = async (url: string): Promise<Record<string, unknown> | null> => {
      try {
        const mod = await import(/* @vite-ignore */ url)
        return mod as any
      } catch (err) {
        console.log(`[store] failed to import ${url}:`, err)
        return null
      }
    }

    const buildInstance = (mod: Record<string, unknown>): Drone | null => {
      const ctors: DroneCtor[] = []

      for (const value of Object.values(mod)) {
        if (typeof value !== 'function') continue
        const proto = (value as any).prototype
        if (!proto) continue
        ctors.push(value as unknown as DroneCtor)
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

      const opfsUrl = `/opfs/${Store.DRONES_DIRECTORY}/${signature}.js`

      // Snapshot IoC keys before import so we can detect self-registration
      const keysBefore = new Set(window.ioc.list())

      let mod: Record<string, unknown> | null = null

      // seed bytes first so sw can serve exact module bytes, then import
      if (!mod) {
        await this.seedResourceCache(signature, buffer)
        mod = await tryImport(opfsUrl)
      }

      if (!mod || typeof mod !== 'object') return null

      // If the module's side-effect already registered a drone, reuse it
      // instead of creating a duplicate via buildInstance()
      for (const key of window.ioc.list()) {
        if (keysBefore.has(key)) continue
        const value = window.ioc.get(key)
        if (value instanceof Drone) return value
      }

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
      new URL(`/opfs/${Store.DRONES_DIRECTORY}/${signature}.js`, location.origin).toString()

    try {
      const cache = await caches.open(Store.CACHE_NAME)
      await cache.put(opfsUrl, new Response(buffer, { headers: this.jsNoStoreHeaders() }))
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
  // resource put
  // -------------------------------------------------

  public put = async (bytes: ArrayBuffer): Promise<string> => {
    const signature = await SignatureService.sign(bytes)

    const handle = await this.drones.getFileHandle(signature, { create: true })
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

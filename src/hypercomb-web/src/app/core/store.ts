// hypercomb-web/src/app/core/store.ts

import { Injectable } from '@angular/core'
import { Drone, SignatureService } from '@hypercomb/core'

type DroneCtor = new () => Drone

export type DevManifest = {
  dependencies: Record<string, string>
  imports: Record<string, string>
  resources?: Record<string, string[]>
  domains?: Record<string, unknown> | unknown,
  root: string
}

@Injectable({ providedIn: 'root' })
export class Store {

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb'
  public static readonly DRONES_DIRECTORY = '__drones__'
  public static readonly DEPENDENCIES_DIRECTORY = '__dependencies__'
  public static readonly LAYERS_DIRECTORY = '__layers__'

  private static readonly CACHE_NAME = 'hypercomb-modules-v1'

  public opfsRoot!: FileSystemDirectoryHandle
  private hypercombRoot!: FileSystemDirectoryHandle

  public drones!: FileSystemDirectoryHandle
  public dependencies!: FileSystemDirectoryHandle
  public layers!: FileSystemDirectoryHandle

  private devManifestLoaded = false
  private devManifest: DevManifest | null = null

  private devDroneDomainIndexBuilt = false
  private devDroneDomainBySig: Map<string, string> | null = null

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
  }

  // -------------------------------------------------
  // directories
  // -------------------------------------------------

  public hypercombDirectory = (): FileSystemDirectoryHandle => this.hypercombRoot
  public dronesDirectory = (): FileSystemDirectoryHandle => this.drones
  public dependenciesDirectory = (): FileSystemDirectoryHandle => this.dependencies
  public layersDirectory = (): FileSystemDirectoryHandle => this.layers

  public domainLayersDirectory = async (
    domain: string,
    create: boolean = false
  ): Promise<FileSystemDirectoryHandle> => {
    return await this.layers.getDirectoryHandle(domain, { create })
  }

  // -------------------------------------------------
  // dev manifest
  // -------------------------------------------------

  public getDevManifest = async (): Promise<DevManifest | null> => {
    if (this.devManifestLoaded) return this.devManifest
    this.devManifestLoaded = true

    try {
      const url = '/dev/name.manifest.js'
      const mod = await import(/* @vite-ignore */ url)
      this.devManifest = mod as any
      return this.devManifest
    } catch {
      this.devManifest = null
      return null
    }
  }

  private buildDevDroneDomainIndex = async (): Promise<void> => {
    if (this.devDroneDomainIndexBuilt) return
    this.devDroneDomainIndexBuilt = true

    const manifest = await this.getDevManifest()
    const resources = manifest?.resources

    if (!resources || typeof resources !== 'object') {
      this.devDroneDomainBySig = null
      return
    }

    const index = new Map<string, string>()

    for (const [domain, list] of Object.entries(resources)) {
      if (!Array.isArray(list)) continue

      for (const item of list) {
        if (typeof item !== 'string') continue

        const raw = item.trim()
        if (!raw) continue

        const sig = raw.endsWith('.js') ? raw.slice(0, -3) : raw
        if (!/^[a-f0-9]{64}$/i.test(sig)) continue

        index.set(sig, domain)
      }
    }

    this.devDroneDomainBySig = index.size ? index : null
  }

  private getDevDomainForDrone = async (signature: string): Promise<string | null> => {
    await this.buildDevDroneDomainIndex()
    return this.devDroneDomainBySig?.get(signature) ?? null
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
      const manifest = await this.getDevManifest()
      const devVersion = manifest?.root ? encodeURIComponent(manifest.root) : `${Date.now()}`

      const devDomain = await this.getDevDomainForDrone(signature)

      const devUrl =
        devDomain
          ? `/dev/${devDomain}/${Store.DRONES_DIRECTORY}/${signature}.js?v=${devVersion}`
          : null

      const opfsUrl = `/opfs/${Store.DRONES_DIRECTORY}/${signature}.js`

      // dev is authority if manifest knows the domain for this sig
      let mod: Record<string, unknown> | null = null
      if (devUrl) {
        mod = await tryImport(devUrl)
      }

      // fallback to opfs (seed bytes first so sw can serve exact module bytes)
      if (!mod) {
        await this.seedResourceCache(signature, buffer)
        mod = await tryImport(opfsUrl)
      }

      if (!mod || typeof mod !== 'object') return null
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

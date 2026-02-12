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
      this.devManifest = mod
    } catch {
      this.devManifest = null
    }

    return this.devManifest
  }



  // -------------------------------------------------
  // drone loader
  // -------------------------------------------------

  public getDrone = async (
    signature: string,
    buffer: ArrayBuffer
  ): Promise<Drone | null> => {

    try {
      await this.seedResourceCache(signature, buffer)

      let mod: Record<string, unknown> | null = null
      try {
        const url = `/opfs/__drones__/${signature}`
        mod = (await import(/* @vite-ignore */ url)) as any
      } catch (err) {
        console.error(`[store] failed to import module for signature ${signature}:`, err)
        return null
      }

      if (!mod || typeof mod !== 'object') return null

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

          if (!instance) continue


          return instance
        } catch {
          // ignore and try next export
        }
      }
    } catch {
      // ignore
    }

    return null
  }

  private seedResourceCache = async (
    signature: string,
    buffer: ArrayBuffer
  ): Promise<void> => {

    const opfsUrl =
      new URL(`/opfs/__drones__/${signature}.js`, location.origin).toString()

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

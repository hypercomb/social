// hypercomb-web/src/app/core/store.ts

import { Injectable } from '@angular/core'
import { Drone, SignatureService } from '@hypercomb/core'

type DroneCtor = new () => Drone

export type DevManifest = {
  // import map source: "@domain/seg" -> "/dev/<domain>/index.seg.runtime.js"
  imports: Record<string, string>
  // resource discovery: "<domain>" -> ["<sig>", ...]
  // optional (but required if you want dev drones to preload deterministically)
  resources?: Record<string, string[]>
  // legacy support: "<domain>" -> runtime url that exports { resources: string[] }
  domains?: Record<string, unknown>
}

@Injectable({ providedIn: 'root' })
export class Store {

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb'
  public static readonly RESOURCES_DIRECTORY = '__resources__'

  public opfsRoot!: FileSystemDirectoryHandle
  private hypercombRoot!: FileSystemDirectoryHandle
  public resources!: FileSystemDirectoryHandle

  // dev manifest cache (used by discovery services)
  private devManifestLoaded = false
  private devManifest: DevManifest | null = null

  // -------------------------------------------------
  // initialization
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    // opfs root is neutral. do not store anything directly here unless explicitly scoped.
    this.opfsRoot = await navigator.storage.getDirectory()

    // fixed platform root for all platform-owned data
    this.hypercombRoot =
      await this.opfsRoot.getDirectoryHandle(Store.HYPERCOMB_DIRECTORY, { create: true })

    // compatibility cache: resources stored by signature under opfs/__resources__
    this.resources =
      await this.opfsRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })
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

      // supports either:
      // - export const nameManifest = { imports, resources, domains }
      // - export const imports = { ... } (and optional resources/domains)
      const raw = (mod as any)?.nameManifest ?? mod

      const imports = this.readRecordOfStrings((raw as any)?.imports ?? (mod as any)?.imports)
      if (!imports) {
        this.devManifest = null
        return this.devManifest
      }

      const resources = this.readRecordOfStringArrays((raw as any)?.resources ?? (mod as any)?.resources) ?? undefined
      const domains = this.readRecordUnknown((raw as any)?.domains ?? (mod as any)?.domains) ?? undefined

      this.devManifest = { imports, resources, domains }
    } catch {
      this.devManifest = null
    }

    return this.devManifest
  }

  private readRecordOfStrings = (v: unknown): Record<string, string> | null => {
    if (!v || typeof v !== 'object') return null
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k.trim()) continue
      if (typeof val !== 'string' || !val.trim()) continue
      out[k] = val
    }
    return Object.keys(out).length ? out : null
  }

  private readRecordOfStringArrays = (v: unknown): Record<string, string[]> | null => {
    if (!v || typeof v !== 'object') return null
    const out: Record<string, string[]> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k.trim()) continue
      if (!Array.isArray(val)) continue

      const list = (val as unknown[])
        .filter(x => typeof x === 'string' && x.trim().length)
        .map(x => (x as string).trim())

      if (!list.length) continue
      out[k] = list
    }
    return Object.keys(out).length ? out : null
  }

  private readRecordUnknown = (v: unknown): Record<string, unknown> | null => {
    if (!v || typeof v !== 'object') return null
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k.trim()) continue
      out[k] = val
    }
    return Object.keys(out).length ? out : null
  }

  // -------------------------------------------------
  // drone loading (bytes -> module)
  // -------------------------------------------------

  public getDrone = async (signature: string, buffer: ArrayBuffer): Promise<Drone | null> => {
    const { register } = window.ioc
    console.log('[store] loading drone module:', signature)

    try {
      // bytes import path (works for opfs and dev fetch)
      const blob = new Blob([buffer], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)

      let module: unknown = null

      try {
        module = await import(/* @vite-ignore */ url)
        console.log('[store] module loaded:', module)
      } catch (err) {
        console.error(`[store] failed to import drone module from blob URL:`, err)
      } finally {
        URL.revokeObjectURL(url)
      }

      // collect drone ctors only
      const ctors: DroneCtor[] = []

      for (const value of Object.values(module as Record<string, unknown>)) {
        if (typeof value !== 'function') continue
        const proto = (value as any).prototype
        if (!proto) continue
        ctors.push(value as unknown as DroneCtor)
      }

      if (!ctors.length) {
        console.warn('[store] no drone exports found. exports:', Object.keys(module as any))
        return null
      }

      // first ctor that actually instantiates a drone wins
      for (const Ctor of ctors) {
        try {
          const instance = new Ctor()

          // guard: must look like a drone instance
          if (!(instance instanceof Drone)) continue
          if (typeof instance.name !== 'string' || !instance.name.trim()) continue

          register(instance.name, instance)
          return instance
        } catch {
          // ignore bad exports and keep scanning
          console.log(`[store] failed to instantiate drone from ctor. trying next if available.`)
        }
      }
    } catch {
      // ignore and keep scanning
    }

    return null
  }

  // -------------------------------------------------
  // directory helpers
  // -------------------------------------------------

  public opfsDirectory = (): FileSystemDirectoryHandle => this.opfsRoot
  public hypercombDirectory = (): FileSystemDirectoryHandle => this.hypercombRoot
  public resourcesDirectory = (): FileSystemDirectoryHandle => this.resources

  public domainDirectory = async (name: string, create: boolean = false): Promise<FileSystemDirectoryHandle> => {
    const raw = (name ?? '').trim()

    if (!raw || raw === '.' || raw === '..' || raw.startsWith('__')) {
      throw new Error(`[store] invalid domain name: "${raw}"`)
    }

    if (create) {
      const ok = /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
      if (!ok) {
        throw new Error(`[store] refused to create non-host domain: "${raw}"`)
      }
    }

    return await this.opfsRoot.getDirectoryHandle(raw, { create })
  }

  public domainResourcesDirectory = async (domain: string, create: boolean = false): Promise<FileSystemDirectoryHandle> => {
    const dir = await this.domainDirectory(domain, create)
    return await dir.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create })
  }

  // -------------------------------------------------
  // persistence (compat cache)
  // -------------------------------------------------

  public put = async (bytes: ArrayBuffer): Promise<string> => {
    const signature = await SignatureService.sign(bytes)

    const handle = await this.resources.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    return signature
  }
}

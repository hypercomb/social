// src/app/core/store.ts

import { inject, Injectable } from '@angular/core'
import { Drone, type DroneResolver, get, hypercomb, SignatureService } from '@hypercomb/core'
import { CompletionUtility } from './completion-utility'
import { ScriptPreloaderService } from './script-preloader.service'
import { DirectoryWalkerService } from './directory-walker.service'

type DroneCtor = new () => Drone

@Injectable({ providedIn: 'root' })
export class Store implements DroneResolver {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb'
  private static readonly RESOURCES_DIRECTORY = '__resources__'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly completion = inject(CompletionUtility)
  private readonly preloader = inject(ScriptPreloaderService)
  private readonly walker = inject(DirectoryWalkerService)

  // -------------------------------------------------
  // file system handles
  // -------------------------------------------------

  public opfsRoot!: FileSystemDirectoryHandle
  private hypercombRoot!: FileSystemDirectoryHandle
  private testDomainRoot!: FileSystemDirectoryHandle
  private resources!: FileSystemDirectoryHandle

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    // opfs root is neutral. do not store anything directly here unless explicitly scoped.
    this.opfsRoot = await navigator.storage.getDirectory()

    // fixed platform root for all platform-owned data
    this.hypercombRoot = await this.opfsRoot.getDirectoryHandle(Store.HYPERCOMB_DIRECTORY, { create: true })

    // resources stored by signature under hypercomb/__resources__
    this.resources = await this.hypercombRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })

   // await this.preloader.initialize(this.resources)
  }

  // -------------------------------------------------
  // platform roots
  // -------------------------------------------------

  // opfs root directory
  public opfsDirectory = (): FileSystemDirectoryHandle => {
    return this.opfsRoot
  }

  // platform root directory (opfs/hypercomb)
  // never exposed in the browser address
  public hypercombDirectory = (): FileSystemDirectoryHandle => {
    return this.hypercombRoot
  }


  // resources root directory (opfs/hypercomb/__resources__)
  public resourcesDirectory = (): FileSystemDirectoryHandle => {
    return this.resources
  }

  // resolves any domain directory under opfs root
  // create is false by default so listing is passive
  // src/app/core/store.ts

  public domainDirectory = async (name: string, create: boolean = false): Promise<FileSystemDirectoryHandle> => {
    const raw = (name ?? '').trim()

    // do not allow internal/system folders to ever become "domains"
    // and do not allow empty or dot paths
    if (!raw || raw === '.' || raw === '..' || raw.startsWith('__')) {
      throw new Error(`[store] invalid domain name: "${raw}"`)
    }

    // only allow creation for host-like names (same rule as your domain ui intent)
    // read-only access can still attempt anything (create=false) without polluting root
    if (create) {
      const ok = /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
      if (!ok) {
        throw new Error(`[store] refused to create non-host domain: "${raw}"`)
      }
    }

    return await this.opfsRoot.getDirectoryHandle(raw, { create })
  }

  // -------------------------------------------------
  // drone resolution
  // -------------------------------------------------

  public find = async (name: string): Promise<Drone[]> => {
    const clean = this.completion.normalize(name)

    // 1) ioc first (source of truth)
    const existing = get<Drone>(clean)
    if (existing) return [existing]

    // 2) resolve module via preloader
    const descriptor = this.preloader.resolveByName(clean)
    if (!descriptor) return []

    const bytes = this.preloader.get(descriptor.signature)
    if (!bytes) return []

    // 3) import module
    const mod = await this.loadModule(bytes)

    // 4) get constructable drone exports (no side-effects)
    const ctors = this.extractDroneCtors(mod)
    if (!ctors.length) return []

    // 5) instantiate missing drones (auto-registers via base class)
    for (const Ctor of ctors) {
      const key = this.completion.normalize(Drone.key(Ctor.name))
      if (!get<Drone>(key)) {
        new Ctor()
      }
    }

    // 6) return instances from ioc (single source of truth)
    const out: Drone[] = []
    for (const Ctor of ctors) {
      const key = this.completion.normalize(Drone.key(Ctor.name))
      const inst = get<Drone>(key)
      if (inst) out.push(inst)
    }

    return out
  }

  // -------------------------------------------------
  // resource io
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

  public get = (signature: string): ArrayBuffer | null => {
    return this.preloader.get(signature) ?? null
  }

  public has = (signature: string): boolean => {
    return this.preloader.has(signature)
  }

  // -------------------------------------------------
  // module loader (bytes -> esm)
  // -------------------------------------------------

  private loadModule = async (bytes: ArrayBuffer): Promise<unknown> => {
    const blob = new Blob([bytes], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)

    try {
      return await import(/* @vite-ignore */ url)
    } catch (error) {
      console.error('[store] failed to load module', error)
      throw error
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // -------------------------------------------------
  // ctor extractor (safe, no side-effects)
  // -------------------------------------------------

  private extractDroneCtors = (module: unknown): DroneCtor[] => {
    const out: DroneCtor[] = []

    if (!module || typeof module !== 'object') return out

    for (const value of Object.values(module as Record<string, unknown>)) {
      if (typeof value !== 'function') continue

      const proto = (value as any).prototype
      if (!proto) continue

      // must look like a Drone subclass by shape
      if (typeof proto.encounter !== 'function') continue
      if (typeof proto.sensed !== 'function') continue

      out.push(value as unknown as DroneCtor)
    }

    if (!out.length) {
      console.warn('[store] no drone exports found. exports:', Object.keys(module as any))
    }

    return out
  }
}

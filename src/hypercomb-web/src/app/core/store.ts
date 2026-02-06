// src/app/core/store.ts

import { Injectable } from '@angular/core'
import { Drone, SignatureService } from '@hypercomb/core'

type DroneCtor = new () => Drone
// src/app/core/store.ts

// -------------------------------------------------
// platform roots
// -------------------------------------------------

type ModuleRoot = {
  baseUrl: string
  useHostedModules: boolean
}

const defaultRoot: ModuleRoot = {
  baseUrl: '/dev/essentials/drones',
  useHostedModules: false
}

@Injectable({ providedIn: 'root' })
export class Store {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb'
  public static readonly RESOURCES_DIRECTORY = '__resources__'


  // -------------------------------------------------
  // file system handless
  // -------------------------------------------------

  public opfsRoot!: FileSystemDirectoryHandle
  private hypercombRoot!: FileSystemDirectoryHandle
  public resources!: FileSystemDirectoryHandle

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    // opfs root is neutral. do not store anything directly here unless explicitly scoped.
    this.opfsRoot = await navigator.storage.getDirectory()

    // fixed platform root for all platform-owned data
    this.hypercombRoot = await this.opfsRoot.getDirectoryHandle(Store.HYPERCOMB_DIRECTORY, { create: true })

    // resources stored by signature under hypercomb/__resources__
    this.resources = await this.opfsRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })
  }

  // -------------------------------------------------
  // platform roots
  // -------------------------------------------------

public getDrone = async (signature: string, buffer: ArrayBuffer): Promise<Drone | null> => {
  const { register } = window.ioc
  console.log('[store] loading drone module:', signature)

  try {
    const root = (window as any).moduleRoot as ModuleRoot | undefined
    const cfg = root ?? defaultRoot

    // -------------------------------------------------
    // hosted dev import path (preferred when flagged)
    // -------------------------------------------------

    if (cfg.useHostedModules) {
      const url = `${cfg.baseUrl.replace(/\/+$/, '')}/${signature}`

      let module: unknown
      try {
        // keep dynamic import from being rewritten by bundlers
        module = await import(/* @vite-ignore */ url)
      } catch (error) {
        console.error('[store] failed to load hosted module', { signature, url, error })
        throw error
      }

      const ctors: DroneCtor[] = []

      for (const value of Object.values(module as Record<string, unknown>)) {
        if (typeof value !== 'function') continue
        const proto = (value as any).prototype
        if (!proto) continue
        ctors.push(value as unknown as DroneCtor)
      }

      if (!ctors.length) {
        console.warn('[store] no drone exports found. exports:', Object.keys(module as any))
      }

      for (const Ctor of ctors) {
        const instance = new Ctor()
        register(instance.name, instance)
        return instance
      }

      return null
    }

    // -------------------------------------------------
    // buffer import path (fallback for opfs/offline)
    // -------------------------------------------------

    let module: unknown = null
    const blob = new Blob([buffer], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)

    try {
      // keep dynamic import from being rewritten by bundlers
      module = await import(/* @vite-ignore */ url)
    } catch (error) {
      console.error('[store] failed to load module', error)
      throw error
    } finally {
      URL.revokeObjectURL(url)
    }

    const ctors: DroneCtor[] = []

    for (const value of Object.values(module as Record<string, unknown>)) {
      if (typeof value !== 'function') continue
      const proto = (value as any).prototype
      if (!proto) continue
      ctors.push(value as unknown as DroneCtor)
    }

    if (!ctors.length) {
      console.warn('[store] no drone exports found. exports:', Object.keys(module as any))
    }

    for (const Ctor of ctors) {
      const instance = new Ctor()
      register(instance.name, instance)
      return instance
    }
  } catch {
    // ignore and keep scanning
  }

  return null
}

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


}

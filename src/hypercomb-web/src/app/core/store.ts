// src/app/core/store.ts

import { Injectable } from '@angular/core'
import { Drone, register, SignatureService } from '@hypercomb/core'
type DroneCtor = new (signature: string) => Drone

@Injectable({ providedIn: 'root' })
export class Store {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly HYPERCOMB_DIRECTORY = 'hypercomb'
  private static readonly RESOURCES_DIRECTORY = '__resources__'


  // -------------------------------------------------
  // file system handles
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
    this.resources = await this.hypercombRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })
  }

  // -------------------------------------------------
  // platform roots
  // -------------------------------------------------

  public getDrone = async (signature: string): Promise<Drone | null> => {

    // each directory under opfsRoot is a domain (including "hypercomb")
    for await (const [domainName, entry] of this.opfsRoot.entries()) {
      if (entry.kind !== 'directory') continue

      // skip internal/system folders only
      if (domainName.startsWith('__')) continue

      try {
        // <domain>/__resources__/<signature>
        const domainDir = entry as FileSystemDirectoryHandle
        const resourcesDir = await domainDir.getDirectoryHandle(
          Store.RESOURCES_DIRECTORY,
          { create: false }
        )

        const fileHandle = await resourcesDir.getFileHandle(signature, { create: false })
        if (!fileHandle) continue


        const file = await fileHandle.getFile()
        const buffer = await file.arrayBuffer()

        const mod = await this.loadModule(buffer)

        const ctors = this.extractDroneCtors(mod)

        // 5) instantiate missing drones (auto-registers via base class)
        for (const Ctor of ctors) {
          const drone = new Ctor(signature)
          register(signature, drone)  
          return drone
        }

      } catch {
        // not in this domain, keep scanning
      }
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

  // -------------------------------------------------
  // module loader (bytes -> esm)
  // -------------------------------------------------

  private loadModule = async (bytes: ArrayBuffer): Promise<unknown> => {
    const text = new TextDecoder().decode(bytes).trim()

    // payload is guaranteed json at this point
    const payload = JSON.parse(text)

    const entry = payload.source?.entry
    const files = payload.source?.files

    if (!entry || !files || !files[entry]) {
      throw new Error('[store] invalid drone payload: missing bundle entry')
    }

    // base64 → binary
    const base64 = files[entry] as string
    const binary = atob(base64)
    const len = binary.length
    const buf = new Uint8Array(len)

    for (let i = 0; i < len; i++) {
      buf[i] = binary.charCodeAt(i)
    }

    // binary → js source
    const bundleText = new TextDecoder().decode(buf)

    // js source → esm module
    const blob = new Blob([bundleText], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)

    try {
      // keep dynamic import from being rewritten by bundlers
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

      out.push(value as unknown as DroneCtor)
    }

    if (!out.length) {
      console.warn('[store] no drone exports found. exports:', Object.keys(module as any))
    }

    return out
  }
}

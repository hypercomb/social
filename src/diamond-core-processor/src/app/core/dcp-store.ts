// diamond-core-processor/src/app/core/dcp-store.ts

//
// Mirrors the folder structure from hypercomb-shared/core/store.ts
// so that OPFS data can be directly copied between DCP and Hypercomb.
//
// Same directory names, same conventions, same signatures.
// DCP uses this as its local cache — fetched layers, bees, and deps
// are written here in the same layout Hypercomb expects.

import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class DcpStore {

  static readonly BEES_DIRECTORY = '__bees__'
  static readonly DEPENDENCIES_DIRECTORY = '__dependencies__'
  static readonly RESOURCES_DIRECTORY = '__resources__'
  static readonly PATCHES_DIRECTORY = '__patches__'

  #root!: FileSystemDirectoryHandle
  #bees!: FileSystemDirectoryHandle
  #dependencies!: FileSystemDirectoryHandle
  #resources!: FileSystemDirectoryHandle
  #patches!: FileSystemDirectoryHandle
  #initialized = false

  get root(): FileSystemDirectoryHandle { return this.#root }
  get bees(): FileSystemDirectoryHandle { return this.#bees }
  get dependencies(): FileSystemDirectoryHandle { return this.#dependencies }
  get resources(): FileSystemDirectoryHandle { return this.#resources }
  get patches(): FileSystemDirectoryHandle { return this.#patches }

  /**
   * Serialize a domain URL into an OPFS-safe folder name.
   * Strips the protocol, replaces `/` with `-`, lowercases.
   *
   *   https://mydomain.com/content  →  mydomain.com-content
   *   mydomain.com                  →  mydomain.com
   */
  static serializeDomain(input: string): string {
    let result = (input ?? '').trim()
    result = result.replace(/^https?:\/\//, '')
    result = result.replace(/\//g, '-')
    result = result.replace(/-+$/, '')
    return result.toLowerCase()
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return
    this.#initialized = true

    this.#root = await navigator.storage.getDirectory()
    this.#bees = await this.#root.getDirectoryHandle(DcpStore.BEES_DIRECTORY, { create: true })
    this.#dependencies = await this.#root.getDirectoryHandle(DcpStore.DEPENDENCIES_DIRECTORY, { create: true })
    this.#resources = await this.#root.getDirectoryHandle(DcpStore.RESOURCES_DIRECTORY, { create: true })
    this.#patches = await this.#root.getDirectoryHandle(DcpStore.PATCHES_DIRECTORY, { create: true })
  }

  async domainLayersDir(domain: string): Promise<FileSystemDirectoryHandle> {
    const key = DcpStore.serializeDomain(domain)
    return await this.#root.getDirectoryHandle(key, { create: true })
  }

  async domainPatchesDir(domain: string): Promise<FileSystemDirectoryHandle> {
    const key = DcpStore.serializeDomain(domain)
    return await this.#patches.getDirectoryHandle(key, { create: true })
  }

  /**
   * Returns the __layers__ subdirectory within a domain's patch folder.
   * Patched layers are stored here, separate from the original installation.
   */
  async patchedLayersDir(domain: string): Promise<FileSystemDirectoryHandle> {
    const patchDir = await this.domainPatchesDir(domain)
    return await patchDir.getDirectoryHandle('__layers__', { create: true })
  }

  /**
   * Returns the __bees__ subdirectory within a domain's patch folder.
   * Patched bees are stored here, separate from the original installation.
   */
  async patchedBeesDir(domain: string): Promise<FileSystemDirectoryHandle> {
    const patchDir = await this.domainPatchesDir(domain)
    return await patchDir.getDirectoryHandle('__bees__', { create: true })
  }

  /**
   * Returns the __dependencies__ subdirectory within a domain's patch folder.
   * Patched dependencies are stored here, separate from the original installation.
   */
  async patchedDepsDir(domain: string): Promise<FileSystemDirectoryHandle> {
    const patchDir = await this.domainPatchesDir(domain)
    return await patchDir.getDirectoryHandle('__dependencies__', { create: true })
  }

  async writeFile(dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

  async readFile(dir: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer | null> {
    try {
      const handle = await dir.getFileHandle(name)
      const file = await handle.getFile()
      return await file.arrayBuffer()
    } catch {
      return null
    }
  }

  async hasFile(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }
}

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
  static readonly LAYERS_DIRECTORY = '__layers__'
  static readonly RESOURCES_DIRECTORY = '__resources__'
  static readonly PATCHES_DIRECTORY = '__patches__'
  static readonly FROM_HYPERCOMB_DIRECTORY = '__from-hypercomb__'

  #root!: FileSystemDirectoryHandle
  #bees!: FileSystemDirectoryHandle
  #dependencies!: FileSystemDirectoryHandle
  #layers!: FileSystemDirectoryHandle
  #resources!: FileSystemDirectoryHandle
  #patches!: FileSystemDirectoryHandle
  #initPromise: Promise<void> | null = null

  get root(): FileSystemDirectoryHandle { return this.#root }
  get bees(): FileSystemDirectoryHandle { return this.#bees }
  get dependencies(): FileSystemDirectoryHandle { return this.#dependencies }
  get layers(): FileSystemDirectoryHandle { return this.#layers }
  get resources(): FileSystemDirectoryHandle { return this.#resources }
  get patches(): FileSystemDirectoryHandle { return this.#patches }

  initialize(): Promise<void> {
    return this.#initPromise ??= this.#doInit()
  }

  async #doInit(): Promise<void> {
    this.#root = await navigator.storage.getDirectory()
    this.#bees = await this.#root.getDirectoryHandle(DcpStore.BEES_DIRECTORY, { create: true })
    this.#dependencies = await this.#root.getDirectoryHandle(DcpStore.DEPENDENCIES_DIRECTORY, { create: true })
    this.#layers = await this.#root.getDirectoryHandle(DcpStore.LAYERS_DIRECTORY, { create: true })
    this.#resources = await this.#root.getDirectoryHandle(DcpStore.RESOURCES_DIRECTORY, { create: true })
    this.#patches = await this.#root.getDirectoryHandle(DcpStore.PATCHES_DIRECTORY, { create: true })
  }

  async domainLayersDir(domain: string): Promise<FileSystemDirectoryHandle> {
    return await this.#layers.getDirectoryHandle(domain, { create: true })
  }

  async domainPatchesDir(domain: string): Promise<FileSystemDirectoryHandle> {
    return await this.#patches.getDirectoryHandle(domain, { create: true })
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

  /**
   * Root of the "received from hypercomb-web" namespace — content the
   * web app pushed up via sentinel intake. Kept separate from authored
   * (__layers__/{domain}) and patched (__patches__/{domain}) bags so
   * received bytes never collide with anything DCP itself produced.
   */
  async fromHypercombDir(): Promise<FileSystemDirectoryHandle> {
    return await this.#root.getDirectoryHandle(DcpStore.FROM_HYPERCOMB_DIRECTORY, { create: true })
  }

  /**
   * Returns __from-hypercomb__/{kind}/ — one of `__layers__`,
   * `__bees__`, `__dependencies__`, or `__resources__`. Mirrors the
   * canonical bag layout so received content is structurally
   * identical to authored content; only the parent namespace differs.
   */
  async fromHypercombKindDir(kind: 'layer' | 'bee' | 'dependency' | 'resource'): Promise<FileSystemDirectoryHandle> {
    const dir = await this.fromHypercombDir()
    const sub =
      kind === 'layer' ? DcpStore.LAYERS_DIRECTORY :
      kind === 'bee' ? DcpStore.BEES_DIRECTORY :
      kind === 'dependency' ? DcpStore.DEPENDENCIES_DIRECTORY :
      DcpStore.RESOURCES_DIRECTORY
    return await dir.getDirectoryHandle(sub, { create: true })
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

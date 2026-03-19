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

  #root!: FileSystemDirectoryHandle
  #bees!: FileSystemDirectoryHandle
  #dependencies!: FileSystemDirectoryHandle
  #layers!: FileSystemDirectoryHandle
  #resources!: FileSystemDirectoryHandle
  #initialized = false

  get root(): FileSystemDirectoryHandle { return this.#root }
  get bees(): FileSystemDirectoryHandle { return this.#bees }
  get dependencies(): FileSystemDirectoryHandle { return this.#dependencies }
  get layers(): FileSystemDirectoryHandle { return this.#layers }
  get resources(): FileSystemDirectoryHandle { return this.#resources }

  async initialize(): Promise<void> {
    if (this.#initialized) return
    this.#initialized = true

    this.#root = await navigator.storage.getDirectory()
    this.#bees = await this.#root.getDirectoryHandle(DcpStore.BEES_DIRECTORY, { create: true })
    this.#dependencies = await this.#root.getDirectoryHandle(DcpStore.DEPENDENCIES_DIRECTORY, { create: true })
    this.#layers = await this.#root.getDirectoryHandle(DcpStore.LAYERS_DIRECTORY, { create: true })
    this.#resources = await this.#root.getDirectoryHandle(DcpStore.RESOURCES_DIRECTORY, { create: true })
  }

  async domainLayersDir(domain: string): Promise<FileSystemDirectoryHandle> {
    return await this.#layers.getDirectoryHandle(domain, { create: true })
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

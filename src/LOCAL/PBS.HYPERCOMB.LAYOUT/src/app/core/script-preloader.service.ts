// src/app/core/script-preloader.service.ts

import { Injectable, inject } from '@angular/core'
import { OpfsManager } from './opfs.manager'

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService {

  // in-memory cache of payload bytes keyed by signature (file name)
  private readonly cache = new Map<string, ArrayBuffer>()

  private readonly opfs = inject(OpfsManager)
  private readonly rootPromise = this.opfs.root()

  public constructor() {
    // fire and forget: warm all scripts on startup
    void this.preloadAll()
  }

  // get a script by signature (file name) later
  public get = (signature: string): ArrayBuffer | undefined => {
    return this.cache.get(signature)
  }

  // optional helper: list all signatures we’ve warmed
  public listSignatures = (): string[] => {
    return Array.from(this.cache.keys())
  }

  // load all files from /resources into memory
  private readonly preloadAll = async (): Promise<void> => {
    try {
      const root = await this.rootPromise

      let resourcesDir: FileSystemDirectoryHandle
      try {
        resourcesDir = await root.getDirectoryHandle('resources', { create: false })
      } catch (err) {
        // no resources dir yet — nothing to preload
        const name = (err as DOMException | undefined)?.name
        if (name === 'NotFoundError') return
        throw err
      }

      for await (const [name, handle] of resourcesDir.entries()) {
        if (handle.kind !== 'file') continue

        try {
          const fileHandle = handle as FileSystemFileHandle
          const file = await fileHandle.getFile()
          const buffer = await file.arrayBuffer()

          // name is the signature you used when writing
          this.cache.set(name, buffer)
        } catch (err) {
          // non-fatal: log and continue with the rest
          console.error('failed to preload resource', name, err)
        }
      }

      console.log('script preloader warmed resources:', this.cache.size)
    } catch (err) {
      console.error('failed to preload resources directory', err)
    }
  }
}

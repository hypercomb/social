// src/app/core/script-preloader.service.ts

import { Injectable, signal } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService {

  // ----------------------------------
  // in-memory indexes
  // ----------------------------------

  // signature -> compiled bytes
  private readonly cache = new Map<string, ArrayBuffer>()

  // normalized action name -> signature
  public readonly actionIndex = new Map<string, string>()

  // sorted list of action names for intellisense
  public readonly actionNames = signal<readonly string[]>([])

  private readonly decoder = new TextDecoder()

  // ----------------------------------
  // access
  // ----------------------------------

  public get = (signature: string): ArrayBuffer | undefined =>
    this.cache.get(signature)

  // src/app/core/script-preloader.service.ts

  public add = (signature: string, bytes: ArrayBuffer): void => {
    this.cache.set(signature, bytes)

    const name = this.extractActionName(bytes)
    if (!name) return

    this.actionIndex.set(name, signature)

    const names = [...this.actionNames(), name]
    names.sort()
    this.actionNames.set(names)
  }


  // ----------------------------------
  // discovery (single pass, handle-based)
  // ----------------------------------

  public initialize = async (
    resources: FileSystemDirectoryHandle
  ): Promise<void> => {

    this.cache.clear()
    this.actionIndex.clear()

    const names: string[] = []

    for await (const [signature, handle] of resources.entries()) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()
      const buffer = await file.arrayBuffer()

      this.cache.set(signature, buffer)

      const name = this.extractActionName(buffer)
      if (!name) continue

      this.actionIndex.set(name, signature)
      names.push(name)
    }

    names.sort()
    this.actionNames.set(names)
  }

  // ----------------------------------
  // utils
  // ----------------------------------

  private extractActionName = (buf: ArrayBuffer): string | null => {
    const src = this.decoder.decode(new Uint8Array(buf))
    const m = src.match(/class\s+([A-Za-z0-9_]+)\s+extends\s+\w*Action/)
    if (!m) return null

    return m[1]
      .replace(/Action$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
  }
}

// src/app/core/script-preloader.service.ts

import { Injectable, inject, signal } from '@angular/core'
import { OpfsStore } from './opfs.store'

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService {

  // in-memory cache of payload bytes keyed by signature (file name)
  private readonly cache = new Map<string, ArrayBuffer>()

  // action names extracted from warmed scripts (lowercase, spaced)
  public readonly actionNames = signal<readonly string[]>([])

  private readonly opfs = inject(OpfsStore)

  private refreshing?: Promise<void>
  private readonly decoder = new TextDecoder()

  public initialize = async (): Promise<void> => {
    // fire and forget: warm all scripts on startup
    void this.refresh()
  }

  // get a script by signature (file name) later
  public get = (signature: string): ArrayBuffer | undefined => {
    return this.cache.get(signature)
  }

  // optional helper: list all signatures we’ve warmed
  public listSignatures = (): string[] => {
    return Array.from(this.cache.keys())
  }

  // warms /resources and extracts action names for intellisense
  public refresh = async (): Promise<void> => {
    if (this.refreshing) return await this.refreshing

    this.refreshing = (async () => {
      try {
        await this.opfs.initialize()

        const root = this.opfs.root()
        if (!root) return

        let resourcesDir: FileSystemDirectoryHandle
        try {
          resourcesDir = await root.getDirectoryHandle('resources', { create: false })
        } catch (err) {
          const name = (err as DOMException | undefined)?.name
          if (name === 'NotFoundError') {
            this.cache.clear()
            this.actionNames.set([])
            return
          }
          throw err
        }

        const names = new Set<string>()

        for await (const [name, handle] of resourcesDir.entries()) {
          if (handle.kind !== 'file') continue

          try {
            const fileHandle = handle as FileSystemFileHandle
            const file = await fileHandle.getFile()
            const buffer = await file.arrayBuffer()

            // name is the signature you used when writing
            this.cache.set(name, buffer)

            // best effort: pull the action class name out of the module source
            const actionName = this.tryExtractActionName(buffer)
            if (actionName) names.add(actionName)

          } catch (err) {
            // non-fatal: log and continue with the rest
            console.error('failed to preload resource', name, err)
          }
        }

        const list = Array.from(names.values()).sort((a, b) => a.localeCompare(b))
        this.actionNames.set(list)

        console.log('script preloader warmed resources:', this.cache.size)
      } catch (err) {
        console.error('failed to preload resources directory', err)
      } finally {
        this.refreshing = undefined
      }
    })()

    return await this.refreshing
  }

  // -------------------------------------------------
  // extraction
  // -------------------------------------------------

  private tryExtractActionName = (buffer: ArrayBuffer): string | null => {
    let src = ''
    try {
      src = this.decoder.decode(new Uint8Array(buffer))
    } catch {
      return null
    }

    // common patterns (js / mjs / ts outputs)
    const patterns: RegExp[] = [
      /export\s+class\s+([A-Za-z0-9_]+)\b/,
      /class\s+([A-Za-z0-9_]+)\s+extends\s+[A-Za-z0-9_]*Action\b/,
      /export\s+default\s+class\s+([A-Za-z0-9_]+)\b/
    ]

    for (const p of patterns) {
      const m = src.match(p)
      const raw = m?.[1]?.trim()
      if (!raw) continue

      // skip obvious non-action bases
      if (raw === 'Action') continue

      return this.toCompletionName(raw)
    }

    return null
  }

  private toCompletionName = (className: string): string => {
    const base = className.replace(/Action$/, '')

    // keeps acronyms readable: URLFetcher -> url fetcher
    const spaced =
      base
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()

    return spaced.toLowerCase()
  }
}

// hypercomb-web/src/app/core/dependency-loader.ts

import { inject, Injectable, signal } from '@angular/core'
import { environment } from '../../environments/environment'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class DependencyLoader {

  private readonly store = inject(Store)

  // internal state
  private readonly loaded = new Set<string>()

  // diagnostics / ui (non-authoritative)
  public readonly dependencyCount = signal(0)
  public readonly loadedSignatures = signal<readonly string[]>([])
  public readonly failedSignatures = signal<readonly string[]>([])

  public load = async (): Promise<void> => {
    this.loaded.clear()
    this.dependencyCount.set(0)
    this.loadedSignatures.set([])
    this.failedSignatures.set([])

    if (environment.production) {
      await this.preloadFromOpfs()
      return
    }

    await this.preloadFromDev()
  }

  // prod: preload by importing alias specifiers (uses import map)
  private preloadFromOpfs = async (): Promise<void> => {
    const root = this.store.opfsRoot

    let depDir: FileSystemDirectoryHandle
    try {
      depDir = await root.getDirectoryHandle('__dependencies__')
    } catch {
      return
    }

    for await (const [sig, entry] of depDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!this.isSignature(sig)) continue
      if (this.loaded.has(sig)) continue

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const text = await file.text()

        // first line contract: // @domain[/seg...]
        const alias = this.readAliasFromFirstLine(text)
        if (!alias) throw new Error('missing alias header line')

        await this.importSpecifier(alias)

        this.loaded.add(sig)
        this.dependencyCount.update(v => v + 1)
        this.loadedSignatures.update(v => [...v, sig])
      } catch (e) {
        console.warn(`dependency preload failed: ${sig}`, e)
        this.failedSignatures.update(v => [...v, sig])
      }
    }
  }

  // dev: import every runtime url from manifest.imports (each runtime is export* -> __dependencies__/<sig>)
  private preloadFromDev = async (): Promise<void> => {
    const manifest = await this.store.getDevManifest()
    if (!manifest) throw new Error('missing dev manifest')

    const imports = manifest.imports
    const entries = Object.entries(imports).sort((a, b) => a[0].localeCompare(b[0]))

    // multiple specifiers can theoretically point at the same runtime file; dedupe by url
    const seenRuntimeUrls = new Set<string>()

    for (const [specifier, runtimeUrl] of entries) {
      if (!specifier || typeof runtimeUrl !== 'string' || !runtimeUrl.trim()) continue
      if (this.loaded.has(specifier)) continue

      const url = `${location.origin}${runtimeUrl.trim()}`
      if (seenRuntimeUrls.has(url)) {
        // still mark the specifier as satisfied
        this.loaded.add(specifier)
        continue
      }


      try {
        const register = window.ioc.register
        const res = await import(/* @vite-ignore */ url)
        console.log(`[dev preload] imported ${specifier} from ${url}`, res)
        register(specifier, res)

        seenRuntimeUrls.add(url)
        this.loaded.add(specifier)
        this.dependencyCount.update(v => v + 1)
        this.loadedSignatures.update(v => [...v, specifier])
      } catch (e) {
        console.warn(`dev dependency preload failed: ${specifier} -> ${url}`, e)
        this.failedSignatures.update(v => [...v, specifier])
      }
    }
  }

  private importSpecifier = async (specifier: string): Promise<void> => {
    await import(/* @vite-ignore */ specifier)
  }

  private readAliasFromFirstLine = (text: string): string | null => {
    const first = text.split('\n', 1)[0]?.trim() ?? ''
    if (!first.startsWith('//')) return null
    const parts = first.split(/\s+/)
    const token = parts[1] ?? ''
    if (!token.startsWith('@')) return null
    return token
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)
}

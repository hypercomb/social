// src/app/core/dependency-loader.service.ts

import { inject, Injectable, signal } from '@angular/core'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class DependencyLoader {

  private readonly store = inject(Store)

  // -------------------------------------------------
  // internal state
  // -------------------------------------------------

  private readonly loaded = new Set<string>()

  // -------------------------------------------------
  // diagnostics / ui (non-authoritative)
  // -------------------------------------------------

  public readonly dependencyCount = signal(0)
  public readonly loadedSignatures = signal<readonly string[]>([])
  public readonly failedSignatures = signal<readonly string[]>([])

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  public load = async (): Promise<void> => {

    this.loaded.clear()
    this.dependencyCount.set(0)
    this.loadedSignatures.set([])
    this.failedSignatures.set([])

    const root = this.store.opfsRoot

    let depDir: FileSystemDirectoryHandle
    try {
      depDir = await root.getDirectoryHandle('__dependencies__')
    } catch {
      // no dependencies directory is a valid state
      return
    }

    for await (const [fileName, entry] of depDir.entries()) {

      if (entry.kind !== 'file') continue
      if (!this.isSignature(fileName)) continue
      if (this.loaded.has(fileName)) continue

      try {
        const dep = await this.loadDependency(fileName)

        this.loaded.add(fileName)
        this.dependencyCount.update(v => v + 1)
        this.loadedSignatures.update(v => [...v, fileName])

      } catch (e) {
        console.warn(`dependency load failed: ${fileName}`, e)
        this.failedSignatures.update(v => [...v, fileName])
      }
    }
  }

  // -------------------------------------------------
  // implementation
  // -------------------------------------------------  

  private loadDependency = async (signature: string): Promise<void> => {

    const url = "https://storagehypercomb.blob.core.windows.net/content/__dependencies__/" + signature 
    
    // this.resolveDependencyUrl(signature)
    const data = await fetch(url)
    const json = await data.text()
    const blob = new Blob([json], { type: 'application/javascript' })
    const objectUrl = URL.createObjectURL(blob)

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    await import(/* @vite-ignore */ objectUrl)
  }

  private resolveDependencyUrl = (signature: string): string => {
    return `https://storagehypercomb.blob.core.windows.net/content/__dependencies__/${signature}.js`
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)
}

// hypercomb-web/src/app/core/dependency-loader.ts

import { inject, Injectable, signal } from '@angular/core'
import { environment } from '../environments/environment'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class DependencyLoader {

  private readonly store = inject(Store)
  private readonly loaded = new Set<string>()

  public readonly dependencyCount = signal(0)
  public readonly loadedSignatures = signal<readonly string[]>([])
  public readonly failedSignatures = signal<readonly string[]>([])

  public load = async (): Promise<void> => {
    this.loaded.clear()
    this.dependencyCount.set(0)
    this.loadedSignatures.set([])
    this.failedSignatures.set([])

    // load all from opfs dependencies directory
    let depDir: FileSystemDirectoryHandle
    try {
      depDir = this.store.dependenciesDirectory()
    } catch {
      return
    }

    for await (const [sig, entry] of depDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!this.isSignature(sig)) continue
      if (this.loaded.has(sig)) continue

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const prefix = await file.slice(0, 512).arrayBuffer()
        const first = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim() ?? ''

        const alias = this.readAliasFromFirstLine(first)
        if (!alias) continue

        const mod = await import(/* @vite-ignore */ alias)
        // window.ioc.register(alias, mod)

        this.loaded.add(sig)
        this.dependencyCount.update(v => v + 1)
        this.loadedSignatures.update(v => [...v, sig])
      } catch(error) {
        console.error(`Failed to load dependency: ${sig}`, error)
        this.failedSignatures.update(v => [...v, sig])
      }
    }
  }

  private readAliasFromFirstLine = (text: string): string | null => {
    if (!text.startsWith('//')) return null
    const parts = text.split(/\s+/)
    const token = (parts[1] ?? '').trim()
    return token.startsWith('@') ? token : null
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name.replace('.js', ''))
}

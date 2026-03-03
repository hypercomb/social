// hypercomb-web/src/app/core/dependency-loader.ts

import { Store } from './store'

export class DependencyLoader extends EventTarget {

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }
  private readonly loaded = new Set<string>()

  #dependencyCount = 0
  #loadedSignatures: readonly string[] = []
  #failedSignatures: readonly string[] = []

  public get dependencyCount(): number { return this.#dependencyCount }
  public get loadedSignatures(): readonly string[] { return this.#loadedSignatures }
  public get failedSignatures(): readonly string[] { return this.#failedSignatures }

  public load = async (): Promise<void> => {
    this.loaded.clear()
    this.#dependencyCount = 0
    this.#loadedSignatures = []
    this.#failedSignatures = []
    this.dispatchEvent(new CustomEvent('change'))

    // load all from opfs dependencies directory
    let depDir: FileSystemDirectoryHandle
    try {
      depDir = this.store.dependencies
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
        void mod

        this.loaded.add(sig)
        this.#dependencyCount = this.#dependencyCount + 1
        this.#loadedSignatures = [...this.#loadedSignatures, sig]
        this.dispatchEvent(new CustomEvent('change'))
      } catch (error) {
        console.error(`Failed to load dependency: ${sig}`, error)
        this.#failedSignatures = [...this.#failedSignatures, sig]
        this.dispatchEvent(new CustomEvent('change'))
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

register('@hypercomb.social/DependencyLoader', new DependencyLoader())

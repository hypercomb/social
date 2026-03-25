// hypercomb-web/src/app/core/dependency-loader.ts

import { EffectBus } from '@hypercomb/core'
import { Store } from './store'

export class DependencyLoader extends EventTarget {

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }
  readonly #loaded = new Set<string>()
  #loading: Promise<void> | null = null

  #dependencyCount = 0
  #loadedSignatures: readonly string[] = []
  #failedSignatures: readonly string[] = []

  public get dependencyCount(): number { return this.#dependencyCount }
  public get loadedSignatures(): readonly string[] { return this.#loadedSignatures }
  public get failedSignatures(): readonly string[] { return this.#failedSignatures }

  public load = async (): Promise<void> => {
    // In-flight dedup: if load() is already running, wait for it
    if (this.#loading) {
      console.log('[dependency-loader] load() already in progress, waiting')
      return this.#loading
    }

    const run = async (): Promise<void> => {
      // Use cached alias map from resolveImportMap() if available (skips OPFS re-scan)
      let pending = await this.#collectPending()
      if (!pending.length) {
        console.log('[dependency-loader] no pending dependencies')
        return
      }

      // When beeDeps is present, only eagerly load deps NOT claimed by any bee.
      // Bee-specific deps are lazy-loaded by ScriptPreloader.#ensureDeps().
      const beeDeps = (globalThis as any).__hypercombBeeDeps as Record<string, string[]> | undefined
      if (beeDeps) {
        const claimed = new Set(Object.values(beeDeps).flat())
        const before = pending.length
        pending = pending.filter(p => {
          const pureSig = p.sig.replace(/\.js$/i, '')
          return !claimed.has(pureSig) && !claimed.has(p.sig)
        })
        if (before !== pending.length) {
          console.log(`[dependency-loader] ${before - pending.length} deps claimed by bees, ${pending.length} orphans to eagerly load`)
        }
        if (!pending.length) return
      }

      EffectBus.emit('loader:deps-start', { total: pending.length })

      // Verify signatures then import concurrently
      const results = await Promise.allSettled(
        pending.map(({ sig, alias }) =>
          this.#verifyAndImport(sig, alias)
        )
      )

      const loadedSigs: string[] = []
      const failedSigs: string[] = []

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const { sig } = pending[i]

        if (r.status === 'fulfilled') {
          this.#loaded.add(sig)
          loadedSigs.push(sig)
        } else {
          console.error(`[dependency-loader] failed to load dependency ${sig}:`, r.reason)
          failedSigs.push(sig)
        }
      }

      this.#dependencyCount = this.#dependencyCount + loadedSigs.length
      this.#loadedSignatures = [...this.#loadedSignatures, ...loadedSigs]
      this.#failedSignatures = [...this.#failedSignatures, ...failedSigs]
      this.dispatchEvent(new CustomEvent('change'))

      EffectBus.emit('loader:deps-done', {
        loaded: loadedSigs.length,
        failed: failedSigs.length,
        total: pending.length,
      })
    }

    this.#loading = run()
    try { await this.#loading } finally { this.#loading = null }
  }

  #collectPending = async (): Promise<{ sig: string; alias: string }[]> => {
    // Fast path: use cached alias map from resolveImportMap() (web mode)
    const cachedMap = (globalThis as any).__hypercombAliasMap as Map<string, string> | undefined
    if (cachedMap && cachedMap.size > 0) {
      const pending: { sig: string; alias: string }[] = []
      for (const [alias, sig] of cachedMap) {
        if (this.#loaded.has(sig)) {
          console.log(`[dependency-loader] ${alias} (${sig}) already loaded, skipping`)
          continue
        }
        pending.push({ sig, alias })
      }
      return pending
    }

    // Fallback: scan OPFS dependencies directory (dev mode or no cached map)
    let depDir: FileSystemDirectoryHandle
    try {
      depDir = this.store.dependencies
    } catch {
      return []
    }

    const pending: { sig: string; alias: string }[] = []

    for await (const [sig, entry] of depDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!this.#isSignature(sig)) continue
      if (this.#loaded.has(sig)) {
        console.log(`[dependency-loader] ${sig} already loaded, skipping`)
        continue
      }

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const prefix = await file.slice(0, 512).arrayBuffer()
        const first = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim() ?? ''

        const alias = this.#readAliasFromFirstLine(first)
        if (alias) pending.push({ sig, alias })
      } catch {
        // skip unreadable entries
      }
    }

    return pending
  }

  #verifyAndImport = async (sig: string, alias: string): Promise<string> => {
    const pureSig = sig.replace(/\.js$/i, '')
    console.log(`[dependency-loader] importing ${alias} (${pureSig})`)
    const mod = await import(/* @vite-ignore */ alias)
    void mod
    console.log(`[dependency-loader] imported ${alias}`)
    return sig
  }

  #readAliasFromFirstLine = (text: string): string | null => {
    if (!text.startsWith('//')) return null
    const parts = text.split(/\s+/)
    const token = (parts[1] ?? '').trim()
    return token.startsWith('@') ? token : null
  }

  #isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name.replace('.js', ''))
}

register('@hypercomb.social/DependencyLoader', new DependencyLoader())

// hypercomb-web/src/app/core/dependency-loader.ts

import { EffectBus, SignatureService } from '@hypercomb/core'
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

    // Use cached alias map from resolveImportMap() if available (skips OPFS re-scan)
    let pending = await this.#collectPending()
    if (!pending.length) return

    // Layer primitive: all bees load at once, so load all deps eagerly.
    // (beeDeps lazy loading removed — no longer needed without marker-based loading)

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
        this.loaded.add(sig)
        loadedSigs.push(sig)
      } else {
        console.error(`Failed to load dependency: ${sig}`, r.reason)
        failedSigs.push(sig)
      }
    }

    this.#dependencyCount = loadedSigs.length
    this.#loadedSignatures = loadedSigs
    this.#failedSignatures = failedSigs
    this.dispatchEvent(new CustomEvent('change'))

    EffectBus.emit('loader:deps-done', {
      loaded: loadedSigs.length,
      failed: failedSigs.length,
      total: pending.length,
    })
  }

  #collectPending = async (): Promise<{ sig: string; alias: string }[]> => {
    // Fast path: use cached alias map from resolveImportMap() (web mode)
    const cachedMap = (globalThis as any).__hypercombAliasMap as Map<string, string> | undefined
    if (cachedMap && cachedMap.size > 0) {
      const pending: { sig: string; alias: string }[] = []
      for (const [alias, sig] of cachedMap) {
        if (!this.loaded.has(sig)) pending.push({ sig, alias })
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
      if (!this.isSignature(sig)) continue
      if (this.loaded.has(sig)) continue

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const prefix = await file.slice(0, 512).arrayBuffer()
        const first = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim() ?? ''

        const alias = this.readAliasFromFirstLine(first)
        if (alias) pending.push({ sig, alias })
      } catch {
        // skip unreadable entries
      }
    }

    return pending
  }

  #verifyAndImport = async (sig: string, alias: string): Promise<string> => {
    // Normalize: sig from alias map may include .js extension
    const pureSig = sig.replace(/\.js$/i, '')

    // Verify signature integrity before executing
    try {
      const depDir = this.store.dependencies
      let fh: FileSystemFileHandle
      try {
        fh = await depDir.getFileHandle(`${pureSig}.js`)
      } catch {
        fh = await depDir.getFileHandle(pureSig)
      }
      const file = await fh.getFile()
      const buffer = await file.arrayBuffer()
      const computed = await SignatureService.sign(buffer)
      if (computed !== pureSig) {
        throw new Error(`signature mismatch: expected ${pureSig}, got ${computed}`)
      }
    } catch (err) {
      console.error(`[dependency-loader] verification failed for ${pureSig}:`, err)
      throw err
    }

    await this.#importWithRetry(alias)
    return sig
  }

  #importWithRetry = async (alias: string, maxAttempts = 3): Promise<void> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const mod = await import(/* @vite-ignore */ alias)
        void mod
        return
      } catch (err) {
        if (attempt === maxAttempts) throw err
        await new Promise(r => setTimeout(r, 200 * (2 ** (attempt - 1))))
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

// diamond-core-processor/src/app/core/dcp-installer.service.ts

//
// Mirrors LayerInstaller from hypercomb-shared/core/layer-installer.ts
// but uses DcpStore (Angular DI) instead of hypercomb's IoC.
//
// Downloads all layers, bees, and dependencies listed in manifest.json
// to OPFS upfront — same folder structure as Hypercomb.

import { inject, Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { DcpStore } from './dcp-store'

type InstallManifest = {
  version?: number
  layers?: string[]
  bees?: string[]
  dependencies?: string[]
  beeDeps?: Record<string, string[]>
}

type ContentManifest = {
  version: number
  packages: Record<string, InstallManifest>
}

export type InstallProgress = {
  phase: 'layers' | 'bees' | 'dependencies'
  current: number
  total: number
}

@Injectable({ providedIn: 'root' })
export class DcpInstallerService {

  #store = inject(DcpStore)

  /**
   * Full upfront install: fetch manifest, download + verify + store all files.
   * Skips files already present in OPFS (resume-capable).
   * Returns the parsed manifest on success, null on failure.
   */
  async install(
    base: string,
    rootSig: string,
    domain: string,
    onProgress?: (p: InstallProgress) => void
  ): Promise<InstallManifest | null> {
    if (!base || !rootSig) return null

    await this.#store.initialize()

    const domainDir = await this.#store.domainLayersDir(domain)

    // 1) fetch content manifest and resolve package by root signature
    const manifest = await this.#fetchManifest(base, rootSig)
    if (!manifest) return null

    const layers = manifest.layers ?? []
    const bees = manifest.bees ?? []
    const deps = manifest.dependencies ?? []

    // 2) purge stale layers from previous installs
    await this.#purgeStale(domainDir, new Set(layers))

    // 3) install layers — flat heap first, legacy typed path fallback — parallel
    onProgress?.({ phase: 'layers', current: 0, total: layers.length })
    await Promise.all(layers.map((sig, i) =>
      this.#installFile(domainDir, [`${base}/${sig}`, `${base}/__layers__/${sig}.json`], sig, sig)
        .then(() => onProgress?.({ phase: 'layers', current: i + 1, total: layers.length }))
    ))

    // 4) install bees — parallel
    onProgress?.({ phase: 'bees', current: 0, total: bees.length })
    await Promise.all(bees.map((sig, i) =>
      this.#installFile(this.#store.bees, [`${base}/${sig}`, `${base}/__bees__/${sig}.js`], sig, `${sig}.js`)
        .then(() => onProgress?.({ phase: 'bees', current: i + 1, total: bees.length }))
    ))

    // 5) install dependencies — parallel
    onProgress?.({ phase: 'dependencies', current: 0, total: deps.length })
    await Promise.all(deps.map((sig, i) =>
      this.#installFile(this.#store.dependencies, [`${base}/${sig}`, `${base}/__dependencies__/${sig}.js`], sig, `${sig}.js`)
        .then(() => onProgress?.({ phase: 'dependencies', current: i + 1, total: deps.length }))
    ))

    // 6) cache resolved manifest in OPFS for offline sync
    await this.#cacheManifest(domainDir, manifest)

    return manifest
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  async #purgeStale(dir: FileSystemDirectoryHandle, liveSigs: Set<string>): Promise<void> {
    const stale: string[] = []
    for await (const name of (dir as any).keys()) {
      const sig = name.replace(/\.json$/i, '').replace(/\.js$/i, '')
      if (!/^[a-f0-9]{64}$/i.test(sig)) continue  // skip non-signature files (e.g. manifest.cache.json)
      if (!liveSigs.has(sig)) stale.push(name)
    }
    for (const name of stale) {
      try { await dir.removeEntry(name) } catch { /* ignore */ }
    }
    if (stale.length) console.log(`[dcp-installer] purged ${stale.length} stale layer(s)`)
  }

  async #fetchManifest(base: string, rootSig: string): Promise<InstallManifest | null> {
    try {
      const res = await fetch(`${base}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) return null
      const content = await res.json() as ContentManifest
      const pkg = content?.packages?.[rootSig]
      if (!pkg) {
        console.warn(`[dcp-installer] package ${rootSig.slice(0, 12)} not found in manifest`)
        return null
      }
      return pkg
    } catch {
      return null
    }
  }

  async #cacheManifest(domainDir: FileSystemDirectoryHandle, manifest: InstallManifest): Promise<void> {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(manifest))
      await this.#store.writeFile(domainDir, 'manifest.cache.json', bytes.buffer as ArrayBuffer)
    } catch {
      // non-fatal — sync will re-fetch from network
    }
  }

  /** Download + verify + store one sig. `urls` are candidate shapes tried
   *  in order — the FLAT heap address (`/<sig>`) first, then the legacy
   *  typed path for hosts that haven't migrated. sha256 gates every byte
   *  regardless of which shape answered. */
  async #installFile(
    dir: FileSystemDirectoryHandle,
    urls: string[],
    expectedSig: string,
    fileName: string
  ): Promise<boolean> {
    if (!expectedSig) return false

    // skip if already present (check both with and without extension)
    if (await this.#store.hasFile(dir, fileName)) return true
    if (fileName !== expectedSig && await this.#store.hasFile(dir, expectedSig)) return true

    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) continue
        // SPA fallback guard: an extension-less /<sig> on a dev-server
        // origin returns index.html with 200. Sig-addressed bytes are
        // never text/html — skip quietly, no mismatch noise.
        if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) continue

        const bytes = await res.arrayBuffer()
        const actual = await SignatureService.sign(bytes)
        if (actual !== expectedSig) {
          console.error(`[dcp-installer] signature mismatch: expected ${expectedSig}, got ${actual}`)
          continue
        }

        await this.#store.writeFile(dir, fileName, bytes)
        return true
      } catch {
        // network error on this shape — try the next
      }
    }
    console.warn(`[dcp-installer] failed to fetch ${expectedSig}`)
    return false
  }
}

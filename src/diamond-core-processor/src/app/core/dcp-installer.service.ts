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

    // 3) install layers (flat — files live at base root)
    for (let i = 0; i < layers.length; i++) {
      onProgress?.({ phase: 'layers', current: i + 1, total: layers.length })
      await this.#installFile(domainDir, `${base}/__layers__/${layers[i]}.json`, layers[i], layers[i])
    }

    // 4) install bees
    for (let i = 0; i < bees.length; i++) {
      onProgress?.({ phase: 'bees', current: i + 1, total: bees.length })
      await this.#installFile(this.#store.bees, `${base}/__bees__/${bees[i]}.js`, bees[i], `${bees[i]}.js`)
    }

    // 5) install dependencies
    for (let i = 0; i < deps.length; i++) {
      onProgress?.({ phase: 'dependencies', current: i + 1, total: deps.length })
      await this.#installFile(this.#store.dependencies, `${base}/__dependencies__/${deps[i]}.js`, deps[i], `${deps[i]}.js`)
    }

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

  async #installFile(
    dir: FileSystemDirectoryHandle,
    url: string,
    expectedSig: string,
    fileName: string
  ): Promise<boolean> {
    if (!expectedSig) return false

    // skip if already present (check both with and without extension)
    if (await this.#store.hasFile(dir, fileName)) return true
    if (fileName !== expectedSig && await this.#store.hasFile(dir, expectedSig)) return true

    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        console.warn(`[dcp-installer] failed to fetch ${expectedSig}`)
        return false
      }

      const bytes = await res.arrayBuffer()
      const actual = await SignatureService.sign(bytes)
      if (actual !== expectedSig) {
        console.error(`[dcp-installer] signature mismatch: expected ${expectedSig}, got ${actual}`)
        return false
      }

      await this.#store.writeFile(dir, fileName, bytes)
      return true
    } catch {
      console.warn(`[dcp-installer] error installing ${expectedSig}`)
      return false
    }
  }
}

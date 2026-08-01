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
import { PatchStore, type PatchRecord } from './patch-store'

type InstallManifest = {
  version?: number
  layers?: string[]
  bees?: string[]
  dependencies?: string[]
  beeDeps?: Record<string, string[]>
  // Sidecar branch metadata (does not affect rootSig). Surfaced in the installer.
  label?: string
  at?: string
  previous?: string | null
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

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i

/** Child layer signatures of a layer JSON — `cells` is the current name,
 *  `layers`/`children` the older ones, same as the patch cascade reads. */
export const layerChildSignatures = (json: unknown): string[] => {
  const layer = (json ?? {}) as { cells?: unknown; layers?: unknown; children?: unknown }
  const raw = layer.cells ?? layer.layers ?? layer.children
  if (!Array.isArray(raw)) return []
  return raw.filter((sig): sig is string => typeof sig === 'string' && SIGNATURE_PATTERN.test(sig))
}

/** The layer signatures a domain's patch history keeps alive: every
 *  cascaded rewrite plus each record's new root. `oldSig` is deliberately
 *  absent — that is the ORIGINAL layer, live only while the manifest still
 *  lists it, and reachability below re-adds it when a patched tree still
 *  points at it. */
export const patchedLayerSignatures = (patches: PatchRecord[]): string[] => {
  const sigs: string[] = []
  for (const patch of patches) {
    if (patch?.newRootSig) sigs.push(patch.newRootSig)
    for (const cascaded of patch?.cascadedLayers ?? []) {
      if (cascaded?.newSig) sigs.push(cascaded.newSig)
    }
  }
  return sigs.filter(sig => SIGNATURE_PATTERN.test(sig))
}

/** Everything reachable from `roots` by walking layer JSON child links,
 *  read through `readLayer`. A patched cascade only rewrites the ancestor
 *  chain, so a patched tree still references ORIGINAL layers for every
 *  untouched subtree — those must survive the purge too, or the patch is
 *  left dangling. Unreadable/corrupt entries simply end that branch. */
export const reachableLayerSignatures = async (
  roots: Iterable<string>,
  readLayer: (sig: string) => Promise<unknown | null>,
): Promise<Set<string>> => {
  const seen = new Set<string>()
  const pending = [...roots]
  while (pending.length) {
    const sig = pending.pop()!
    if (!sig || seen.has(sig)) continue
    seen.add(sig)
    let json: unknown | null = null
    try { json = await readLayer(sig) } catch { json = null }
    if (!json) continue
    for (const child of layerChildSignatures(json)) {
      if (!seen.has(child)) pending.push(child)
    }
  }
  return seen
}

/** Entry names in a domain scope the purge may remove: signature-named
 *  files (bare or `.json`/`.js`) whose signature is not live. Anything
 *  else in the scope — manifest.cache.json, future bookkeeping — is not
 *  the purge's business. */
export const staleEntryNames = (names: Iterable<string>, liveSigs: Set<string>): string[] => {
  const stale: string[] = []
  for (const name of names) {
    const sig = name.replace(/\.json$/i, '').replace(/\.js$/i, '')
    if (!SIGNATURE_PATTERN.test(sig)) continue
    if (!liveSigs.has(sig)) stale.push(name)
  }
  return stale
}

@Injectable({ providedIn: 'root' })
export class DcpInstallerService {

  #store = inject(DcpStore)
  #patches = inject(PatchStore)

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

    // 2) purge stale layers from previous installs — live means the fresh
    //    manifest UNION everything a patched cascade still needs
    await this.#purgeStale(domainDir, await this.#liveSigs(domainDir, domain, layers))

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

  /** The layers the domain scope must keep: the fresh manifest, plus every
   *  patched-cascade layer and everything those patched trees still point
   *  at. Patched content is sig-distinct and lives in the same scope as the
   *  originals (dcp-store.patchedLayersDir), so a manifest-only purge would
   *  delete it — the patched bytes exist NOWHERE else, so that is real data
   *  loss, not a re-fetchable cache miss. A patch bag that cannot be read
   *  yields nothing extra, which is exactly the pre-patch behaviour. */
  async #liveSigs(
    dir: FileSystemDirectoryHandle,
    domain: string,
    manifestLayers: string[],
  ): Promise<Set<string>> {
    const live = new Set(manifestLayers)
    let patches: PatchRecord[] = []
    try { patches = await this.#patches.list(domain) } catch { return live }

    const readLayer = async (sig: string): Promise<unknown | null> => {
      const bytes = await this.#store.readFile(dir, sig)
        ?? await this.#store.readFile(dir, `${sig}.json`)
      if (!bytes) return null
      try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
    }
    for (const sig of await reachableLayerSignatures(patchedLayerSignatures(patches), readLayer)) {
      live.add(sig)
    }
    return live
  }

  async #purgeStale(dir: FileSystemDirectoryHandle, liveSigs: Set<string>): Promise<void> {
    const names: string[] = []
    for await (const name of (dir as any).keys()) names.push(name)
    const stale = staleEntryNames(names, liveSigs)
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

// hypercomb-shared/core/layer-installer.ts

import { type LocationParseResult } from './initializers/location-parser'
import { Store } from './store'

type InstallManifest = { version: number; layers: string[]; bees: string[]; dependencies: string[]; beeDeps?: Record<string, string[]> }
type ContentManifest = { version: number; packages: Record<string, InstallManifest> }

// global get/register/list available via ioc.web.ts

export class LayerInstaller {

  public install = async (parsed: LocationParseResult): Promise<boolean> => {
    const baseUrl = parsed?.baseUrl ?? ''
    const packageSig = parsed?.signature ?? ''
    if (!baseUrl || !packageSig) return false

    const store = get('@hypercomb.social/Store') as Store

    // Layers go directly into the canonical `__layers__/<sig>` pool — no
    // per-domain partition. The install pipeline is literally xcopy: the
    // host serves flat sig-keyed files; the installer copies them flat
    // into OPFS. Resume is by pool presence (no install-cache file).
    const layersDir = store.layers

    // 1) fetch content manifest and resolve the package by signature
    const manifest = await this.#fetchPackage(baseUrl, packageSig)
    if (!manifest) return false

    // 2) install all files (flat — files live at baseUrl root)
    await this.#installLayers(layersDir, baseUrl, manifest.layers || [])
    await this.#installDependencies(store, baseUrl, manifest.dependencies || [])
    await this.#installBees(store, baseUrl, manifest.bees || [])

    const complete = await this.#isComplete(layersDir, store, manifest)
    if (complete) {
      console.log('[layer-installer] install complete')
    } else {
      console.warn('[layer-installer] install incomplete — missing files will be retried on next load')
    }
    return complete
  }

  // -------------------------------------------------
  // manifest
  // -------------------------------------------------

  #fetchPackage = async (
    baseUrl: string,
    packageSig: string,
  ): Promise<InstallManifest | null> => {
    // Stateless: always re-fetch the content manifest and extract the
    // package. Resume-after-partial-install works via pool presence
    // check (already-installed sigs are skipped in #installLayers etc.),
    // so we don't need a local cache file at all.
    const url = `${baseUrl}/manifest.json`
    const bytes = await this.#fetchBytes(url)
    if (!bytes) return null

    const text = new TextDecoder().decode(bytes)
    const content = this.#tryParseContentManifest(text)
    if (!content) return null

    const pkg = content.packages?.[packageSig]
    if (!pkg) {
      console.warn(`[layer-installer] package ${packageSig.slice(0, 12)} not found in manifest`)
      return null
    }
    return pkg
  }

  #tryParseContentManifest = (text: string): ContentManifest | null => {
    try {
      const parsed = JSON.parse(text)
      if (parsed?.packages && typeof parsed.packages === 'object') return parsed as ContentManifest
      return null
    } catch {
      return null
    }
  }

  #tryParseInstallManifest = (text: string): InstallManifest | null => {
    try {
      return JSON.parse(text) as InstallManifest
    } catch {
      return null
    }
  }

  // -------------------------------------------------
  // install
  // -------------------------------------------------

  #installLayers = async (
    layersDir: FileSystemDirectoryHandle,
    endpoint: string,
    layers: string[]
  ): Promise<void> => {
    for (const sig of layers) {
      if (!sig) continue

      // Resume: layers are sig-keyed; if `__layers__/<sig>` already
      // exists, the content IS correct (sig === hash(bytes)) — skip.
      // Also tolerate legacy `<sig>.json` files from older installs.
      const existing =
        (await this.#tryGetFileHandle(layersDir, sig)) ??
        (await this.#tryGetFileHandle(layersDir, `${sig}.json`))
      if (existing) {
        console.log(`[layer-installer] layer ${sig} already installed, skipping`)
        continue
      }

      console.log(`[layer-installer] downloading layer ${sig}`)
      // Flat heap first (`/<sig>` — the canonical address; host-sync pushes
      // land there), legacy typed path fallback for unmigrated hosts.
      const bytes = await this.#fetchBytes(`${endpoint}/${sig}`)
        ?? await this.#fetchBytes(`${endpoint}/__layers__/${sig}.json`)
      if (!bytes) {
        console.warn(`[layer-installer] failed to download layer ${sig}`)
        continue
      }

      // Store flat at `__layers__/<sig>` — no extension, no domain
      // partition. Matches what commitLayer writes; readers find it
      // via store.getLayerPoolBytes(sig).
      await this.#writeBytesFile(layersDir, sig, bytes)
      console.log(`[layer-installer] layer ${sig} installed`)
    }
  }

  #installDependencies = async (
    store: Store,
    endpoint: string,
    deps: string[]
  ): Promise<void> => {
    const depDir = store.dependencies

    for (const sig of deps) {
      if (!sig) continue

      const name = `${sig}.js`
      const existing =
        (await this.#tryGetFileHandle(depDir, name)) ??
        (await this.#tryGetFileHandle(depDir, sig))

      if (existing) {
        console.log(`[layer-installer] dependency ${sig} already installed, skipping`)
        continue
      }

      console.log(`[layer-installer] downloading dependency ${sig}`)
      // Flat heap first, legacy typed path fallback.
      const bytes = await this.#fetchBytes(`${endpoint}/${sig}`)
        ?? await this.#fetchBytes(`${endpoint}/__dependencies__/${name}`)
      if (!bytes) {
        console.warn(`[layer-installer] failed to download dependency ${sig}`)
        continue
      }

      // store as: opfsroot/__dependencies__/<sig>.js
      await this.#writeBytesFile(depDir, name, bytes)
      console.log(`[layer-installer] dependency ${sig} installed`)
    }
  }

  #installBees = async (
    store: Store,
    endpoint: string,
    bees: string[]
  ): Promise<void> => {
    const beesDir = store.bees

    for (const sig of bees) {
      if (!sig) continue

      const name = `${sig}.js`
      const existing =
        (await this.#tryGetFileHandle(beesDir, name)) ??
        (await this.#tryGetFileHandle(beesDir, sig))

      if (existing) {
        console.log(`[layer-installer] bee ${sig} already installed, skipping`)
        continue
      }

      console.log(`[layer-installer] downloading bee ${sig}`)
      // Flat heap first, legacy typed path fallback.
      const bytes = await this.#fetchBytes(`${endpoint}/${sig}`)
        ?? await this.#fetchBytes(`${endpoint}/__bees__/${name}`)
      if (!bytes) {
        console.warn(`[layer-installer] failed to download bee ${sig}`)
        continue
      }

      // store as: opfsroot/__bees__/<sig>.js
      await this.#writeBytesFile(beesDir, name, bytes)
      console.log(`[layer-installer] bee ${sig} installed`)
    }
  }

  #isComplete = async (
    layersDir: FileSystemDirectoryHandle,
    store: Store,
    manifest: InstallManifest
  ): Promise<boolean> => {
    for (const sig of manifest.layers || []) {
      if (!sig) continue
      const a = await this.#tryGetFileHandle(layersDir, sig)
      const b = await this.#tryGetFileHandle(layersDir, `${sig}.json`)
      if (!a && !b) return false
    }

    const depDir = store.dependencies
    for (const sig of manifest.dependencies || []) {
      if (!sig) continue
      const a = await this.#tryGetFileHandle(depDir, `${sig}.js`)
      const b = await this.#tryGetFileHandle(depDir, sig)
      if (!a && !b) return false
    }

    const beesDir = store.bees
    for (const sig of manifest.bees || []) {
      if (!sig) continue
      const a = await this.#tryGetFileHandle(beesDir, `${sig}.js`)
      const b = await this.#tryGetFileHandle(beesDir, sig)
      if (!a && !b) return false
    }

    return true
  }

  // -------------------------------------------------
  // io
  // -------------------------------------------------

  #tryGetFileHandle = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<FileSystemFileHandle | null> => {
    try {
      return await dir.getFileHandle(name)
    } catch {
      return null
    }
  }

  #writeBytesFile = async (
    dir: FileSystemDirectoryHandle,
    name: string,
    bytes: Uint8Array<ArrayBuffer>
  ): Promise<void> => {
    const outHandle = await dir.getFileHandle(name, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

  #fetchBytes = async (url: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null
      // SPA fallback guard: an extension-less /<sig> on a dev-server origin
      // returns index.html with 200. Sig-addressed bytes are never text/html.
      if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) return null
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }
}

register('@hypercomb.social/LayerInstaller', new LayerInstaller())

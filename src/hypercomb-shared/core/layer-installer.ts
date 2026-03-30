// hypercomb-shared/core/layer-installer.ts

import { type LocationParseResult } from './initializers/location-parser'
import { Store } from './store'

type InstallManifest = { version: number; layers: string[]; bees: string[]; dependencies: string[]; beeDeps?: Record<string, string[]> }
type ContentManifest = { version: number; packages: Record<string, InstallManifest> }

// global get/register/list available via ioc.web.ts

export class LayerInstaller {

  readonly #localManifestName = '__install_cache__.json'

  public install = async (parsed: LocationParseResult): Promise<boolean> => {
    const baseUrl = parsed?.baseUrl ?? ''
    const packageSig = parsed?.signature ?? ''
    if (!baseUrl || !packageSig) return false

    // domain folder key: serialized domain lives at opfsroot/<domain>/
    const domainKey = parsed?.domain || this.#tryHost(baseUrl)
    if (!domainKey) return false

    const store = get('@hypercomb.social/Store') as Store

    // layers are stored per domain: opfsroot/<serialized-domain>/
    const domainLayersDir = await store.domainLayersDirectory(domainKey, true)

    // 1) fetch content manifest and resolve the package by signature
    const manifest = await this.#getOrFetchPackage(domainLayersDir, baseUrl, packageSig)
    if (!manifest) return false

    // 2) install all files (flat — files live at baseUrl root)
    await this.#installLayers(domainLayersDir, baseUrl, manifest.layers || [])
    await this.#installDependencies(store, baseUrl, manifest.dependencies || [])
    await this.#installBees(store, baseUrl, manifest.bees || [])

    // 3) remove cached manifest when complete
    const complete = await this.#isComplete(domainLayersDir, store, manifest)
    if (complete) {
      await this.#safeRemove(domainLayersDir, this.#localManifestName)
      console.log('[layer-installer] install complete')
    } else {
      console.warn('[layer-installer] install incomplete — missing files will be retried on next load')
    }
    return complete
  }

  // -------------------------------------------------
  // manifest
  // -------------------------------------------------

  #getOrFetchPackage = async (
    domainLayersDir: FileSystemDirectoryHandle,
    baseUrl: string,
    packageSig: string
  ): Promise<InstallManifest | null> => {

    // local first (resume — cached package entry)
    const localText = await this.#tryReadText(domainLayersDir, this.#localManifestName)
    if (localText) {
      const local = this.#tryParseInstallManifest(localText)
      if (local) return local
      await this.#safeRemove(domainLayersDir, this.#localManifestName)
    }

    // remote — fetch content manifest and extract package
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

    // cache the resolved package entry locally for resume
    const pkgBytes = new TextEncoder().encode(JSON.stringify(pkg))
    await this.#writeBytesFile(domainLayersDir, this.#localManifestName, pkgBytes)
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
    domainLayersDir: FileSystemDirectoryHandle,
    endpoint: string,
    layers: string[]
  ): Promise<void> => {
    for (const sig of layers) {
      if (!sig) continue

      // Layers are stored as `sig` (no extension) — check both forms for compatibility
      const existing =
        (await this.#tryGetFileHandle(domainLayersDir, sig)) ??
        (await this.#tryGetFileHandle(domainLayersDir, `${sig}.json`))
      if (existing) {
        console.log(`[layer-installer] layer ${sig} already installed, skipping`)
        continue
      }

      console.log(`[layer-installer] downloading layer ${sig}`)
      const url = `${endpoint}/__layers__/${sig}.json`
      const bytes = await this.#fetchBytes(url)
      if (!bytes) {
        console.warn(`[layer-installer] failed to download layer ${sig}`)
        continue
      }

      // store as: opfsroot/<serialized-domain>/<sig>
      await this.#writeBytesFile(domainLayersDir, sig, bytes)
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
      const url = `${endpoint}/__dependencies__/${name}`
      const bytes = await this.#fetchBytes(url)
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
      const url = `${endpoint}/__bees__/${name}`
      const bytes = await this.#fetchBytes(url)
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
    domainLayersDir: FileSystemDirectoryHandle,
    store: Store,
    manifest: InstallManifest
  ): Promise<boolean> => {
    for (const sig of manifest.layers || []) {
      if (!sig) continue
      const a = await this.#tryGetFileHandle(domainLayersDir, sig)
      const b = await this.#tryGetFileHandle(domainLayersDir, `${sig}.json`)
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

  #safeRemove = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<void> => {
    try {
      await dir.removeEntry(name)
    } catch {
      // ignore
    }
  }

  #tryReadText = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<string | null> => {
    const handle = await this.#tryGetFileHandle(dir, name)
    if (!handle) return null
    const file = await handle.getFile().catch(() => null)
    if (!file) return null
    return await file.text().catch(() => null)
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
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }

  #tryHost = (url: string): string => {
    try {
      return new URL(url).host
    } catch {
      return ''
    }
  }
}

register('@hypercomb.social/LayerInstaller', new LayerInstaller())

// hypercomb-shared/core/layer-installer.ts

import { type LocationParseResult } from './initializers/location-parser'
import { Store } from './store'

type InstallManifest = { version: number; layers: string[]; bees: string[]; dependencies: string[] }

// global get/register/list available via ioc.web.ts

export class LayerInstaller {

  readonly #manifestName = 'install.manifest.json'

  public install = async (parsed: LocationParseResult): Promise<boolean> => {
    const baseUrl = parsed?.baseUrl ?? ''
    const rootSig = parsed?.signature ?? ''
    if (!baseUrl || !rootSig) return false

    // endpoint: [baseUrl]/[path]/[signature]
    const endpoint =  `${baseUrl}/${rootSig}`

    // domain folder key used for: opfsroot/__layers__/<domain>/
    const domainKey = parsed?.domain || this.#tryHost(endpoint)
    if (!domainKey) return false

    const store = get('@hypercomb.social/Store') as Store

    // layers are stored per domain: opfsroot/__layers__/<domain>/
    const domainLayersDir = await store.domainLayersDirectory(domainKey, true)

    // 1) d/l the manifest (resume if present)
    const manifest = await this.#getOrFetchManifest(domainLayersDir, endpoint)
    if (!manifest) return false

    // 2) install all files
    await this.#installLayers(domainLayersDir, endpoint, manifest.layers || [])
    await this.#installDependencies(store, endpoint, manifest.dependencies || [])
    await this.#installBees(store, endpoint, manifest.bees || [])

    // 3) remove manifest when complete
    const complete = await this.#isComplete(domainLayersDir, store, manifest)
    if (complete) {
      await this.#safeRemove(domainLayersDir, this.#manifestName)
      console.log('[layer-installer] install complete (manifest removed)')
    } else {
      console.warn('[layer-installer] install incomplete — missing files will be retried on next load')
    }
    return complete
  }

  // -------------------------------------------------
  // manifest
  // -------------------------------------------------

  #getOrFetchManifest = async (
    domainLayersDir: FileSystemDirectoryHandle,
    endpoint: string
  ): Promise<InstallManifest | null> => {

    // local first (resume)
    const localText = await this.#tryReadText(domainLayersDir, this.#manifestName)
    if (localText) {
      const local = this.#tryParseManifest(localText)
      if (local) return local
      await this.#safeRemove(domainLayersDir, this.#manifestName)
    }

    // remote
    const url = `${endpoint}/${this.#manifestName}`
    const bytes = await this.#fetchBytes(url)
    if (!bytes) return null

    const text = new TextDecoder().decode(bytes)
    const parsed = this.#tryParseManifest(text)
    if (!parsed) return null

    await this.#writeBytesFile(domainLayersDir, this.#manifestName, bytes)
    return parsed
  }

  #tryParseManifest = (text: string): InstallManifest | null => {
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

      // store as: opfsroot/__layers__/<domain>/<sig>
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

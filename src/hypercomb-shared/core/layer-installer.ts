// hypercomb-shared/core/layer-installer.ts

import { type LayerV2 } from '@hypercomb/core'
import { Store } from './store'

type InstallManifestV2 = {
  version: 2
  bees: string[]
  dependencies: string[]
  resources: string[]
  history: Record<string, LayerV2>
}

// global get/register/list available via ioc.web.ts

export class LayerInstaller {

  readonly #manifestName = 'install.manifest.json'

  /**
   * Install from a content endpoint.
   * endpoint = baseUrl/rootSig  (e.g. https://host/content/abc123...)
   */
  public install = async (endpoint: string): Promise<void> => {
    if (!endpoint) return

    const store = get('@hypercomb.social/Store') as Store

    // 1) fetch manifest
    const manifest = await this.#fetchManifest(endpoint)
    if (!manifest) return

    // 2) install all files to OPFS
    await this.#installBees(store, endpoint, manifest.bees)
    await this.#installDependencies(store, endpoint, manifest.dependencies)
    await this.#installResources(store, endpoint, manifest.resources)

    // 3) seed history bags from manifest
    await this.#seedHistory(store, manifest.history)

    // 4) populate live cache
    store.seedLiveCache(manifest.history)

    // 5) save snapshot for fast restore
    await store.saveSnapshot()

    console.log('[layer-installer] install complete')
  }

  // -------------------------------------------------
  // manifest
  // -------------------------------------------------

  #fetchManifest = async (endpoint: string): Promise<InstallManifestV2 | null> => {
    const url = `${endpoint}/${this.#manifestName}`
    const bytes = await this.#fetchBytes(url)
    if (!bytes) return null

    try {
      const text = new TextDecoder().decode(bytes)
      const parsed = JSON.parse(text) as InstallManifestV2
      if (parsed.version !== 2) {
        console.warn('[layer-installer] unsupported manifest version:', parsed.version)
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  // -------------------------------------------------
  // install files
  // -------------------------------------------------

  #installBees = async (store: Store, endpoint: string, bees: string[]): Promise<void> => {
    const dir = store.bees
    for (const sig of bees) {
      if (!sig) continue
      const name = `${sig}.js`
      if (await this.#fileExists(dir, name)) continue

      const bytes = await this.#fetchBytes(`${endpoint}/__bees__/${name}`)
      if (bytes) await this.#writeFile(dir, name, bytes)
    }
  }

  #installDependencies = async (store: Store, endpoint: string, deps: string[]): Promise<void> => {
    const dir = store.dependencies
    for (const sig of deps) {
      if (!sig) continue
      const name = `${sig}.js`
      if (await this.#fileExists(dir, name)) continue

      const bytes = await this.#fetchBytes(`${endpoint}/__dependencies__/${name}`)
      if (bytes) await this.#writeFile(dir, name, bytes)
    }
  }

  #installResources = async (store: Store, endpoint: string, resources: string[]): Promise<void> => {
    const dir = store.resources
    for (const sig of resources) {
      if (!sig) continue
      if (await this.#fileExists(dir, sig)) continue

      const bytes = await this.#fetchBytes(`${endpoint}/__resources__/${sig}`)
      if (bytes) await this.#writeFile(dir, sig, bytes)
    }
  }

  // -------------------------------------------------
  // history seeding
  // -------------------------------------------------

  #seedHistory = async (store: Store, history: Record<string, LayerV2>): Promise<void> => {
    for (const [lineageSig, layer] of Object.entries(history)) {
      await store.appendHistory(lineageSig, layer)
    }
  }

  // -------------------------------------------------
  // io helpers
  // -------------------------------------------------

  #fileExists = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
    try {
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }

  #writeFile = async (dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> => {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes as unknown as ArrayBuffer)
    await writable.close()
  }

  #fetchBytes = async (url: string): Promise<Uint8Array | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null
      return new Uint8Array(await res.arrayBuffer())
    } catch {
      return null
    }
  }
}

register('@hypercomb.social/LayerInstaller', new LayerInstaller())

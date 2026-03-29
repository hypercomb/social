// diamond-core-processor/src/app/core/package-export.service.ts

import { inject, Injectable } from '@angular/core'
import { DcpStore } from './dcp-store'

type LayerJson = {
  version?: number
  name: string
  rel?: string
  bees?: string[]
  dependencies?: string[]
  layers?: string[]
  children?: string[]
}

type ExportBundle = {
  version: 1
  rootSig: string
  latest: { seed: string }
  manifest: {
    version: number
    layers: string[]
    bees: string[]
    dependencies: string[]
    beeDeps: Record<string, string[]>
  }
  files: Record<string, string> // path → base64 content
}

@Injectable({ providedIn: 'root' })
export class PackageExportService {

  #store = inject(DcpStore)

  /**
   * Export the full package for a given root signature.
   * Tries showDirectoryPicker first, falls back to JSON bundle download.
   */
  async exportPackage(rootSig: string, domain: string): Promise<void> {
    await this.#store.initialize()

    // collect all signatures by walking the tree
    const allLayers: string[] = []
    const allBees: string[] = []
    const allDeps: string[] = []
    await this.#collectSigs(rootSig, domain, allLayers, allBees, allDeps)

    // build manifest
    const manifest = {
      version: 2,
      layers: allLayers,
      bees: allBees,
      dependencies: allDeps,
      beeDeps: {} as Record<string, string[]>
    }

    // try directory picker first
    if ('showDirectoryPicker' in window) {
      try {
        await this.#exportToDirectory(rootSig, domain, manifest, allLayers, allBees, allDeps)
        return
      } catch (e: unknown) {
        // user cancelled or API not available — fall through to JSON bundle
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }

    // fallback: JSON bundle download
    await this.#exportAsJsonBundle(rootSig, domain, manifest, allLayers, allBees, allDeps)
  }

  async #exportToDirectory(
    rootSig: string, domain: string,
    manifest: ExportBundle['manifest'],
    layers: string[], bees: string[], deps: string[]
  ): Promise<void> {
    const picker = (window as any).showDirectoryPicker
    const dirHandle: FileSystemDirectoryHandle = await picker({ mode: 'readwrite' })
    const rootDir = await dirHandle.getDirectoryHandle(rootSig, { create: true })

    // write latest.json
    await this.#writeTextFile(rootDir, 'latest.json', JSON.stringify({ seed: rootSig }))

    // write manifest
    await this.#writeTextFile(rootDir, 'install.manifest.json', JSON.stringify(manifest))

    // write layers
    const layersDir = await rootDir.getDirectoryHandle('__layers__', { create: true })
    for (const sig of layers) {
      const bytes = await this.#readLayerBytes(sig, domain)
      if (bytes) await this.#writeBinaryFile(layersDir, `${sig}.json`, bytes)
    }

    // write bees
    const beesDir = await rootDir.getDirectoryHandle('__bees__', { create: true })
    for (const sig of bees) {
      const bytes = await this.#readBeeBytes(sig, domain)
      if (bytes) await this.#writeBinaryFile(beesDir, `${sig}.js`, bytes)
    }

    // write dependencies
    const depsDir = await rootDir.getDirectoryHandle('__dependencies__', { create: true })
    for (const sig of deps) {
      const bytes = await this.#readDepBytes(sig, domain)
      if (bytes) await this.#writeBinaryFile(depsDir, `${sig}.js`, bytes)
    }
  }

  async #exportAsJsonBundle(
    rootSig: string, domain: string,
    manifest: ExportBundle['manifest'],
    layers: string[], bees: string[], deps: string[]
  ): Promise<void> {
    const files: Record<string, string> = {}

    for (const sig of layers) {
      const bytes = await this.#readLayerBytes(sig, domain)
      if (bytes) files[`__layers__/${sig}.json`] = this.#toBase64(bytes)
    }

    for (const sig of bees) {
      const bytes = await this.#readBeeBytes(sig, domain)
      if (bytes) files[`__bees__/${sig}.js`] = this.#toBase64(bytes)
    }

    for (const sig of deps) {
      const bytes = await this.#readDepBytes(sig, domain)
      if (bytes) files[`__dependencies__/${sig}.js`] = this.#toBase64(bytes)
    }

    const bundle: ExportBundle = {
      version: 1,
      rootSig,
      latest: { seed: rootSig },
      manifest,
      files
    }

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${rootSig.slice(0, 12)}-package.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async #collectSigs(
    layerSig: string, domain: string,
    layers: string[], bees: string[], deps: string[]
  ): Promise<void> {
    layers.push(layerSig)

    const bytes = await this.#readLayerBytes(layerSig, domain)
    if (!bytes) return

    const layer = JSON.parse(new TextDecoder().decode(bytes)) as LayerJson

    for (const raw of layer.bees ?? []) {
      const sig = raw.replace(/\.js$/i, '')
      if (!bees.includes(sig)) bees.push(sig)
    }

    for (const raw of layer.dependencies ?? []) {
      const sig = raw.replace(/\.js$/i, '')
      if (!deps.includes(sig)) deps.push(sig)
    }

    for (const childSig of layer.layers ?? layer.children ?? []) {
      await this.#collectSigs(childSig, domain, layers, bees, deps)
    }
  }

  /**
   * Read a layer from patched or original OPFS.
   */
  async #readLayerBytes(sig: string, domain: string): Promise<ArrayBuffer | null> {
    const patchedDir = await this.#store.patchedLayersDir(domain)
    const patched = await this.#store.readFile(patchedDir, sig)
    if (patched) return patched

    const domainDir = await this.#store.domainLayersDir(domain)
    return await this.#store.readFile(domainDir, sig)
  }

  async #readBeeBytes(sig: string, domain: string): Promise<ArrayBuffer | null> {
    const patchedDir = await this.#store.patchedBeesDir(domain)
    const patched = await this.#store.readFile(patchedDir, `${sig}.js`)
    if (patched) return patched

    return await this.#store.readFile(this.#store.bees, `${sig}.js`)
  }

  async #readDepBytes(sig: string, domain: string): Promise<ArrayBuffer | null> {
    const patchedDir = await this.#store.patchedDepsDir(domain)
    const patched = await this.#store.readFile(patchedDir, `${sig}.js`)
    if (patched) return patched

    return await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
  }

  async #writeTextFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  async #writeBinaryFile(dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

  #toBase64(bytes: ArrayBuffer): string {
    const binary = Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join('')
    return btoa(binary)
  }
}

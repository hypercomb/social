// hypercomb-shared/core/layer-installer.ts

import { Injectable } from '@angular/core'
import { type LocationParseResult } from './initializers/location-parser'
import { Store } from './store'

type LayerInstallFile = {
  signature: string
  name?: string
  layers?: string[]
  drones?: string[]
  dependencies?: string[]
}

type LayerServiceApi = {
  get: (parsed: LocationParseResult) => Promise<LayerInstallFile | null>
}

@Injectable({ providedIn: 'root' })
export class LayerInstaller {

  private static readonly INSTALL_SUFFIX = '-install'

  public install = async (parsed: LocationParseResult): Promise<void> => {
    const baseUrl = (parsed?.baseUrl ?? '').trim().replace(/\/+$/, '')
    const path = (parsed?.path ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
    const rootSig = (parsed?.signature ?? '').trim()

    if (!baseUrl) {
      console.log('[layer-installer] install skipped: empty base url')
      return
    }

    if (!rootSig) {
      console.log('[layer-installer] install skipped: empty signature')
      return
    }

    // remote root used for fetching drones / deps
    const baseRoot =
      path
        ? `${baseUrl}/${path}`.replace(/\/+$/, '')
        : baseUrl

    const { get } = window.ioc
    const store = get('Store') as Store
    const layers = get('LayerService') as LayerServiceApi

    // layers directory is flat by design
    const layersDir = store.layersDirectory()

    // ensure the root layer exists locally and is queued for install
    await layers.get({ ...parsed, signature: rootSig })
    await this.ensureInstallMarker(layersDir, rootSig)

    await this.installLoop(baseRoot, parsed, layersDir, new Set<string>())

    console.log('[layer-installer] install complete')
  }

  private installLoop = async (
    baseRoot: string,
    parsed: LocationParseResult,
    layersDir: FileSystemDirectoryHandle,
    visited: Set<string>
  ): Promise<void> => {

    const root = (baseRoot ?? '').trim().replace(/\/+$/, '')

    for (;;) {
      const installNames: string[] = []

      for await (const [name, handle] of layersDir.entries()) {
        if (handle.kind !== 'file') continue
        if (!name.endsWith(LayerInstaller.INSTALL_SUFFIX)) continue
        installNames.push(name)
      }

      installNames.sort((a, b) => a.localeCompare(b))
      if (!installNames.length) return

      let progressed = false

      for (const name of installNames) {
        const sig = this.installNameToSig(name)
        if (!sig) continue

        if (visited.has(sig)) {
          await this.safeRemove(layersDir, name)
          continue
        }

        const handle = await this.tryGetFileHandle(layersDir, name)
        if (!handle) continue

        const { ok, layerText, layer } = await this.readInstallLayer(handle, sig)
        if (!ok || !layerText || !layer) {
          await this.safeRemove(layersDir, name)
          continue
        }

        visited.add(sig)
        progressed = true

        // commit stable layer file for lookup/debugging
        await this.ensureStableLayer(layersDir, sig, layerText)

        console.log(`[layer-installer] installing layer ${sig} (${layerText.length} chars)`)

        // install dependencies
        await this.installDependencies(root, layer)

        // install drones
        await this.installDrones(root, layer)

        const { get } = window.ioc
        const layers = get('LayerService') as LayerServiceApi

        // discover children, ensure local, then queue child installs
        for (const childSigRaw of layer.layers ?? []) {
          const childSig = (childSigRaw ?? '').trim()
          if (!childSig) continue

          await layers.get({ ...parsed, signature: childSig })
          await this.ensureInstallMarker(layersDir, childSig)
        }

        // consume install marker
        await this.safeRemove(layersDir, name)
      }

      if (!progressed) return
    }
  }

  // -------------------------------------------------
  // install steps
  // -------------------------------------------------

  private installDependencies = async (baseRoot: string, layer: LayerInstallFile): Promise<void> => {
    const { get } = window.ioc
    const store = get('Store') as Store

    const targetDirectory = store.dependenciesDirectory()
    const root = (baseRoot ?? '').trim().replace(/\/+$/, '')

    for (const dependency of layer.dependencies ?? []) {
      const dep = (dependency ?? '').trim()
      if (!dep) continue

      const exists = await this.tryGetFileHandle(targetDirectory, dep)
      if (exists) {
        console.log(`[layer-installer] dependency already present: ${dep}`)
        continue
      }

      const url = `${root}/__dependencies__/${dep}`
      const bytes = await this.fetchBytes(url)
      if (!bytes) continue

      await this.writeBytesFile(targetDirectory, dep, bytes)
      console.log(`[layer-installer] stored dependency ${dep} (${bytes.byteLength} bytes)`)
    }
  }

  private installDrones = async (baseRoot: string, layer: LayerInstallFile): Promise<void> => {
    const { get } = window.ioc
    const store = get('Store') as Store

    const targetDirectory = store.dronesDirectory()
    const root = (baseRoot ?? '').trim().replace(/\/+$/, '')

    for (const drone of layer.drones ?? []) {
      const dr = (drone ?? '').trim()
      if (!dr) continue

      const exists = await this.tryGetFileHandle(targetDirectory, dr)
      if (exists) {
        console.log(`[layer-installer] drone already present: ${dr}`)
        continue
      }

      const url = `${root}/__drones__/${dr}`
      const bytes = await this.fetchBytes(url)
      if (!bytes) continue

      await this.writeBytesFile(targetDirectory, dr, bytes)
      console.log(`[layer-installer] stored drone ${dr} (${bytes.byteLength} bytes)`)
    }
  }

  // -------------------------------------------------
  // layer files
  // -------------------------------------------------

  private ensureStableLayer = async (
    layersDir: FileSystemDirectoryHandle,
    signature: string,
    layerText: string
  ): Promise<void> => {
    const sig = (signature ?? '').trim()
    if (!sig) return

    const existing = await this.tryGetFileHandle(layersDir, sig)
    if (existing) {
      const file = await existing.getFile().catch(() => null)
      if (file && file.size > 0) return
    }

    await this.writeTextFile(layersDir, sig, layerText)
  }

  private ensureInstallMarker = async (
    layersDir: FileSystemDirectoryHandle,
    signature: string
  ): Promise<void> => {
    const sig = (signature ?? '').trim()
    if (!sig) return

    const installName = `${sig}${LayerInstaller.INSTALL_SUFFIX}`

    const existing = await this.tryGetFileHandle(layersDir, installName)
    if (existing) {
      const file = await existing.getFile().catch(() => null)
      if (file && file.size > 0) return
    }

    // copy from stable file (signature) into install marker
    const stable = await this.tryGetFileHandle(layersDir, sig)
    const stableFile = stable ? await stable.getFile().catch(() => null) : null
    if (!stableFile || stableFile.size <= 0) return

    const bytes = new Uint8Array(await stableFile.arrayBuffer())
    await this.writeBytesFile(layersDir, installName, bytes)
  }

  private readInstallLayer = async (
    handle: FileSystemFileHandle,
    sig: string
  ): Promise<{ ok: boolean; layerText: string | null; layer: LayerInstallFile | null }> => {

    const file = await handle.getFile().catch(() => null)
    if (!file) return { ok: false, layerText: null, layer: null }

    const text = ((await file.text().catch(() => '')) ?? '').trim()
    if (!text) return { ok: false, layerText: null, layer: null }

    try {
      const json = JSON.parse(text) as LayerInstallFile

      if ((json.signature ?? '').trim() && (json.signature ?? '').trim() !== sig) {
        console.log(`[layer-installer] signature mismatch marker=${sig} payload=${json.signature}`)
        json.signature = sig
      }

      return { ok: true, layerText: text, layer: json }
    } catch {
      console.log(`[layer-installer] invalid json in ${sig}${LayerInstaller.INSTALL_SUFFIX}`)
      return { ok: false, layerText: text, layer: null }
    }
  }

  private installNameToSig = (name: string): string | null => {
    if (!name.endsWith(LayerInstaller.INSTALL_SUFFIX)) return null
    return name.slice(0, -LayerInstaller.INSTALL_SUFFIX.length) || null
  }

  // -------------------------------------------------
  // opfs utilities
  // -------------------------------------------------

  private tryGetFileHandle = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<FileSystemFileHandle | null> => {
    try {
      return await dir.getFileHandle(name)
    } catch {
      return null
    }
  }

  private safeRemove = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<void> => {
    try {
      await dir.removeEntry(name)
    } catch {
      // ignore
    }
  }

  private writeBytesFile = async (
    dir: FileSystemDirectoryHandle,
    name: string,
    bytes: Uint8Array<ArrayBuffer>
  ): Promise<void> => {
    const outHandle = await dir.getFileHandle(name, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

  private writeTextFile = async (
    dir: FileSystemDirectoryHandle,
    name: string,
    text: string
  ): Promise<void> => {
    const outHandle = await dir.getFileHandle(name, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  // -------------------------------------------------
  // fetch utilities
  // -------------------------------------------------

  private fetchBytes = async (url: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })

      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      console.log(`[layer-installer] fetch ${url} -> ${res.status} ${ct}`)

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.log(`[layer-installer] fetch failed body (first 200): ${body.slice(0, 200)}`)
        return null
      }

      if (ct.includes('text/html')) {
        const body = await res.text().catch(() => '')
        console.log(`[layer-installer] unexpected html (first 200): ${body.slice(0, 200)}`)
        return null
      }

      const buf: ArrayBuffer = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch (err) {
      console.log('[layer-installer] fetch error', err)
      return null
    }
  }
}

window.ioc.register('LayerInstaller', new LayerInstaller())

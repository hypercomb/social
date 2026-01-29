// src/app/core/layer-restoration.service.ts

import { Injectable, inject } from '@angular/core'
import { DirectoryWalkerService } from './directory-walker.service'
import { ScriptPreloaderService } from './script-preloader.service'

type LayerRecord = { name: string; children: string[]; drones: string[] }

@Injectable({ providedIn: 'root' })
export class LayerRestorationService {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly DEFAULT_ORIGIN = 'https://storagehypercomb.blob.core.windows.net/content/ee6f2ec14e1ad55b2705d7490a79e5903f0ba4e29c7ddf9a28ef9efcd0fd10fa'
  private static readonly LOCATION_FILE = '__location__'
  private static readonly LAYERS_DIRECTORY = 'layers'
  private static readonly RESOURCES_DIRECTORY = '__resources__'
  private static readonly INSTALL_PREFIX = 'install-'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly walker = inject(DirectoryWalkerService)
  private readonly preloader = inject(ScriptPreloaderService)

  // -------------------------------------------------
  // private fields
  // -------------------------------------------------

  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  // phase 1: structural restore only (layers -> seed folders + marker files)
  // - resolves layer json (opfs first, http fallback, caches in domain/layers)
  // - creates child seed folders
  // - creates install-* files for next pass
  // - creates marker files for drones (file name = drone signature)
  public load = async (domainsRoot: FileSystemDirectoryHandle, depth: number): Promise<void> => {
    for await (const [name, entry] of domainsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isDomainSkippable(name)) continue

      await this.loadDomain(entry as FileSystemDirectoryHandle, depth)
    }
  }

  // phase 2: marker restore (walk dirs -> marker signatures -> local cache -> remote -> cache -> preload)
  // - uses the walker so the behavior matches the actual installed structure
  // - looks for marker files (file name is a 64-hex signature) and resolves payloads into __resources__
  // - preloads only what markers declare (no bulk preload unless markers are present)
  public restore = async (domainsRoot: FileSystemDirectoryHandle, depth: number): Promise<void> => {
    for await (const [name, entry] of domainsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isDomainSkippable(name)) continue

      await this.restoreDomain(entry as FileSystemDirectoryHandle, depth)
    }
  }

  // -------------------------------------------------
  // domain load (phase 1)
  // -------------------------------------------------

  private loadDomain = async (rootDirectory: FileSystemDirectoryHandle, depth: number): Promise<void> => {
    const server = await this.readLocationPrefix(rootDirectory)
    if (!server) return

    const layersDir = await rootDirectory.getDirectoryHandle(LayerRestorationService.LAYERS_DIRECTORY, { create: true })
    await this.loadRecursive(layersDir, `${server}/${LayerRestorationService.LAYERS_DIRECTORY}`, rootDirectory, depth)
  }

  private loadRecursive = async (
    layersDir: FileSystemDirectoryHandle,
    layersLocation: string,
    currentDir: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    if (depth < 0) return

    // install files are applied to each directory
    for await (const [name, entry] of currentDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!name.startsWith(LayerRestorationService.INSTALL_PREFIX)) continue

      const seedSig = name.slice(LayerRestorationService.INSTALL_PREFIX.length).trim()
      if (!seedSig) continue

      await this.consumeInstall(layersDir, layersLocation, currentDir, seedSig)
    }

    if (depth === 0) return

    // descend only into user seed folders (never internal folders)
    for await (const [name, entry] of currentDir.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isInternalDirectoryName(name)) continue

      await this.loadRecursive(
        layersDir,
        layersLocation,
        entry as FileSystemDirectoryHandle,
        depth - 1
      )
    }
  }

  private consumeInstall = async (
    layersDir: FileSystemDirectoryHandle,
    layersLocation: string,
    parentDir: FileSystemDirectoryHandle,
    seedSignature: string
  ): Promise<void> => {

    const layer = await this.lookupLayer(layersDir, layersLocation, seedSignature)
    console.log('[layer-restoration] restoring layer', seedSignature, layer!)

    if (layer === null) return

    // create children + plant install files
    for (const child of layer.children) {
      const childLayer = await this.lookupLayer(layersDir, layersLocation, child)
      if (childLayer === null) continue

      console.log('[layer-restoration]  - child layer', child, childLayer)

      const childName = childLayer.name
      const seedDir = await parentDir.getDirectoryHandle(childName, { create: true })

      await seedDir.getFileHandle(`${LayerRestorationService.INSTALL_PREFIX}${child}`, { create: true })
    }

    // plant marker files (marker file name == drone signature)
    for (const drone of layer.drones) {
      const sig = String(drone ?? '').trim()
      if (!this.isSignature(sig)) continue

      await parentDir.getFileHandle(sig, { create: true })
    }

    // finally remove the install file for this layer
    parentDir.removeEntry(`${LayerRestorationService.INSTALL_PREFIX}${seedSignature}`).catch(() => {
      // ignore
    })
  }

  // -------------------------------------------------
  // domain restore (phase 2)
  // -------------------------------------------------

  private restoreDomain = async (rootDirectory: FileSystemDirectoryHandle, depth: number): Promise<void> => {
    const server = await this.readLocationPrefix(rootDirectory)
    if (!server) return

    const resourcesDir = await rootDirectory.getDirectoryHandle(LayerRestorationService.RESOURCES_DIRECTORY, { create: true })

    const walked = await this.walker.walk(rootDirectory, depth)

    for (const dir of walked) {
      if (this.isPathSkippable(dir.path)) continue

      await this.restoreMarkersInDirectory(resourcesDir, server, dir.handle)
    }
  }

  private restoreMarkersInDirectory = async (
    resourcesDir: FileSystemDirectoryHandle,
    server: string,
    dir: FileSystemDirectoryHandle
  ): Promise<void> => {

    for await (const [name, entry] of dir.entries()) {
      if (entry.kind !== 'file') continue
      if (name === LayerRestorationService.LOCATION_FILE) continue
      if (name.startsWith(LayerRestorationService.INSTALL_PREFIX)) continue
      if (!this.isSignature(name)) continue

      // marker file name is the drone signature
      await this.ensureDronePreloaded(resourcesDir, `${server}/resources`, name)
    }
  }

  // -------------------------------------------------
  // marker -> local -> server resolution (resources)
  // -------------------------------------------------

  private ensureDronePreloaded = async (
    resourcesDir: FileSystemDirectoryHandle,
    resourcesLocation: string,
    signature: string
  ): Promise<void> => {

    if (this.preloader.has(signature)) return

    const result = await this.getDronePayloadBytes(resourcesDir, resourcesLocation, signature)
    if (!result.bytes) return

    // ensure the cache is populated when it came from the network
    if (!result.exists) {
      await this.writeCachedDronePayload(resourcesDir, signature, result.bytes)
    }

    this.preloader.add(signature, result.bytes)
  }

  private getDronePayloadBytes = async (
    resourcesDir: FileSystemDirectoryHandle,
    resourcesLocation: string,
    signature: string
  ): Promise<{ exists: boolean; bytes: ArrayBuffer | null }> => {

    const cached = await this.readCachedDronePayload(resourcesDir, signature)
    if (cached) return { exists: true, bytes: cached }

    const fetched = await this.fetchDronePayload(resourcesLocation, signature)
    return { exists: false, bytes: fetched }
  }

  private readCachedDronePayload = async (
    resourcesDir: FileSystemDirectoryHandle,
    signature: string
  ): Promise<ArrayBuffer | null> => {

    try {
      const fileHandle = await resourcesDir.getFileHandle(signature, { create: false })
      const file = await fileHandle.getFile()
      return await file.arrayBuffer()
    } catch {
      return null
    }
  }

  private writeCachedDronePayload = async (
    resourcesDir: FileSystemDirectoryHandle,
    signature: string,
    bytes: ArrayBuffer
  ): Promise<void> => {

    const handle = await resourcesDir.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }
  }

  private fetchDronePayload = async (
    resourcesLocation: string,
    signature: string
  ): Promise<ArrayBuffer | null> => {

    const url = `${resourcesLocation}/${signature}`
    console.log('[layer-restoration] fetching drone payload', url)

    const res = await fetch(url)
    if (!res.ok) return null

    const buf = await res.arrayBuffer()

    // quick sanity check: payload must be json
    const head = this.decoder.decode(new Uint8Array(buf.slice(0, 1)))
    if (head !== '{') {
      console.error('[layer-restoration] non-json drone payload encountered:', signature)
      return null
    }

    return buf
  }

  // -------------------------------------------------
  // lookup layer: coordinator only
  // -------------------------------------------------

  private lookupLayer = async (
    layersDir: FileSystemDirectoryHandle,
    location: string,
    signature: string
  ): Promise<LayerRecord | null> => {

    const result = await this.getLayerJsonText(layersDir, location, signature)
    if (result.content === '') return null

    if (!result.exists) {
      await this.writeCachedLayerJson(layersDir, signature, result.content)
    }

    const parsedResult = this.parseLayerJson(signature, result.content)
    return { ...parsedResult }
  }

  // -------------------------------------------------
  // step 1: get json text (opfs first, http fallback)
  // -------------------------------------------------

  private getLayerJsonText = async (
    layersDir: FileSystemDirectoryHandle,
    location: string,
    signature: string
  ): Promise<{ exists: boolean; content: string }> => {

    const cached = await this.readCachedLayerJson(layersDir, signature)
    if (cached) return { exists: true, content: cached }

    const fetched = await this.fetchLayerJson(location, signature)
    return { exists: false, content: fetched || '' }
  }

  private readCachedLayerJson = async (
    layersDir: FileSystemDirectoryHandle,
    signature: string
  ): Promise<string | null> => {

    try {
      const fileHandle = await layersDir.getFileHandle(signature, { create: false })
      const file = await fileHandle.getFile()
      return this.decoder.decode(await file.arrayBuffer())
    } catch {
      return null
    }
  }

  private writeCachedLayerJson = async (
    layersDir: FileSystemDirectoryHandle,
    signature: string,
    jsonText: string
  ): Promise<void> => {

    const handle = await layersDir.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(this.encoder.encode(jsonText))
    } finally {
      await writable.close()
    }
  }

  private fetchLayerJson = async (
    location: string,
    signature: string
  ): Promise<string | null> => {

    const url = `${location}/${signature}`
    console.log('[layer-restoration] fetching layer json', url)

    const res = await fetch(url)
    if (!res.ok) return null

    return await res.text()
  }

  // -------------------------------------------------
  // step 2: parse + validate
  // -------------------------------------------------

  private parseLayerJson = (signature: string, jsonText: string): LayerRecord => {
    let parsed: any

    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`[layer-restoration] invalid layer json ${signature}`)
    }

    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    if (!name) {
      throw new Error(`[layer-restoration] layer ${signature} missing name`)
    }

    if (!Array.isArray(parsed.children)) {
      throw new Error(`[layer-restoration] layer ${signature} missing children`)
    }

    const children = parsed.children
      .map((c: unknown) => String(c).trim())
      .filter((c: string) => this.isSignature(c))

    const drones = (Array.isArray(parsed.drones) ? parsed.drones : [])
      .map((d: unknown) => String(d).trim())
      .filter((d: string) => this.isSignature(d))

    return { name, children, drones }
  }

  // -------------------------------------------------
  // location + helpers
  // -------------------------------------------------

  private readLocationPrefix = async (rootDirectory: FileSystemDirectoryHandle): Promise<string | null> => {
    let raw = ''

    try {
      const handle = await rootDirectory.getFileHandle(LayerRestorationService.LOCATION_FILE, { create: false })
      const file = await handle.getFile()
      raw = (await file.text()).trim()
    } catch {
      return null
    }

    if (!raw) return null

    if (/^https?:\/\//i.test(raw)) {
      return raw.replace(/\/+$/, '')
    }

    const root = raw.trim()
    if (!this.isSignature(root)) {
      throw new Error('[layer-restoration] __location__ must be a url or 64-hex root signature')
    }

    return `${LayerRestorationService.DEFAULT_ORIGIN}/${root}`
  }

  private isSignature = (value: string): boolean =>
    /^[a-f0-9]{64}$/i.test(value)

  private isDomainSkippable = (name: string): boolean =>
    name === 'hypercomb' || name.startsWith('__')

  private isInternalDirectoryName = (name: string): boolean =>
    name === LayerRestorationService.LAYERS_DIRECTORY ||
    name === LayerRestorationService.RESOURCES_DIRECTORY ||
    name.startsWith('__')

  private isPathSkippable = (path: readonly string[]): boolean =>
    path.some(p =>
      p === LayerRestorationService.LAYERS_DIRECTORY ||
      p === LayerRestorationService.RESOURCES_DIRECTORY ||
      p.startsWith('__')
    )
}

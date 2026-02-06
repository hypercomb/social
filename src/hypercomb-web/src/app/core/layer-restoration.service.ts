// src/app/core/layer-restoration.service.ts

import { Injectable, inject } from '@angular/core'
import { DirectoryWalkerService } from './directory-walker.service'
import { ScriptPreloader } from './script-preloader'
import { has } from '@hypercomb/core'
import { Store } from './store'

type LayerRecord = {
  name: string
  children: string[]
  drones: string[]
}

@Injectable({ providedIn: 'root' })
export class LayerRestorationService {

  private readonly store = inject(Store)
  private readonly walker = inject(DirectoryWalkerService)
  private readonly preloader = inject(ScriptPreloader)

  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()

  private static readonly DEFAULT_ORIGIN =
    'https://storagehypercomb.blob.core.windows.net/content'

  private static readonly LOCATION_FILE = '__location__'
  private static readonly LAYERS_DIRECTORY = '__layers__'
  private static readonly RESOURCES_DIRECTORY = '__resources__'
  private static readonly INSTALL_PREFIX = 'install-'

  // -------------------------------------------------
  // phase 1: layer structure restore
  // -------------------------------------------------

  public load = async (
    domainsRoot: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    for await (const [name, entry] of domainsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isDomainSkippable(name)) continue

      const dir = entry as FileSystemDirectoryHandle
      await this.loadDomain(dir, depth)
    }
  }

  private loadDomain = async (
    domainDirectory: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    const server = await this.readLocationPrefix(domainDirectory)
    if (!server) return

    const layersDir =
      await domainDirectory.getDirectoryHandle(
        LayerRestorationService.LAYERS_DIRECTORY,
        { create: true }
      )

    await this.loadRecursive(
      layersDir,
      `${server}/${LayerRestorationService.LAYERS_DIRECTORY}`,
      domainDirectory,
      depth
    )
  }

  private loadRecursive = async (
    layersDir: FileSystemDirectoryHandle,
    layersLocation: string,
    currentDir: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    if (depth < 0) return

    for await (const [name, entry] of currentDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!name.startsWith(LayerRestorationService.INSTALL_PREFIX)) continue

      const seedSig =
        name.slice(LayerRestorationService.INSTALL_PREFIX.length).trim()

      if (!this.isSignature(seedSig)) continue

      await this.consumeInstall(
        layersDir,
        layersLocation,
        currentDir,
        seedSig
      )
    }

    if (depth === 0) return

    for await (const [name, entry] of currentDir.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isInternalDirectoryName(name)) continue

      const dir = entry as FileSystemDirectoryHandle

      await this.loadRecursive(
        layersDir,
        layersLocation,
        dir,
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

    const layer =
      await this.lookupLayer(layersDir, layersLocation, seedSignature)
    if (!layer) return

    for (const child of layer.children) {
      const childLayer =
        await this.lookupLayer(layersDir, layersLocation, child)
      if (!childLayer) continue

      const seedDir =
        await parentDir.getDirectoryHandle(childLayer.name, { create: true })

      await seedDir.getFileHandle(
        `${LayerRestorationService.INSTALL_PREFIX}${child}`,
        { create: true }
      )
    }

    for (const droneSig of layer.drones) {
      if (!this.isSignature(droneSig)) continue
      await parentDir.getFileHandle(droneSig, { create: true })
    }

    parentDir.removeEntry(
      `${LayerRestorationService.INSTALL_PREFIX}${seedSignature}`
    ).catch(() => {})
  }

  // -------------------------------------------------
  // phase 2: marker restore (resources)
  // -------------------------------------------------

  public restore = async (
    domainsRoot: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    for await (const [name, entry] of domainsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isDomainSkippable(name)) continue

      const dir = entry as FileSystemDirectoryHandle
      await this.restoreDomain(dir, depth)
    }
  }

  private restoreDomain = async (
    rootDirectory: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    const walked = await this.walker.walk(rootDirectory, depth)

    for (const dir of walked) {
      if (this.isPathSkippable(dir.path)) continue
      await this.restoreMarkersInDirectory(dir.handle)
    }
  }

  private restoreMarkersInDirectory = async (
    dir: FileSystemDirectoryHandle
  ): Promise<void> => {

    for await (const [name, entry] of dir.entries()) {
      if (entry.kind !== 'file') continue
      if (name === LayerRestorationService.LOCATION_FILE) continue
      if (name.startsWith(LayerRestorationService.INSTALL_PREFIX)) continue
      if (!this.isSignature(name)) continue

      await this.ensureDronePreloaded(name)
    }
  }

  private ensureDronePreloaded = async (
    signature: string
  ): Promise<void> => {

    if (has(signature)) return

    const result = await this.getDronePayloadBytes(signature)
    if (!result.bytes) return

    if (!result.exists) {
      await this.writeCachedDronePayload(signature, result.bytes)
    }
  }

  private getDronePayloadBytes = async (
    signature: string
  ): Promise<{ exists: boolean; bytes: ArrayBuffer | null }> => {

    const cached = await this.readCachedDronePayload(signature)
    if (cached) return { exists: true, bytes: cached }

    const fetched = await this.fetchDronePayload(signature)
    return { exists: false, bytes: fetched }
  }

  private readCachedDronePayload = async (
    signature: string
  ): Promise<ArrayBuffer | null> => {
    try {
      const handle =
        await this.store.resourcesDirectory().getFileHandle(signature)
      const file = await handle.getFile()
      return await file.arrayBuffer()
    } catch {
      return null
    }
  }

  private writeCachedDronePayload = async (
    signature: string,
    bytes: ArrayBuffer
  ): Promise<void> => {

    const handle =
      await this.store.resourcesDirectory().getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }
  }

  private fetchDronePayload = async (
    signature: string
  ): Promise<ArrayBuffer | null> => {

    const url =
      `${LayerRestorationService.DEFAULT_ORIGIN}/__resources__/${signature}`

    const res = await fetch(url)
    if (!res.ok) return null

    return await res.arrayBuffer()
  }

  // -------------------------------------------------
  // layer lookup
  // -------------------------------------------------

  private lookupLayer = async (
    layersDir: FileSystemDirectoryHandle,
    location: string,
    signature: string
  ): Promise<LayerRecord | null> => {

    const result = await this.getLayerJsonText(layersDir, location, signature)
    if (!result.content) return null

    if (!result.exists) {
      await this.writeCachedLayerJson(layersDir, signature, result.content)
    }

    return this.parseLayerJson(signature, result.content)
  }

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
      const handle = await layersDir.getFileHandle(signature)
      const file = await handle.getFile()
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

    const res = await fetch(`${location}/${signature}`)
    if (!res.ok) return null
    return await res.text()
  }

  private parseLayerJson = (
    signature: string,
    jsonText: string
  ): LayerRecord => {

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`invalid layer json ${signature}`)
    }

    const name = String(parsed.name || '').trim()
    if (!name) throw new Error(`layer ${signature} missing name`)

    const children =
      (Array.isArray(parsed.children) ? parsed.children : [])
        .map((c: unknown) => String(c).trim())
        .filter((c: string) => this.isSignature(c))

    const drones =
      (Array.isArray(parsed.drones) ? parsed.drones : [])
        .map((d: unknown) => String(d).trim())
        .filter((d: string) => this.isSignature(d))

    return { name, children, drones }
  }

  private readLocationPrefix = async (
    rootDirectory: FileSystemDirectoryHandle
  ): Promise<string | null> => {

    try {
      const handle =
        await rootDirectory.getFileHandle(
          LayerRestorationService.LOCATION_FILE
        )
      const file = await handle.getFile()
      const text = (await file.text()).trim()
      if (!text) return null

      if (/^https?:\/\//i.test(text)) {
        return text.replace(/\/+$/, '')
      }

      if (!this.isSignature(text)) {
        throw new Error('__location__ must be url or 64-hex signature')
      }

      return `${LayerRestorationService.DEFAULT_ORIGIN}/${text}`
    } catch {
      return null
    }
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

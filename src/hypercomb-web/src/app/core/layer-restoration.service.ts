// src/app/core/layer-restoration.service.ts

import { Injectable, inject } from '@angular/core'
import { DirectoryWalkerService } from './directory-walker.service'
import { LayerFilesystemApplier } from './layer-filesystem-applier.service'
import { LayerGraphResolver, LayerRecord } from './layer-graph-resolver.service'
import { DronePayloadResolver } from './drone-payload-resolver.service'

@Injectable({ providedIn: 'root' })
export class LayerRestorationService {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly walker = inject(DirectoryWalkerService)
  private readonly graph = inject(LayerGraphResolver)
  private readonly fs = inject(LayerFilesystemApplier)
  private readonly drones = inject(DronePayloadResolver)

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly LOCATION_FILE = '__location__'
  private static readonly LAYERS_DIRECTORY = '__layers__'
  private static readonly RESOURCES_DIRECTORY = '__resources__'
  private static readonly INSTALL_PREFIX = 'install-'

  // -------------------------------------------------
  // phase 1: structural restore
  // -------------------------------------------------

  public load = async (
    domainsRoot: FileSystemDirectoryHandle,
    depth: number): Promise<void> => {

    for await (const [name, entry] of domainsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (this.isDomainSkippable(name)) continue

      await this.loadDomain(entry as FileSystemDirectoryHandle, depth)
    }
  }

  private loadDomain = async (
    domainDir: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {

    const location = await this.readLocationPrefix(domainDir)
    if (!location) return

    const layersDir =
      await domainDir.getDirectoryHandle(
        LayerRestorationService.LAYERS_DIRECTORY,
        { create: true }
      )

    await this.loadRecursive(
      layersDir,
      `${location}/${LayerRestorationService.LAYERS_DIRECTORY}`,
      domainDir,
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

    // apply install markers in this directory
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

    // descend only into user seed folders
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

    const layer =
      await this.graph.resolve(layersDir, layersLocation, seedSignature)
    if (!layer) return

    await this.fs.applyLayer(
      parentDir,
      layer,
      async (sig: string): Promise<LayerRecord | null> =>
        this.graph.resolve(layersDir, layersLocation, sig)
    )

    await this.fs.finalizeInstall(parentDir, seedSignature)
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

      await this.restoreDomain(entry as FileSystemDirectoryHandle, depth)
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

      await this.drones.ensure(name)
    }
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

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

      return `https://storagehypercomb.blob.core.windows.net/content/${text}`
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

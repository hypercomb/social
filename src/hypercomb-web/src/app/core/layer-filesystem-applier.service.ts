// src/app/core/layer-filesystem-applier.service.ts

import { Injectable } from '@angular/core'
import { LayerRecord } from './layer-graph-resolver.service'

@Injectable({ providedIn: 'root' })
export class LayerFilesystemApplier {

  private static readonly INSTALL_PREFIX = 'install-'

  public applyLayer = async (
    parentDir: FileSystemDirectoryHandle,
    layer: LayerRecord,
    childResolver: (sig: string) => Promise<LayerRecord | null>
  ): Promise<void> => {

    for (const childSig of layer.children) {
      const childLayer = await childResolver(childSig)
      if (!childLayer) continue

      const seedDir =
        await parentDir.getDirectoryHandle(childLayer.name, { create: true })

      await seedDir.getFileHandle(
        `${LayerFilesystemApplier.INSTALL_PREFIX}${childSig}`,
        { create: true }
      )
    }

    for (const droneSig of layer.drones) {
      await parentDir.getFileHandle(droneSig, { create: true })
    }
  }

  public finalizeInstall = async (
    parentDir: FileSystemDirectoryHandle,
    seedSignature: string
  ): Promise<void> => {

    parentDir.removeEntry(
      `${LayerFilesystemApplier.INSTALL_PREFIX}${seedSignature}`
    ).catch(() => {})
  }
}

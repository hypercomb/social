// hypercomb-web/src/app/core/layer-filesystem-applier.service.ts

import { Injectable } from '@angular/core'
import { LayerRecord } from './layer-graph-resolver.service'

@Injectable({ providedIn: 'root' })
export class LayerFilesystemApplier {

  private static readonly INSTALL_SUFFIX = '-install'
  private static readonly INSTALLED_SUFFIX = '-installed'

  public applyLayer = async (
    targetDir: FileSystemDirectoryHandle,
    installDir: FileSystemDirectoryHandle,
    layer: LayerRecord,
    childResolver: (sig: string) => Promise<LayerRecord | null>
  ): Promise<string[]> => {

    const droneSigs: string[] = []

    // child layers
    // - create the child folder in the target tree
    // - mirror the folder in the install tree
    // - drop <childSig>-install inside the mirrored install folder
    for (const childSig of layer.children) {
      const childLayer = await childResolver(childSig)
      if (!childLayer) continue

      await targetDir.getDirectoryHandle(childLayer.name, { create: true })

      const childInstallDir =
        await installDir.getDirectoryHandle(childLayer.name, { create: true })

      await childInstallDir.getFileHandle(
        `${childSig}${LayerFilesystemApplier.INSTALL_SUFFIX}`,
        { create: true }
      )
    }

    // drones/resources
    // - optional reference marker in the target dir (keeps existing behavior)
    // - installer hydrates bytes into opfs/__resources__/sig
    for (const droneSig of layer.drones) {
      await targetDir.getFileHandle(droneSig, { create: true })
      droneSigs.push(droneSig)
    }

    return droneSigs
  }

  public finalizeInstall = async (
    installDir: FileSystemDirectoryHandle,
    signature: string
  ): Promise<void> => {

    // installed marker is the truth
    await installDir.getFileHandle(
      `${signature}${LayerFilesystemApplier.INSTALLED_SUFFIX}`,
      { create: true }
    )

    // clean up pending marker (best effort)
    await installDir.removeEntry(
      `${signature}${LayerFilesystemApplier.INSTALL_SUFFIX}`
    ).catch(() => { })
  }
}

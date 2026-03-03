// hypercomb-web/src/app/core/layer-install-sources/opfs-install-file.source.ts

import { LayerInstallContext, LayerInstallFile,   LayerInstallSource } from '../layer-install.types'

export class OpfsInstallFileSource implements LayerInstallSource {

  public readonly id = 'opfs-install-file'

  public canResolve = async (ctx: LayerInstallContext): Promise<boolean> => {
    const name = `${ctx.signature}-install`
    return await this.fileExists(ctx.domainLayersDir, name)
  }

  public resolve = async (ctx: LayerInstallContext): Promise<LayerInstallFile | null> => {
    const name = `${ctx.signature}-install`

    try {
      const handle = await ctx.domainLayersDir.getFileHandle(name)
      const file = await handle.getFile()
      const text = (await file.text()).trim()
      if (!text) return null

      const parsed = JSON.parse(text) as any
      if (!parsed || typeof parsed !== 'object') return null

      const signature = String(parsed.signature ?? '').trim().toLowerCase()
      if (signature !== ctx.signature) return null

      const drones =
        Array.isArray(parsed.drones)
          ? parsed.drones.map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter((x: string) => x.length)
          : []

      const children =
        Array.isArray(parsed.children)
          ? parsed.children.map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter((x: string) => x.length)
          : []

      const layerName = String(parsed.name ?? '').trim()

      // only treat this as a resolved manifest if it actually carries useful data
      if (!drones.length && !children.length && !layerName) return null

      return {
        signature,
        name: layerName || undefined,
        drones,
        children
      }
    } catch {
      return null
    }
  }

  private fileExists = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
    try {
      await dir.getFileHandle(name, { create: false })
      return true
    } catch {
      return false
    }
  }
}

register('@hypercomb.social/OpfsInstallFileSource', new OpfsInstallFileSource())
// hypercomb-web/src/app/core/layer-install-collection.service.ts

import { DevLayerSource } from './layer-install-sources/dev-layer.source'
import { DomainLayerSource } from './layer-install-sources/domain-layer.source'
import { OpfsInstallFileSource } from './layer-install-sources/opfs-install-file.source'
import { LayerInstallContext, LayerInstallFile, LayerInstallSource } from './layer-install.types'
import { environment } from '../environments/environment'

export class LayerInstallCollection {

  private get opfs(): OpfsInstallFileSource { return <OpfsInstallFileSource>get("OpfsInstallFileSource") }
  private get dev(): DevLayerSource { return <DevLayerSource>get("DevLayerSource") }
  private get domain(): DomainLayerSource { return <DomainLayerSource>get("DomainLayerSource") }

  private readonly ordered = (ctx: LayerInstallContext): readonly LayerInstallSource[] => {
    // debug mode: prefer live sources first so cache can’t “win”
    if (environment.production) return [this.dev, this.domain, this.opfs]

    // installed mode: prefer opfs cache first
    return [this.opfs, this.dev, this.domain]
  }

  public resolve = async (ctx: LayerInstallContext): Promise<LayerInstallFile | null> => {
    for (const source of this.ordered(ctx)) {
      const ok = await Promise.resolve(source.canResolve(ctx))
      if (!ok) continue

      const manifest = await source.resolve(ctx)
      if (!manifest) continue

      return manifest
    }

    return null
  }
}

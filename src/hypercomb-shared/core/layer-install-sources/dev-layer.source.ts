// hypercomb-web/src/app/core/layer-install-sources/dev-layer.source.ts

import { environment } from '../../environments/environment'
import { LayerInstallContext, LayerInstallFile, LayerInstallSource } from '../layer-install.types'

export class DevLayerSource implements LayerInstallSource {

  public readonly id = 'dev-layer'

  public canResolve = (): boolean => !environment.production

  public resolve = async (ctx: LayerInstallContext): Promise<LayerInstallFile | null> => {
    // dev convention: /dev/<domain>/__layers__/<sig>[.json]
    const a = `/dev/${ctx.domain}/__layers__/${ctx.signature}`
    const b = `/dev/${ctx.domain}/__layers__/${ctx.signature}.json`

    const manifest = await this.tryFetchLayer(a, ctx.signature) ?? await this.tryFetchLayer(b, ctx.signature)
    if (!manifest) return null

    return manifest
  }

  private tryFetchLayer = async (url: string, signature: string): Promise<LayerInstallFile | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null

      const parsed = (await res.json()) as any
      return this.coerce(parsed, signature)
    } catch {
      return null
    }
  }

  private coerce = (parsed: any, fallbackSig: string): LayerInstallFile | null => {
    if (!parsed || typeof parsed !== 'object') return null

    const signature =
      String(parsed.signature ?? fallbackSig ?? '')
        .trim()
        .toLowerCase()

    if (!/^[a-f0-9]{64}$/i.test(signature)) return null

    const drones =
      Array.isArray(parsed.drones)
        ? parsed.drones.map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter((x: string) => /^[a-f0-9]{64}$/i.test(x))
        : []

    const children =
      Array.isArray(parsed.children)
        ? parsed.children.map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter((x: string) => /^[a-f0-9]{64}$/i.test(x))
        : []

    const name = String(parsed.name ?? '').trim()

    return { signature, name: name || undefined, drones, children }
  }
}

register('@hypercomb.social/DevLayerSource', new DevLayerSource(), 'DevLayerSource')
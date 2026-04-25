// hypercomb-web/src/app/core/layer-install-sources/domain-layer.source.ts

import { LayerInstallContext, LayerInstallFile, LayerInstallSource } from '../layer-install.types'

export class DomainLayerSource implements LayerInstallSource {

  public readonly id = 'domain-layer'

  public canResolve = (ctx: LayerInstallContext): boolean => !!(ctx.location && ctx.location.trim().length)

  public resolve = async (ctx: LayerInstallContext): Promise<LayerInstallFile | null> => {
    const base = (ctx.location ?? '').replace(/\/+$/, '')
    if (!base) return null

    // domain convention: <location>/__layers__/<sig>[.json]
    const a = `${base}/__layers__/${ctx.signature}`
    const b = `${base}/__layers__/${ctx.signature}.json`

    const manifest = await this.tryFetchLayer(a, ctx.signature) ?? await this.tryFetchLayer(b, ctx.signature)
    if (!manifest) return null

    return manifest
  }

  private tryFetchLayer = async (url: string, signature: string): Promise<LayerInstallFile | null> => {
    try {
      const res = await fetch(url)
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

    const bees =
      Array.isArray(parsed.bees)
        ? parsed.bees.map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter((x: string) => /^[a-f0-9]{64}$/i.test(x))
        : []

    // Child layer sigs live under `cells`. Universal rule: a 64-hex
    // string in this slot would be a sig pointer to a JSON array
    // resource (forward-compat — TODO resolve when first used).
    // Legacy `layers`/`children` accepted during the transition.
    const rawChildren =
      Array.isArray(parsed.cells) ? parsed.cells
      : Array.isArray(parsed.layers) ? parsed.layers
      : Array.isArray(parsed.children) ? parsed.children
      : []
    const children = rawChildren
      .map((x: unknown) => String(x ?? '').trim().toLowerCase())
      .filter((x: string) => /^[a-f0-9]{64}$/i.test(x))

    const name = String(parsed.name ?? '').trim()

    return { signature, name: name || undefined, bees, children }
  }
}

register('@hypercomb.social/DomainLayerSource', new DomainLayerSource())
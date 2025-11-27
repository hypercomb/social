// src/app/hive/rendering/texture-cache-provider.ts
// (as you already have it)
import { Injectable, inject } from "@angular/core"
import { Assets, Texture } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { ITextureProvider } from "./i-texture-provider"

@Injectable({ providedIn: "root" })
export class TextureCacheProvider implements ITextureProvider {
  public get name(): string { return TextureCacheProvider.name }

  private readonly hs = inject(HypercombState)

  public enabled = (cell: Cell): boolean => {
    const texture = Assets.cache.has(this.hs.cacheId(cell))
    return !!texture
  }

  public getTexture = async (cell: Cell): Promise<Texture | undefined> => {
    return await Assets.get(this.hs.cacheId(cell))
  }
}

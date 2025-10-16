// texture manager: central cache for composed textures

import { Injectable } from "@angular/core"
import { Texture, Assets, Sprite } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { blobUrlForSprite } from "src/app/models/cell-filters"
import { assetCacheKey } from "./assest-cache-filters"

@Injectable({ providedIn: 'root' })
export class TextureManager {
    // -----------------------------------------------------------
    // return a cached texture if available
    // - looks up texture in Assets.cache using a stable key
    // - avoids unnecessary rebuilds
    // -----------------------------------------------------------
    public get = (cell: Cell): Texture | undefined => {
        const cacheKeyStr = assetCacheKey(cell)
        return (Assets.cache as any).get(cacheKeyStr)
    }

    // -----------------------------------------------------------
    // build a texture from a blob and add it to cache
    // - ensures a blob url is created only once
    // - ties revocation of the url to sprite.destroy()
    // - saves result into Assets.cache with a stable key
    // -----------------------------------------------------------
    public build = (cell: Cell): Texture => {
        if (!cell.blob) throw new Error('no blob on tile data')

        const url = blobUrlForSprite(cell, new Sprite())
        if (!url) throw new Error('Failed to create blob URL for sprite')
        const sprite = new Sprite(Texture.from(url))
        const texture = sprite.texture

        // Use shared cache key helper from cache-filters
        const cacheKeyStr = assetCacheKey(cell)
            ; (Assets.cache as any).set(cacheKeyStr, texture)

        return texture
    }

    // -----------------------------------------------------------
    // invalidate textures for a tile (all variants)
    // - removes all cache entries for the tile’s id prefix
    // - allows a rebuild when tile blob/flags change
    // -----------------------------------------------------------
    public invalidate = (cell: Cell) => {
        const id = cell.cellId ?? ((cell as any).id ?? 'unknown')
        if (!id) return

        for (const cacheEntry of (Assets.cache as any).keys()) {
            if (cacheEntry.startsWith(String(id) + '|')) {
                (Assets.cache as any).delete(cacheEntry)
            }
        }
    }
}

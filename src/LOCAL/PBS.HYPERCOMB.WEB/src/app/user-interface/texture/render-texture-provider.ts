import { Injectable, inject } from "@angular/core"
import { Texture, RenderTexture, Assets } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { Cell } from "src/app/cells/cell"
import { TileLayerManager } from "src/app/cells/miscellaneous/tile-layer-manager"
import { blobUrl, cacheId } from "src/app/cells/models/cell-filters"
import { ITextureProvider } from "./i-texture-provider"
@Injectable({
    providedIn: 'root'
})
export class RenderTextureProvider extends PixiDataServiceBase implements ITextureProvider {

    public get name(): string { return RenderTextureProvider.name }
    protected readonly manager = inject(TileLayerManager)

    public available(cell: Cell): boolean {
        return !!blobUrl(cell)
    }

    public async getTexture(cell: Cell): Promise<Texture | RenderTexture | undefined> {
        // if(!environment.production) console.log(`loading from ${RenderTextureProvider.name} selected: ${cell.isSelected}`)
        this.debug.log('render', `RenderTextureProvider: loading texture for tile: ${cell.name} (${cacheId(cell)})`)

        try {
            const texture = await this.manager.buildNew(cell)

            if (!!Assets.cache && Assets.cache?.has(cacheId(cell)) == false) {
                // console.log(`Texture already cached for ${cacheId(cell)}`)
                const identifier = cacheId(cell)
                Assets.cache.set(identifier, texture)
            }

            return texture
        } catch (error) {
            console.error('Failed to load all textures:', error)
            throw error
        }
    }
}



import { Injectable, inject } from "@angular/core"
import { Texture, RenderTexture, Assets } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { Cell } from "src/app/cells/cell"
import { TileLayerManager } from "src/app/cells/miscellaneous/tile-layer-manager"
import { HypercombState } from 'src/app/state/core/hypercomb-state'
import { ITextureProvider } from "./i-texture-provider"
@Injectable({
    providedIn: 'root'
})
export class RenderTextureProvider extends PixiDataServiceBase implements ITextureProvider {

    public get name(): string { return RenderTextureProvider.name }
    protected readonly manager = inject(TileLayerManager)
    private readonly hs = inject(HypercombState)

    public enabled(cell: Cell): boolean {
        return !!cell
    }

    public async getTexture(cell: Cell): Promise<Texture | RenderTexture | undefined> {
        // if(!environment.production) console.log(`loading from ${RenderTextureProvider.name} selected: ${cell.isSelected}`)
        this.debug.log('render', `RenderTextureProvider: loading texture for tile: ${cell.name} (${this.hs.cacheId(cell)})`)

        try {
            const texture = await this.manager.buildNew(cell)

            if (!!Assets.cache && Assets.cache?.has(this.hs.cacheId(cell)) == false) {
                // console.log(`Texture already cached for ${cacheId(cell)}`)
                const identifier = this.hs.cacheId(cell)
                Assets.cache.set(identifier, texture)
            }

            return texture
        } catch (error) {
            console.error('Failed to load all textures:', error)
            throw error
        }
    }
}



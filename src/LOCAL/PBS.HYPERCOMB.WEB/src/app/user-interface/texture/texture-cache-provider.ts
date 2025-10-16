import { Injectable } from "@angular/core"
import { Assets, Texture } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { cacheId } from "../../cells/models/cell-filters"
import { ITextureProvider } from "./i-texture-provider"


@Injectable({
    providedIn: 'root'
})
export class TextureCacheProvider implements ITextureProvider {
    public get name(): string { return TextureCacheProvider.name }

    public available = (cell: Cell): boolean => {
        const texture = Assets.cache.has(cacheId(cell))
        return !!texture
    }

    public getTexture = async (cell: Cell): Promise<Texture | undefined> => {
        // if(!environment.production) console.log(`loading from ${TextureCacheProvider.name}`)
        return await Assets.get(cacheId(cell))
    }
}



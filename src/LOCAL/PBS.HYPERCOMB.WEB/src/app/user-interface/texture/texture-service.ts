import { Injectable } from '@angular/core'
import { Texture } from 'pixi.js'
import { EmptyTextureProvider } from './empty-texture-provider'
import { ITextureProvider } from './i-texture-provider'
import { RenderTextureProvider } from './render-texture-provider'
import { SpritesheetProvider } from './spritesheet-texture-provider'
import { TextureCacheProvider } from './texture-cache-provider'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class TextureService {

    private providers: ITextureProvider[]

    constructor(
        emptyTextureProvider: EmptyTextureProvider,
        textureCacheProvider: TextureCacheProvider,
        renderTextureProvider: RenderTextureProvider,
        spritesheetProvider: SpritesheetProvider
    ) {
        this.providers = <ITextureProvider[]>[emptyTextureProvider, textureCacheProvider, renderTextureProvider]
    }

    public async getTexture(cell: Cell): Promise<Texture | undefined> {

        for (const provider of this.providers) {
            if (await provider.available(cell)) {
                const texture = await provider.getTexture(cell)
                if (texture) {
                    return texture
                }
            }
        }
        return undefined
    }
}



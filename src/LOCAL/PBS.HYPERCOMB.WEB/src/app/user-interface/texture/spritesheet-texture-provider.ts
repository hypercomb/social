import { Injectable } from '@angular/core'
import { Texture } from 'pixi.js'
import { ITextureProvider } from './i-texture-provider'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class SpritesheetProvider implements ITextureProvider {
    public get name(): string { return SpritesheetProvider.name }

    public available = (cell: Cell): boolean => {
        //   return Boolean(blob~UrlForSprite(cell),  && cell.hive)
        return false
    }

    async getTexture(cell: Cell): Promise<Texture | undefined> {
        // const { tile, info } = options
        // const { spritesheetBlob } = info
        // const { data } = tile

        // if (!spritesheetBlob) return undefined

        // const textureSource = await Assets.load(data.hive)

        // if (textureSource) {
        //     // Define texture options
        //     const textureOptions = {
        //         source: textureSource.baseTexture, // Use baseTexture as the source
        //         frame: new Rectangle(
        //             Number(data.SpriteX),
        //             Number(data.SpriteY),
        //             Number(info.width),
        //             Number(info.height)
        //         ),
        //         label: data.hive, // Optional: label for easier debugging
        //         defaultAnchor: new Point(0.5, 0.5), // Center anchor
        //         rotate: 0, // No rotation
        //         dynamic: false // Static texture
        //     }

        //     return new Texture(textureOptions)
        // }
        return undefined
    }
}



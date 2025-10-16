import { RenderTexture, Texture } from "pixi.js"
import { Cell } from "src/app/cells/cell"

export interface ITextureProvider {
    name: string
    available(cell: Cell): boolean
    getTexture(cell: Cell): Promise<Texture | RenderTexture | undefined>
}



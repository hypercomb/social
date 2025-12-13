import { RenderTexture, Texture } from "pixi.js"
import { Cell } from "src/app/models/cell"

export interface ITextureProvider {
    name: string
    enabled(cell: Cell): boolean
    getTexture(cell: Cell): Promise<Texture | RenderTexture | undefined>
}



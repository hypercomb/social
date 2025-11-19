import { Injectable } from "@angular/core"
import { RenderTexture, Texture } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { ITextureProvider } from "./i-texture-provider"
import { RenderTextureProvider } from "./render-texture-provider"

@Injectable({ providedIn: 'root' })
export class EmptyTextureProvider extends RenderTextureProvider implements ITextureProvider {


    public override get name(): string { return EmptyTextureProvider.name }

    public override available = (cell: Cell): boolean => {
        return !cell.sourcePath // && !cell.blob maybe we need to load from opfs? 
    }

    public override getTexture = async (cell: Cell): Promise<Texture | RenderTexture | undefined> => {

        const texture = await super.getTexture(cell)
        return texture
    }
}


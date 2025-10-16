import { inject, Injectable } from '@angular/core'
import { Container, Graphics, RenderOptions, RenderTexture, Sprite, Texture, WebGLRenderer, autoDetectRenderer } from 'pixi.js'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { PixiServiceBase } from 'src/app/pixi/pixi-service-base'
import { isSelected, noImage } from '../models/cell-filters'
import { BackgroundGraphic } from 'src/app/user-interface/sprite-components/background-graphic-sprite'
import { BorderColorSprite } from 'src/app/user-interface/sprite-components/border-color-sprite'
import { BranchOverlaySprite } from 'src/app/user-interface/sprite-components/branch-overlay-sprite'
import { HighDefinitionTextService } from 'src/app/user-interface/sprite-components/high-definition-text-service.base'
import { ImageSprite } from 'src/app/user-interface/sprite-components/image-sprite'
import { SelectedTileSprite } from 'src/app/user-interface/sprite-components/selected-tile-sprite'
import { Cell } from '../cell'

@Injectable({
    providedIn: 'root'
})
export class TileLayerManager extends PixiServiceBase {

    // inject dependencies directly as fields
    private readonly background = inject(BackgroundGraphic)
    private readonly border = inject(BorderColorSprite)
    private readonly branch = inject(BranchOverlaySprite)
    private readonly text = inject(HighDefinitionTextService)
    private readonly selected = inject(SelectedTileSprite)
    private readonly image = inject(ImageSprite)

    public buildNew = async (cell: Cell): Promise<Texture | undefined> => {

        try {
            // Resolve the imageSprite: use the provided one or fetch from the ImageSprite service
            const sprite = await this.image.build(cell)


            // generate a texture from the container
            // Fetch all layers using the resolved image sprite
            const layers = await this.getLayers(cell, sprite)

            // Collapse layers into a texture
            const rendered = await this.onAllTexturesLoaded(layers)
            return rendered
        } catch (error) {
            console.error('Failed to load and render textures:', error)
            throw error
        }
    }

    public getBorderVisual = async (cell: Cell): Promise<Sprite> => {
        return this.border.build(cell)
    }
    public getBranchVisual = async (cell: Cell): Promise<Sprite> => {
        return  cell.isBranch ? this.branch.build() : <any>Promise.resolve(undefined)
    }

    public getBackgroundVisual = async (cell: Cell): Promise<Graphics> => {
        return this.background.build(cell)
    }

    public getLayers = async (cell: Cell, imageSprite?: Sprite): Promise<(Sprite | Graphics)[]> => {

        // console.log(`getting layers for: ${cell.name} -> ${tileDatasourcePath}`)

        try {
            // Load all required textures asynchronously

            const focusedMode = this.state.hasMode(HypercombMode.Focused) || (!!cell.name && !cell.blob)
            const hasNoImage = noImage(cell)
            imageSprite = (focusedMode || hasNoImage) ? undefined : imageSprite

            const backgroundGraphics = this.getBackgroundVisual(cell) // Background texture
            const branchSprite = this.getBranchVisual(cell) // Branch state texture
            const borderOverlaySprite = this.getBorderVisual(cell) // Border color texture
            const selectedTileSprite = isSelected(cell) ? this.selected.build(cell) : undefined

            const textContainer = (focusedMode || hasNoImage)
                ? this.text.add(cell.name)
                : undefined

            // Wait for all textures to load and filter out undefined layers
            const layers = await Promise.all([
                imageSprite,
                backgroundGraphics,
                branchSprite,
                textContainer,
                borderOverlaySprite,
                selectedTileSprite
            ])

            return <any>layers.filter((layer): layer is Sprite => !!layer)
        }
        catch (error) {
            this.debug.log('error', error)
        }
        return []
    }

    // inside TileLayerManager
    private async getRenderer(): Promise<WebGLRenderer> {
        await this.pixi.whenReady()
        return this.pixi.renderer
    }


    private onAllTexturesLoaded = async (layers: (Sprite | Graphics)[]): Promise<Texture> => {
        const { width, height } = this.settings.hexagonDimensions;

        const container = new Container();
        for (const l of layers) container.addChild(l);

        const renderer = await this.getRenderer();

        const rt = RenderTexture.create({ width, height });

        // v8 single-object signature
        renderer.render({
            container, target: rt,
            clear: true
        });

        container.destroy({ children: false })
        return rt
    }

}

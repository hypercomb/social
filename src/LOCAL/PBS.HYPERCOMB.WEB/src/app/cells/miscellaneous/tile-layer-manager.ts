import { inject, Injectable } from '@angular/core'
import { Container, Graphics, RenderTexture, Sprite, Texture, WebGLRenderer } from 'pixi.js'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { PixiServiceBase } from 'src/app/pixi/pixi-service-base'
import { isSelected } from '../models/cell-filters'
import { BackgroundGraphic } from 'src/app/user-interface/sprite-components/background-graphic-sprite'
import { BorderColorSprite } from 'src/app/user-interface/sprite-components/border-color-sprite'
import { BranchOverlaySprite } from 'src/app/user-interface/sprite-components/branch-overlay-sprite'
import { HighDefinitionTextService } from 'src/app/user-interface/sprite-components/high-definition-text-service.base'
import { ImageSprite } from 'src/app/user-interface/sprite-components/image-sprite'
import { SelectedTileSprite } from 'src/app/user-interface/sprite-components/selected-tile-sprite'
import { Cell } from '../cell'

@Injectable({ providedIn: 'root' })
export class TileLayerManager extends PixiServiceBase {

  private readonly background = inject(BackgroundGraphic)
  private readonly border = inject(BorderColorSprite)
  private readonly branch = inject(BranchOverlaySprite)
  private readonly text = inject(HighDefinitionTextService)
  private readonly selected = inject(SelectedTileSprite)
  private readonly image = inject(ImageSprite)

  public buildNew = async (cell: Cell): Promise<Texture | undefined> => {
    try {
      const imageSprite = await this.image.build(cell)

      const layers = await this.getLayers(cell, imageSprite)

      if (!layers.length) {
        this.debug.log('tiles', `no layers produced for ${cell.name} (id=${cell.cellId})`)
      }

      return await this.onAllTexturesLoaded(layers)
    }
    catch (err) {
      this.debug.error('tiles', 'buildNew failed', err)
      return undefined
    }
  }

  public getBorderVisual = async (cell: Cell): Promise<Sprite> =>
    this.border.build(cell)

  public getBranchVisual = async (cell: Cell): Promise<Sprite | undefined> =>
    cell.isBranch ? this.branch.build() : undefined

  public getBackgroundVisual = async (cell: Cell): Promise<Graphics> =>
    this.background.build(cell)

  public getLayers = async (
    cell: Cell,
    imageSprite?: Sprite
  ): Promise<(Sprite | Graphics)[]> => {
    try {
      const focused = this.state.hasMode(HypercombMode.Focused)

      // removed `.valid` to satisfy TS typings
      const imageValid =
        !!imageSprite &&
        !!imageSprite.texture

      this.debug.log(
        'tiles',
        `getLayers: cell=${cell.name} id=${cell.cellId} focused=${focused} imageValid=${imageValid}`
      )

      const bg = this.getBackgroundVisual(cell)
      const branch = this.getBranchVisual(cell)
      const border = this.getBorderVisual(cell)
      const selectedSprite = isSelected(cell) ? this.selected.build(cell) : undefined

      const textSprite =
        focused || !imageValid
          ? this.text.add(cell.name)
          : undefined

      const layers = await Promise.all([
        imageValid ? imageSprite : undefined,
        bg,
        branch,
        textSprite,
        border,
        selectedSprite
      ])

      return layers.filter(l => !!l) as (Sprite | Graphics)[]
    }
    catch (err) {
      this.debug.error('tiles', 'getLayers failed', err)
      return []
    }
  }

  private async getRenderer(): Promise<WebGLRenderer> {
    await this.pixi.whenReady()
    return this.pixi.renderer
  }

  private onAllTexturesLoaded = async (
    layers: (Sprite | Graphics)[]
  ): Promise<Texture> => {

    const { width, height } = this.settings.hexagonDimensions
    const container = new Container()

    for (const l of layers) container.addChild(l)

    const renderer = await this.getRenderer()
    const rt = RenderTexture.create({ width, height })

    renderer.render({
      container,
      target: rt,
      clear: true
    })

    container.destroy({ children: false })
    return rt
  }

}

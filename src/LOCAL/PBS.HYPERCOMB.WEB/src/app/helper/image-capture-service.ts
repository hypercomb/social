import { Injectable } from "@angular/core"
import { Container, RenderTexture, RenderOptions } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { BorderColorSprite } from "src/app/user-interface/sprite-components/border-color-sprite"

@Injectable({
  providedIn: 'root'
})
export class ImageCaptureService extends PixiDataServiceBase {
  
  private _container!: Container;

  protected get container(): Container {
    return this._container;
  }

  protected set container(value: Container) {
    this._container = value;
  }

  public setContainer(container: Container) {
    this.container = container
  }

  public capture = async () => {
    const tile = this.container

    if (!tile) {
      throw new Error('No tile container set for image capture.')
    }

    this.debug.log('tiles', 'ImageCaptureService.capture called with tile:', tile)

    const { mask } = tile
    tile.visible 
    tile.mask = null

    const { width, height } = this.settings.hexagonDimensions

    // remove border by looking up border layer
    const index = tile.children.findIndex(
      (child: Container) => child.label === BorderColorSprite.name
    )!

    try {
      if (index < 0) {
        throw new Error('No border sprite found to remove.')
      }
      this.debug.log('tiles', `Removing border sprite at index: ${index}`)
      tile.removeChildAt(index)
    } catch (error) {
      console.error('Error removing border sprite:', error)
    }

    // Create a render texture for the cropped region with specified dimensions and scale mode
    const renderTexture = RenderTexture.create({
      width: width,
      height: height,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false
    })

    const options = <RenderOptions>{
      container: tile,
      target: renderTexture
    }

    // Render the tile onto the render texture
    const renderer = this.pixi.app!.renderer
    renderer.render(options)

    // Use renderer.extract to get a canvas and convert it to a Blob
    const canvas = renderer.extract.canvas(renderTexture) as HTMLCanvasElement
    const blob = await this.captureBlob(canvas)

    tile.mask = mask
    tile.visible = true

    return blob
  }

  private captureBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to create Blob from cropped canvas.'))
        },
        'image/webp'
      )
    })
  }
}



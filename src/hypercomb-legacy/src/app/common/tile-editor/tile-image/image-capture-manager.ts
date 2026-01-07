// src/app/common/tile-editor/tile-image/image-capture-manager.ts
import { Injectable } from "@angular/core"
import { Container, RenderTexture, RenderOptions } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { BorderColorSprite } from "src/app/user-interface/sprite-components/border-color-sprite"

@Injectable({ providedIn: 'root' })
export class ImageCaptureManager extends PixiDataServiceBase {

  private _container!: Container;

  protected get container(): Container {
    return this._container;
  }

  public setContainer(container: Container) {
    this._container = container;
  }

  // ─────────────────────────────────────────────
  // 1) CAPTURE PREVIEW (small image with layers)
  // ─────────────────────────────────────────────
  public capturePreview = async (): Promise<Blob> => {
    const tile = this.container;
    if (!tile) throw new Error('No tile container set for preview.');

    const { mask } = tile;
    tile.mask = null;

    const borderIndex = tile.children.findIndex(
      (c: any) => c.label === BorderColorSprite.name
    );

    if (borderIndex >= 0) {
      tile.removeChildAt(borderIndex);
    }

    const { width, height } = this.settings.hexagonDimensions;

    const renderTexture = RenderTexture.create({
      width,
      height,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false,
    });

    const renderer = this.pixi.app!.renderer;
    renderer.render(<RenderOptions>{ container: tile, target: renderTexture });

    const canvas = renderer.extract.canvas(renderTexture) as HTMLCanvasElement;
    const blob = await this.canvasToBlob(canvas);

    tile.mask = mask;
    return blob;
  };

  // ─────────────────────────────────────────────
  // 2) CAPTURE ONLY THE IMAGE (NO LAYERS)
  // ─────────────────────────────────────────────
  public captureImageOnly = async (): Promise<Blob> => {
    const tile = this.container;
    if (!tile) throw new Error("No container set for captureImageOnly");

    // The positioned sprite is ALWAYS child[0] in TileImageComponent layers
    const base = tile.children[0];
    if (!base) throw new Error("No base image sprite found for capture");

    const spriteBounds = base.getBounds();
    const w = Math.ceil(spriteBounds.width);
    const h = Math.ceil(spriteBounds.height);

    const rtex = RenderTexture.create({
      width: w,
      height: h,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false,
    });

    const renderer = this.pixi.app!.renderer;
    renderer.render(<RenderOptions>{ container: base, target: rtex });

    const canvas = renderer.extract.canvas(rtex) as HTMLCanvasElement;
    return await this.canvasToBlob(canvas);
  };

  private canvasToBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject("Failed blob"),
        "image/webp"
      )
    );
}

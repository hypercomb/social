// src/app/user-interface/texture/spritesheet-builder.service.ts
import { Injectable, inject } from "@angular/core"
import { Assets, Container, RenderTexture, Sprite, Texture } from "pixi.js"
import { TileLayerManager } from "src/app/cells/miscellaneous/tile-layer-manager"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { CachedSpritesheet, SpritesheetRepository } from "./spritesheet.repository"
import { Cell } from "src/app/models/cell"

@Injectable({ providedIn: "root" })
export class SpritesheetBuilderService extends PixiServiceBase {

  private readonly tileLayer = inject(TileLayerManager)
  private readonly repo = inject(SpritesheetRepository)

  // entry ---------------------------------------------------
  public buildForLayer = async (cells: Cell[], layerHash: string): Promise<CachedSpritesheet[]> => {
    // unchanged logic aside from typing results to avoid never[]
    const groups: Cell[][] = []
    for (let i = 0; i < cells.length; i += 25) groups.push(cells.slice(i, i + 25))

    const results: CachedSpritesheet[] = []

    for (let index = 0; index < groups.length; index++) {
      const group = groups[index]
      const sheetHash = `${layerHash}-${index}`

      const existing = await this.repo.fetch(sheetHash)
      if (existing) {
        results.push(existing)
        continue
      }

      const built = await this.buildOneSheet(group, sheetHash)
      await this.repo.save(built)
      results.push(built)
    }

    return results
  }

  // sheet builder ------------------------------------------
  private buildOneSheet = async (cells: Cell[], sheetHash: string): Promise<CachedSpritesheet> => {
    await this.pixi.whenReady()

    const tileW = Math.ceil(this.settings.hexagonDimensions.width)
    const tileH = Math.ceil(this.settings.hexagonDimensions.height)

    const container = new Container()
    const frames: any = {}

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]

      // pull the rendered texture from cache first
      // this keeps cell as pure data and respects your provider chain
      const cacheId = this.state.cacheId(cell)

      let tex = (Assets.cache?.get(cacheId) as Texture | RenderTexture | undefined)

      // fallback: build via layer manager (uses your stable image sprite + layering)
      if (!tex) {
        tex = await this.tileLayer.buildNew(cell)

        // cache it so future sheets and views reuse the same render result
        if (tex && Assets.cache && !Assets.cache.has(cacheId)) {
          Assets.cache.set(cacheId, tex)
        }
      }

      // if a texture cannot be produced, skip this cell gracefully
      if (!tex) continue

      const sprite = new Sprite(tex)

      const col = i % 5
      const row = Math.floor(i / 5)

      const x = col * tileW
      const y = row * tileH

      sprite.x = x
      sprite.y = y

      frames[cell.seed] = { x, y, w: tileW, h: tileH }

      container.addChild(sprite)
    } 

    const rt = RenderTexture.create({
      width: 2048,
      height: 2048,
      resolution: 1,
      scaleMode: "nearest",
      antialias: false
    })

    this.pixi.renderer.render({ container, target: rt, clear: true })

    const canvas = this.pixi.renderer.extract.canvas(rt) as HTMLCanvasElement
    const blob = await this.canvasToBlob(canvas)

    container.destroy({ children: true })

    return { sheetHash, blob, frames }
  }

  private canvasToBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
    new Promise(resolve => canvas.toBlob(b => resolve(b!), "image/png"))
}

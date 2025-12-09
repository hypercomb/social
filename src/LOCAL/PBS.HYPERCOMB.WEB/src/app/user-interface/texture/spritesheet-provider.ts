// src/app/user-interface/texture/spritesheet-texture-provider.ts
import { Injectable, inject } from "@angular/core"
import { Rectangle, Texture } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { HashingService } from "src/app/hive/storage/hashing-service"
import { ITextureProvider } from "./i-texture-provider"
import { SpritesheetBuilderService } from "./spritesheet-builder.service"
import { CachedSpritesheet, SpritesheetRepository } from "./spritesheet.repository"
import { error } from "console"

type LayerContext = {
  layerId: string
  cells: Cell[]
}

@Injectable({ providedIn: "root" })
export class SpritesheetProvider implements ITextureProvider {

  public get name(): string { return SpritesheetProvider.name }

  private readonly repo = inject(SpritesheetRepository)
  private readonly builder = inject(SpritesheetBuilderService)
  private readonly hashing = inject(HashingService)

  // maps cell id -> layer context
  private readonly ctxByCellId = new Map<string, LayerContext>()

  // base texture cache per sheet to avoid repeated object urls
  private readonly baseBySheetHash = new Map<string, Texture>()

  // prime with current layer context when the layer becomes known/active
  public primeLayer = (cells: Cell[]): void => {
    for (const cell of cells) {
     // this.ctxByCellId.set(String(cell.cellId), { layerId, cells })
      throw Error("not implemented")
    }
  }

  // clear when passivating/evicting a layer
  public clearLayer = (cells: Cell[]): void => {
    for (const cell of cells) this.ctxByCellId.delete(String(cell.cellId))
  }

  public enabled = (cell: Cell): boolean =>
    !!cell && this.ctxByCellId.has(String(cell.cellId))

  public getTexture = async (cell: Cell): Promise<Texture | undefined> => {
    const ctx = this.ctxByCellId.get(String(cell.cellId))
    if (!ctx) return undefined

    const layerHash = await this.getLayerHash(ctx.layerId, ctx.cells)

    // build all sheets if missing
    const sheets = await this.builder.buildForLayer(ctx.cells, layerHash)

    // find sheet containing this cell
    const sheet = this.findSheetContainingCell(sheets, cell)
    if (!sheet) return undefined

    const frame = sheet.frames?.[cell.cellId]
    if (!frame) return undefined

    const base = await this.getBaseTexture(sheet)

    return new Texture({
      source: base.baseTexture.resource,
      frame: new Rectangle(frame.x, frame.y, frame.w, frame.h)
    })
  }

  private getLayerHash = async (layerId: string, cells: Cell[]): Promise<string> => {
    // deterministic signature with no phantom properties
    // adjust the signature fields if you later formalize a cell hash
    const ordered = [...cells].sort((a, b) =>
      String(a.cellId).localeCompare(String(b.cellId))
    )

    const signature = ordered
      .map(c => `${c.cellId}:${c.imageHash ?? ""}:${c.name ?? ""}`)
      .join("|")

    return await this.hashing.sha256Hex(`${layerId}::${signature}`)
  }

  private findSheetContainingCell = (sheets: CachedSpritesheet[], cell: Cell): CachedSpritesheet | undefined =>
    sheets.find(s => !!s.frames?.[cell.cellId])

  private getBaseTexture = async (sheet: CachedSpritesheet): Promise<Texture> => {
    const cached = this.baseBySheetHash.get(sheet.sheetHash)
    if (cached) return cached

    const url = URL.createObjectURL(sheet.blob)
    const base = Texture.from(url)

    this.baseBySheetHash.set(sheet.sheetHash, base)
    return base
  }
}

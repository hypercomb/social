import { Injectable } from "@angular/core"
import { Texture } from "pixi.js"

@Injectable({ providedIn: 'root' })
export class DexieFileLoaderService {
  public async loadHiveFromFile(file: File, currentCombId: number): Promise<Map<number, Texture>> {
    const json = await this.loadDexieJsonFile(file)
    const cells = this.extractHiveCells(json, currentCombId)
    const cellsWithImages = this.linkImages(cells, json)
    return this.preloadTextures(cellsWithImages)
  }

  private async loadDexieJsonFile(file: File): Promise<any> {
    const text = await file.text()
    return JSON.parse(text)
  }

  private extractHiveCells(json: any, combId: number): any[] {
    const rows = json.data?.cells?.rows ?? []
    return rows.filter((r: any) => r.sourceId === combId)
  }

  private linkImages(cells: any[], json: any): any[] {
    const imgs = json.data?.images?.rows ?? []
    const map = new Map(imgs.map((i: any) => [i.cellId, i.blob]))
    return cells.map(c => ({ ...c, blob: map.get(c.cellId) }))
  }

  private async preloadTextures(cells: any[]): Promise<Map<number, Texture>> {
    const map = new Map<number, Texture>()
    for (const c of cells) {
      if (!c.blob) continue
      const url = URL.createObjectURL(c.blob)
      const tex = await Texture.fromURL(url)
      map.set(c.cellId, tex)
    }
    return map
  }
}

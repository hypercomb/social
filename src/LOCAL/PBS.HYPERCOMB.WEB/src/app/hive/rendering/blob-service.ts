import { Injectable } from "@angular/core"
import { Cell, CellKind } from "src/app/cells/cell"
import { isBlobImage } from "src/app/cells/models/cell-filters"
import { Constants, LocalAssets } from "src/app/unsorted/constants"

@Injectable({ providedIn: "root" })
export class BlobService {
  // static caches for placeholders
  private static placeholders: Map<CellKind, Blob> = new Map()
  // a built-in 1x1 transparent PNG

  public static readonly defaultBlob: Blob = (() => {
    // base64 for a transparent 1x1 PNG
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yk0LNsAAAAASUVORK5CYII="
    const byteChars = atob(base64)
    const byteNumbers = new Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    return new Blob([byteArray], { type: "image/png" })
  })()

  constructor() {
    // preload known defaults (ghost, clipboard, hive, etc.)
    this.preload("Ghost", "assets/ghost-tile.png")
    this.preload("Clipboard", "assets/clipboard-tile.png")
    this.preload("Hive", "assets/hive-tile.png")
    this.preload("Cell", "assets/guide-tile.png") // generic cell fallback
  }

  private async preload(kind: CellKind, path: string) {
    try {
      const blob = await this.fetchAsset(path)
      BlobService.placeholders.set(kind, blob)
    } catch (err) {
      console.warn(`⚠️ could not preload placeholder for ${kind}: ${path}`, err)
    }
  }

  public static getPlaceholder(kind?: CellKind): Blob {
    return BlobService.placeholders.get(kind ?? "Cell") ?? BlobService.defaultBlob
  }


  // get the effective blob for a cell (lazy fetch if needed)
  public async getBlob(cell: Cell): Promise<Blob | undefined> {
    if (cell.kind == 'Clipboard' && !isBlobImage(cell) && cell.sourcePath) {
      return this.fetchFromPath(cell.sourcePath)
    }

    if (cell.sourcePath && !cell.image?.blob) {
      return this.fetchFromPath(cell.sourcePath)
    }

    return cell.image?.blob
  }

  // fetch from path (assets, http, relative)
  private async fetchAsset(path: string): Promise<Blob> {
    const response = await fetch(path)
    if (!response.ok) throw new Error(`❌ failed to fetch asset: ${path}`)
    const blob = await response.blob()
    if (!blob.size) throw new Error(`❌ empty blob for ${path}`)
    return new Blob([await blob.arrayBuffer()], { type: "image/png" })
  }

  private async fetchFromPath(sourcePath: string): Promise<Blob | undefined> {
    try {
      const response = await fetch(
        sourcePath.startsWith("http") ? sourcePath : `${Constants.storage}${sourcePath}`
      )
      if (!response.ok) {
        console.warn(`⚠️ fetch failed for ${sourcePath} (${response.status})`)
        return BlobService.defaultBlob
      }
      const blob = await response.blob()
      if (!blob.size) {
        console.warn(`⚠️ empty blob from ${sourcePath}`)
        return BlobService.defaultBlob
      }
      return new Blob([await blob.arrayBuffer()], { type: "image/png" })
    } catch (err) {
      console.error("❌ failed to fetch blob:", sourcePath, err)
      return BlobService.defaultBlob
    }
  }


  public async getInitialBlob(): Promise<Blob> {
    return this.fetchAsset(LocalAssets.NInitialImagePath)
  }


  public async fetchImageAsBlob(url: string): Promise<Blob> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`❌ failed to fetch image: ${url}`)
    return response.blob()
  }

  public trimBlob(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../../workers/image-trim.worker", import.meta.url), {
        type: "module",
      })

      worker.onmessage = e => {
        if (e.data.blob) resolve(e.data.blob)
        else reject(e.data.error || "unknown worker error")
        worker.terminate()
      }

      worker.onerror = err => {
        reject(err.message || "worker error")
        worker.terminate()
      }

      worker.postMessage({ blob })
    })
  }
}

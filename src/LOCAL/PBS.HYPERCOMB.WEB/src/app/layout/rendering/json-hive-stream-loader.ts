import { Injectable, inject, signal, effect } from '@angular/core'
import { Cell } from 'src/app/cells/cell'
import { CarouselService } from 'src/app/common/carousel-menu/carousel-service'
import { IDexieHive } from 'src/app/hive/hive-models'
import { TextureService } from 'src/app/user-interface/texture/texture-service'

@Injectable({ providedIn: 'root' })
export class JsonHiveStreamLoader {
  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  private readonly carousel = inject(CarouselService)
  private readonly textures = inject(TextureService)

  private readonly _loading = signal(false)
  public readonly loading = this._loading.asReadonly()
  private cancel = false

  // base path to static hive JSON files (adjust as needed)
  private readonly hiveBasePath = '/data/hives/'

  constructor() {
    // reactively start new stream when carousel hive changes
    effect(() => {
      const current = this.carousel.current()
      if (!current) return

      // cancel any ongoing stream
      this.stopStreaming()

      // start new stream (non-blocking)
      void this.streamHiveAndNeighbors(current)
    })
  }

  // ─────────────────────────────────────────────
  // control
  // ─────────────────────────────────────────────
  public stopStreaming(): void {
    this.cancel = true
    this._loading.set(false)
  }

  private async streamHiveAndNeighbors(center: IDexieHive): Promise<void> {
    this.cancel = false
    this._loading.set(true)

    try {
      // stream center hive first
      await this.loadHiveFromJson(center)

      // build ordered neighbor list
      const neighbors = this.buildNeighborOrder(center)

      // stream each neighbor sequentially (cancel-aware)
      for (const hive of neighbors) {
        if (this.cancel) break
        await this.loadHiveFromJson(hive)
      }
    } catch (err) {
      console.warn('[JsonHiveStreamLoader] streaming error:', err)
    } finally {
      this._loading.set(false)
    }
  }

  // ─────────────────────────────────────────────
  // neighbor ordering
  // ─────────────────────────────────────────────
  private buildNeighborOrder(center: IDexieHive): IDexieHive[] {
    const items = this.carousel.items?.() ?? []
    const idx = items.findIndex(i => i.name === center.name)
    if (idx === -1) return []

    const order: IDexieHive[] = []
    const max = Math.min(items.length, 5)

    for (let offset = 1; offset < max; offset++) {
      const next = items[idx + offset]
      const prev = items[idx - offset]
      if (next) order.push(next)
      if (prev) order.push(prev)
    }

    return order
  }

  // ─────────────────────────────────────────────
  // core streaming logic
  // ─────────────────────────────────────────────
  private async loadHiveFromJson(hive: IDexieHive): Promise<void> {
    try {
      const filePath = `${this.hiveBasePath}${hive.name}.json`
      const response = await fetch(filePath)
      if (!response.ok) throw new Error(`Failed to fetch ${filePath}`)

      const dbJson = await response.json()

      // detect common Dexie export structures
      const cells: Cell[] =
        dbJson?.cells ??
        dbJson?.data?.find?.((t: any) => t.table === 'cells')?.rows ??
        []

      if (!cells.length) {
        console.log(`[JsonHiveStreamLoader] hive '${hive.name}' has no cells`)
        return
      }

      // stream each cell texture gently, micro-throttled
      for (const cell of cells) {
        if (this.cancel) break
        if (!cell.image) continue
        await this.textures.getTexture(cell)
        await this.microDelay()
      }

      console.log(`🐝 streamed ${cells.length} cells for hive '${hive.name}'`)
    } catch (err) {
      console.warn(`[JsonHiveStreamLoader] failed to load ${hive.name}:`, err)
    }
  }

  // ─────────────────────────────────────────────
  // utilities
  // ─────────────────────────────────────────────
  private microDelay(): Promise<void> {
    // 1–3ms micro-pause avoids main-thread blocking
    return new Promise(r => setTimeout(r, 1 + Math.random() * 2))
  }
}

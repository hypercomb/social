import { Injectable, inject, signal } from "@angular/core"
import { TextureService } from "src/app/user-interface/texture/texture-service"
import { IDexieHive } from "../hive-models"
import { OpfsHiveService } from "../storage/opfs-hive-service"
import { Cell } from "src/app/cells/cell"
import DBTables from "src/app/core/constants/db-tables"
import { ImageService } from "src/app/database/images/image-service"
import { TextureWorkerService } from "src/app/workers/texture-stream-worker.service"
import { Hypercomb, HypercombLayout } from "src/app/core/mixins/abstraction/hypercomb.base"
import { Assets, Texture } from "pixi.js"
import { effect } from "src/app/performance/effect-profiler"

interface CarouselStreamSet {
    current: IDexieHive
    upper: IDexieHive[]
    lower: IDexieHive[]
}

@Injectable({ providedIn: "root" })
export class PassiveTextureStreamer extends HypercombLayout {
    private readonly textureService = inject(TextureService)
    private readonly imagesvc = inject(ImageService)
    private readonly decoder = inject(TextureWorkerService)
    private readonly hives = inject(OpfsHiveService)

    private readonly _isStreaming = signal(false)
    public readonly isStreaming = this._isStreaming.asReadonly()

    private activeHiveName: string | null = null
    private cancel = false

    constructor() {
        super()
        effect(async () => {
            const info = this.decoder.decoderInfo()
            if (!info) return

            const texture = await Texture.from(info.bitmap)
            info.bitmap.close?.()

            // register in Pixi Assets cache for consistent retrieval
            Assets.cache.set(info.cacheId, texture)

            console.debug('[PassiveTextureStreamer] texture ready and cached')
        })
    }

    // ─────────────────────────────────────────────
    // public API
    // ─────────────────────────────────────────────
    public async streamForCarousel({ current, upper, lower }: CarouselStreamSet): Promise<void> {
        if (this._isStreaming() && this.activeHiveName === current.name) return

        this._isStreaming.set(true)
        this.activeHiveName = current.name
        this.cancel = false

        try {
            // 🐝 Interleave neighbors for balanced preloading
            const neighbors = this.interleave(upper, lower)
            for (const hive of neighbors) {
                if (this.cancel) break
                await this.streamHive(hive.name)
            }
        } catch (err) {
            console.warn(`[PassiveTextureStreamer] stream error:`, err)
        } finally {
            this._isStreaming.set(false)
        }
    }

    public stopStreaming(): void {
        this.cancel = true
        this._isStreaming.set(false)
    }

    // ─────────────────────────────────────────────
    // internal: direct JSON hydration + async worker decoding
    // ─────────────────────────────────────────────
    private async streamHive(hiveName: string): Promise<void> {
        if (this.cancel) return
        const startHive = performance.now()

        try {
            console.debug(`[PassiveTextureStreamer] start loading hive '${hiveName}'`)
            const hive = await this.hives.loadHive(hiveName)
            if (!hive?.file) {
                console.warn(`[PassiveTextureStreamer] hive '${hiveName}' not found in OPFS`)
                return
            }

            const readStart = performance.now()
            const text = await hive.file.text()
            const dbJson = JSON.parse(text)
            const readDur = performance.now() - readStart
            console.debug(`[PassiveTextureStreamer] read/parse ${hiveName} in ${readDur.toFixed(1)}ms`)

            // keep your original Dexie layout logic
            const cellTable = dbJson.data.data.find(
                (t: any) => t.tableName === DBTables.Cells
            )

            if (!cellTable?.rows?.length) {
                console.log(`[PassiveTextureStreamer] hive '${hiveName}' has no cells`)
                return
            }

            const cells: Cell[] = cellTable.rows
            await this.honeycomb.query.decorateAll(cells)

            for (const cell of cells) {
                if (this.cancel) break
                const image = await this.imagesvc.loadForCell(cell, 'small')
                if (!image) continue

                this.decoder.decode(cell)
                await this.microDelay() // yield briefly to keep UI responsive
            }

            const dur = performance.now() - startHive
            console.log(`🐝 streamed textures for '${hiveName}' (${cells.length} cells) in ${dur.toFixed(0)} ms`)
        } catch (err) {
            console.warn(`[PassiveTextureStreamer] failed to load hive '${hiveName}':`, err)
        }
    }

    // ─────────────────────────────────────────────
    // helpers
    // ─────────────────────────────────────────────
    private microDelay(): Promise<void> {
        return new Promise(r => setTimeout(r, 1 + Math.random() * 2))
    }

    private interleave(a: IDexieHive[], b: IDexieHive[]): IDexieHive[] {
        const result: IDexieHive[] = []
        const len = Math.max(a.length, b.length)
        for (let i = 0; i < len; i++) {
            if (a[i]) result.push(a[i])
            if (b[i]) result.push(b[i])
        }
        return result
    }
}


//  console.debug(`[PassiveTextureStreamer] streaming ${cells.length} cells from '${hiveName}'`)

//       // preload images with limited concurrency
//       const concurrency = 8
//       for (let i = 0; i < cells.length; i += concurrency) {
//         if (this.cancel) break
//         const batch = cells.slice(i, i + concurrency)

//         await Promise.all(
//           batch.map(async (cell) => {
//             try {
//               const image = await this.imagesvc.loadForCell(cell, 'small')
//               if (image) {
//                 // 🧵 decode off main thread
//                 const bitmap = await this.decoder.decode(image.blob)
//                 // set decoded bitmap for textureService to use
//                 ;(cell as any).bitmap = bitmap
//               }
//             } catch (err) {
//               console.warn(`[PassiveTextureStreamer] failed to decode image:`, err)
//             }
//           })
//         )
//       }
import { CellOptions } from '../../core/models/enumerations'
import { PointerState } from 'src/app/state/input/pointer-state'
import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Container, Point } from 'pixi.js'
import { fromEvent, firstValueFrom } from 'rxjs'
import { NewTileService } from 'src/app/cells/creation/new-tile-service'
import { BlobService } from 'src/app/hive/rendering/blob-service'
import { HONEYCOMB_STORE } from 'src/app/shared/tokens/i-comb-store.token'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { focused } from 'src/app/state/interactivity/focus-cell'
import { HiveEvents, Constants, LocalAssets } from 'src/app/helper/constants'
import { CellEditor } from 'src/app/layout/hexagons/cell-editor'
import { CoordinateLocator } from 'src/app/unsorted/utility/coordinate-locator'
import { CoordinateDetector } from '../detection/coordinate-detector'
import { OpenGraphResult } from './open-graph-interfaces'
import { ReceiveFileBase } from './receive-file-base'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class OpenGrapservice extends ReceiveFileBase {

    private readonly blob = inject(BlobService)
    private readonly detector = inject(CoordinateDetector)
    private readonly es = inject(EditorService)\
    private readonly http = inject(HttpClient)
    private readonly locator = inject(CoordinateLocator)
    private readonly manager = inject(CellEditor)
    private readonly ps = inject(PointerState)
    private readonly store = inject(HONEYCOMB_STORE)
    private readonly new_tiles = inject(NewTileService)

    constructor() {
        super()

        fromEvent<CustomEvent>(document, HiveEvents.HexagonLinkDropped)
            .subscribe(e => this.receive(e))

    }

    protected canReceive = async (dropEvent: any): Promise<boolean> => {
        const { dataTransfer } = dropEvent.detail.event as DragEvent
        if (this.es.isEditing()) return false

        const files = dataTransfer?.files || []
        const hasImage = files.length > 0 && files[0].type.startsWith('image/')
        const hasUri = dataTransfer?.types.includes('text/uri-list')

        return hasImage || hasUri || false
    }


    protected override receiving = async (dropEvent: any): Promise<boolean> => {
        const event = <any>dropEvent.detail.event
        const url = event.dataTransfer.getData(this.uriList)
        const data = await this.getOpenGraphData(url)
        await this.process(event, data)
        return true
    }


    private async getOpenGraphData(url: string): Promise<OpenGraphResult> {
        const functionUrl = Constants.functionUrl

        const response$ = this.http.get(functionUrl, { params: { url } })
        const result = await firstValueFrom(response$)
        return result as OpenGraphResult
    }

    private async process(event: any, data: OpenGraphResult) {
        this.debug.log("misc", data.ogImage)

        const global = new Point(event.x, event.y)

        // one-liner: resolve tile under pointer
        let tile = this.detector.getByGlobal(global)

        const hiveName = context.hiveName()
        if (!hiveName) throw new Error("no active hive")

        let cell: Cell | undefined = undefined

        if (!tile) {
            const source = this.stack.current()
            if (!source) throw new Error("no source cell in stack")
            const hiveName = context.hiveName()

            cell = await this.new_tiles.createNewTile(global, {
                hive: hiveName,
                sourceId: source.cellId,
            })

            tile = this.detector.getByGlobal(global) // should be registered by TileFactory
        } else {
            cell = this.store.lookupData(tile.cellId)!
        }

        if (!cell) throw new Error("tile cell is undefined")

        // fetch preview image (OpenGraph image or fallback)
        const blob =
            data.ogImage !== undefined
                ? await this.blob.fetchImageAsBlob(data.ogImage)
                : await this.blob.fetchImageAsBlob(LocalAssets.YouTube)

        cell.blob = blob
        cell.sourcePath = URL.createObjectURL(blob)
        cell.link = (data.ogUrl && data.ogUrl !== "undefined" ? data.ogUrl : data.requestUrl) ?? ""
        cell.name = data.ogDescription || "No description available"

        this.manager.beginEditing(cell)
    }
//   // convenience: resolve tile by global point (does not modify focus)
//   public getByGlobal = (local: Point): Tile | undefined => {

//     const base = this.coordinate()
//     const candidates = base
//       ? [base, ...(this.axial.Adjacents.get(base.index) || [])]
//       : []
//     const closest = this.locator.findClosest(local, candidates, base)
//     if (!closest) return undefined
//     return this.get(closest.index)
//   }


}



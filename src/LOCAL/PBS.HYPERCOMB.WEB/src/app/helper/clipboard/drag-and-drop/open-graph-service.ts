import { HttpClient } from "@angular/common/http"
import { Injectable, inject } from "@angular/core"
import { Point } from "pixi.js"
import { fromEvent, firstValueFrom } from "rxjs"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { CellOptions } from "src/app/core/models/enumerations"
import { PointerState } from "src/app/state/input/pointer-state"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { NewTileService } from "src/app/tile/creation/new-tile-service"
import { CombStore } from "src/app/cells/storage/comb-store"
import { HiveEvents, Constants, LocalAssets } from "src/app/unsorted/constants"
import { HexagonEditManager } from "src/app/unsorted/hexagons/hexagon-edit-manager"
import { CoordinateLocator } from "src/app/unsorted/utility/coordinate-locator"
import { CoordinateDetector } from "../../detection/coordinate-detector"
import { OpenGraphResult } from "../../drag-and-drop/open-graph-interfaces"
import { ReceiveFileBase } from "../../drag-and-drop/receive-file-base"

@Injectable({
    providedIn: 'root'
})
export class OpenGrapservice extends ReceiveFileBase {

    private readonly blob = inject(BlobService)
    private readonly detector = inject(CoordinateDetector)
    private readonly es = inject(EditorService)
    private readonly http = inject(HttpClient)
    private readonly locator = inject(CoordinateLocator)
    private readonly manager = inject(HexagonEditManager)
    private readonly ps = inject(PointerState)
    private readonly store = inject(CombStore)
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

        // data.ogImage = (data.ogImage == 'undefined') ? undefined : data.ogImage
        this.debug.log('misc', data.ogImage)

        // and location information
        const { x, y } = event
        const globalPoint = new Point(x, y)
        const container = this.container

        const localPoint = this.ps.getLocalPosition(container, globalPoint)
        const closest = this.locator.findClosest(localPoint)
        let tile = this.detector.get(closest.index)!
        const tiles = this.store.cellsForHive(focused.cell())()
        const target = tiles.find(t => t.index === index)


        const data1 = this.cs.lookupData(tile.cellId)
        const index = data1?.index ?? this.detector.currentIndex

        const hiveName = this.hs.activeHive()!.name

        let cell

        if (!tile) {
            const source = this.stack.current()!
            // we already checked for null so this should always succeed !
            const options = <any>{ index, hiveName, sourceId: source.cellId }
            cell = await this.new_tiles.createNewTile(localPoint, options)
        }

        const hasImage = (data.ogImage !== undefined)
        const blob = hasImage ?
            await this.blob.fetchImageAsBlob(data.ogImage) :
            await this.blob.fetchImageAsBlob(LocalAssets.YouTube)

        const blobUrl = URL.createObjectURL(blob)

        // set the tile data
        cell.blob = blob
        cell.sourcePath = blobUrl

        if (!cell) throw new Error('Tile data is undefined. Cannot proceed with processing.')

        // update properties
        cell.link = data.ogUrl !== 'undefined' ? data.ogUrl : data.requestUrl
        cell.name = data.ogDescription || "No description available"
        cell.CellOptions |= CellOptions.Cell

        // show the editor for the new item
        this.manager.beginEditing(cell!)
    }
}



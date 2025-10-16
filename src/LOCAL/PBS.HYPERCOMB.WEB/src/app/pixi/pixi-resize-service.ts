import { Injectable, inject } from "@angular/core"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { RenderScheduler } from "src/app/unsorted/controller/render-scheduler"
import { Cell } from "src/app/cells/cell"

@Injectable({ providedIn: 'root' })
export class PixiResizeService extends PixiDataServiceBase {
    private readonly scheduler = inject(RenderScheduler)

    public async handleResize() {
        const current = this.stack.current()
        if (!current) return

        // adjust current tileâ€™s position for the new window size
        await this.adjustTilePositionForWindowSizeChange(current)

        // then trigger re-render
        this.scheduler.queue([current])
    }

    private adjustTilePositionForWindowSizeChange = async (cell: Cell) => {
        const previousWidth = cell?.windowWidth || window.innerWidth
        const previousHeight = cell?.windowHeight || window.innerHeight

        const currentWidth = window.innerWidth
        const currentHeight = window.innerHeight

        const widthChanged = previousWidth !== currentWidth
        const heightChanged = previousHeight !== currentHeight

        // only adjust if the window size has changed
        if (widthChanged || heightChanged) {
            const deltaX = (currentWidth - previousWidth) / 2
            const deltaY = (currentHeight - previousHeight) / 2

            cell.offsetX = (cell.offsetX || 0) + deltaX
            cell.offsetY = (cell.offsetY || 0) + deltaY

            cell.windowWidth = currentWidth
            cell.windowHeight = currentHeight
        }
    }


}



import { effect, Injectable } from "@angular/core";
import { LayoutServiceBase } from "src/app/core/mixins/abstraction/service-base";

@Injectable({ providedIn: 'root' })
export class GhostTileService extends LayoutServiceBase {

    private lastSeq = 0

    constructor() {
        super()
        effect(async () => {
            const seq = this.ps.downSeq()
            if (seq === 0 || seq === this.lastSeq) return
            this.lastSeq = seq

            const down = this.ps.pointerDownEvent()
            if (!down) return

            const coordinate = this.detector.emptyCoordinate()
            if (!coordinate) {
                this.debug.log('layout', 'no empty coordinate detected')
                return
            }

            const cell = this.stack.cell()
            const created = await this.comb.modify.create({
                hive: cell?.hive,
                index: coordinate.index,
                sourceId: cell?.cellId,
                name: 'New Tile',
                kind: 'Cell',
            })

            // add to container 
            if (created) {
                this.debug.log('layout', `ghost tile created at ${coordinate.Location.x},${coordinate.Location.y}`)
            }

            await this.comb.modify.updateCell(created)
        })
    }
}
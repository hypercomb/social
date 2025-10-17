import { Injectable, effect } from '@angular/core'
import { HypercombLayout } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { Cell, Ghost } from 'c:/Projects/hypercomb/social/src/LOCAL/PBS.HYPERCOMB.WEB/src/app/cells/cell'

@Injectable({ providedIn: 'root' })
export class GhostTileService extends HypercombLayout {
    private lastSeq = 0

    private ghost: Ghost | undefined = undefined
    constructor() {
        super()

        // ────────────────────────────────
        // create a real cell on pointerdown
        // ────────────────────────────────
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
            const created = await this.comb.modify.create(
                {
                    hive: cell?.hive,
                    index: coordinate.index,
                    sourceId: cell?.cellId,
                    name: 'New Tile'
                },
                'Cell'
            )

            if (created) {
                this.debug.log('layout', `tile created at ${coordinate.Location.x},${coordinate.Location.y}`)
            }

            await this.comb.modify.updateCell(created)
            await this.comb.store.enqueueHot([created] as Cell[])
        })

        // ────────────────────────────────
        // show or move the staged ghost tile
        // ────────────────────────────────
        effect(async () => {

            const coordinate = this.detector.emptyCoordinate()
            if (!coordinate) return
            this.debug.log('layout', `ghost effect triggered for empty coordinate:${coordinate.index}}`)
            this.ghost = await this.cell.creator.createGhost({})
            const { ghost, ghost: { image } } = this
            await this.comb.modify.addCell(ghost, image!)
        })

        // ────────────────────────────────
        // hide ghost when pointer released
        // ────────────────────────────────
        effect(async () => {
            const seq = this.ps.upSeq()
            if (seq === 0 || !this.ghost) return

            await this.comb.modify.removeCell(<Cell>this.ghost)
        })
    }
}

import { Injectable, effect } from '@angular/core'
import { HypercombLayout } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { Cell, Ghost, NewCell } from '../cell'

@Injectable({ providedIn: 'root' })
export class GhostTileService extends HypercombLayout {
    private ghost: Ghost | undefined
    private activeIndex: number | null = null
    private committing = false

    constructor() {
        super()

        // ────────────────────────────────
        // dynamically create/destroy ghost
        // ────────────────────────────────
        effect(async () => {
            const coordinate = this.detector.emptyCoordinate()

            if (!coordinate) {
                if (this.ghost) await this.destroyGhost()
                this.activeIndex = null
                return
            }

            if (coordinate.index !== this.activeIndex) {
                this.activeIndex = coordinate.index
                await this.createGhostAt(coordinate)
            }
        })

        effect(async () => {
            const seq = this.ps.upSeq()
            if (seq === 0) return
            if (!this.ghost || this.committing) return

            const coord = this.detector.emptyCoordinate()
            if (!coord) return

            // only commit if pointerup occurred at the *same* index
            if (coord.index !== this.activeIndex) return

            await this.commitGhostToCell()
        })
    }

    private createGhostAt = async (coordinate: any): Promise<void> => {
        if (this.ghost) await this.destroyGhost()
        this.debug.log('layout', `creating ghost at ${coordinate.index}`)
        const ghost = await this.cell.creator.createGhost({ index: coordinate.index })
        this.ghost = ghost
        await this.comb.store.enqueueHot([ghost])
    }

    private commitGhostToCell = async (): Promise<void> => {
        if (!this.ghost) return
        this.committing = true
        try {
            const g = this.ghost as any
            const { cellId, ...rest } = g
            const source = this.stack.cell()!
            const newCell = <NewCell>{ ...rest, kind: 'Cell', sourceId: source.cellId! }

            this.debug.log('layout', `committing ghost to real cell at ${newCell.index}`)

            g.setKind('Cell')
            await this.comb.modify.addCell(newCell, newCell.image!)

            await this.destroyGhost()
            this.activeIndex = null
        } finally {
            this.committing = false
        }
    }

    private destroyGhost = async (): Promise<void> => {
        if (!this.ghost) return
        this.debug.log('layout', 'destroying ghost')
        await this.comb.modify.removeCell(this.ghost as Cell)
        this.ghost = undefined
    }
}

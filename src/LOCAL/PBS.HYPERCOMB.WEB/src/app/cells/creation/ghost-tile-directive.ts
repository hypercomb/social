// src/app/cells/creation/ghost-tile.directive.ts
import { Directive, effect } from '@angular/core'
import { HypercombLayout } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { Cell, Ghost, NewCell } from '../cell'

@Directive({
  selector: '[ghost-tile]',
  standalone: true,
})
export class GhostTileDirective extends HypercombLayout {
  private ghost: Ghost | undefined
  private activeIndex: number | null = null
  private committing = false
  private lastUpSeq = 0

  constructor() {   
    super()

    // ────────────────────────────────
    // effect: ghost position updater
    // ────────────────────────────────
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) return

      const coord = this.detector.emptyCoordinate()

      // no valid spot → clean ghost
      if (!coord) {
        this.destroyGhost()
        this.activeIndex = null
        return
      }

      // same index → no change
      if (coord.index === this.activeIndex) return

      // new coordinate → move ghost cleanly
      this.activeIndex = coord.index
      this.createGhostAt(coord)
    })

    // ────────────────────────────────
    // effect: pointer up → commit ghost
    // ────────────────────────────────
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) return

      const seq = this.ps.upSeq()
      if (seq === 0) return
      if (this.lastUpSeq === seq) return

      this.lastUpSeq = seq

      // nothing to commit
      if (!this.ghost || this.committing) return

      const coord = this.detector.emptyCoordinate()

      // mismatch or invalid → cleanup
      if (!coord || coord.index !== this.activeIndex) {
        this.destroyGhost()
        this.activeIndex = null
        return
      }

      this.commitGhostToCell()
    })

    // ────────────────────────────────
    // effect: leaving edit mode → always clean ghost
    // ────────────────────────────────
    effect(() => {
      const isEdit = this.state.hasMode(HypercombMode.EditMode)
      if (!isEdit) {
        this.destroyGhost()
        this.activeIndex = null
      }
    })
  }

  // ────────────────────────────────
  // create ghost
  // ────────────────────────────────
  private createGhostAt = async (coordinate: any): Promise<void> => {
    // old ghost must disappear before showing new one
    if (this.ghost) await this.destroyGhost()

    this.debug.log('layout', `creating ghost at ${coordinate.index}`)
    const ghost = await this.cell.creator.createGhost({ index: coordinate.index })
    this.ghost = ghost

    await this.honeycomb.store.enqueueHot([ghost])
  }

  // ────────────────────────────────
  // commit ghost
  // ────────────────────────────────
  private commitGhostToCell = async (): Promise<void> => {
    if (!this.ghost) return

    this.committing = true

    try {
      const g = this.ghost as any
      const { cellId, ...rest } = g
      const source = this.stack.cell()!
      const newCell = <NewCell>{ ...rest, kind: 'Cell', sourceId: source.cellId! }

      this.debug.log('layout', `committing ghost at ${newCell.index}`)

      g.setKind('Cell')
      await this.honeycomb.modify.addCell(newCell, newCell.image!)

      // always remove ghost after commit
      await this.destroyGhost()
      this.activeIndex = null

    } finally {
      this.committing = false
    }
  }

  // ────────────────────────────────
  // destroy ghost
  // ────────────────────────────────
  private destroyGhost = async (): Promise<void> => {
    if (!this.ghost) return

    this.debug.log('layout', 'destroying ghost')
    await this.honeycomb.modify.removeCell(this.ghost as Cell)
    this.ghost = undefined
  }
}

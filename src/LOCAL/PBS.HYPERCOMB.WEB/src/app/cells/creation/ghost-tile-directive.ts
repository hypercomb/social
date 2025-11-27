// src/app/cells/creation/ghost-tile.directive.ts
import { Directive, effect } from "@angular/core"
import { HypercombLayout } from "src/app/core/mixins/abstraction/hypercomb.base"
import { HypercombMode } from "src/app/core/models/enumerations"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { Cell, Ghost, NewCell } from "../cell"

@Directive({
  selector: "[ghost-tile]",
  standalone: true,
})
export class GhostTileDirective extends HypercombLayout {
  private ghost: Ghost | undefined
  private activeIndex: number | null = null
  private committing = false
  private lastUpSeq = 0

  constructor() {
    super()

    // ───────────────────────────────────────────────
    // 1. live hover tracking — ghost follows empty index
    // ───────────────────────────────────────────────
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) return

      const coord = this.detector.emptyCoordinate()

      // nothing under pointer → remove ghost
      if (!coord) {
        this.destroyGhost()
        this.activeIndex = null
        return
      }

      // unchanged tile index → do nothing
      if (coord.index === this.activeIndex) return

      // new position → recreate ghost
      this.activeIndex = coord.index
      this.createGhostAt(coord)
    })

    // ───────────────────────────────────────────────
    // 2. pointer up → commit ghost
    // ───────────────────────────────────────────────
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) return

      const seq = this.ps.upSeq()
      if (seq === 0 || seq === this.lastUpSeq) return
      this.lastUpSeq = seq

      if (!this.ghost || this.committing) return

      const coord = this.detector.emptyCoordinate()

      // pointer moved off → discard
      if (!coord || coord.index !== this.activeIndex) {
        this.destroyGhost()
        this.activeIndex = null
        return
      }

      this.commitGhostAt(coord.index)
    })

    // ───────────────────────────────────────────────
    // 3. leaving edit mode → wipe ghost entirely
    // ───────────────────────────────────────────────
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) {
        this.destroyGhost()
        this.activeIndex = null
      }
    })
  }

  // ───────────────────────────────────────────────
  // create ghost tile
  // ───────────────────────────────────────────────
  private createGhostAt = async (coordinate: any): Promise<void> => {
    if (this.ghost) await this.destroyGhost()

    this.debug.log('layout', `creating ghost at ${coordinate.index}`)
    const ghost = await this.cell.creator.createGhost({ index: coordinate.index })

    this.debug.log('layout', 'ghost created', ghost)
    this.ghost = ghost

    await this.honeycomb.store.enqueueHot([ghost])
  }


  // ───────────────────────────────────────────────
  // commit ghost → new permanent tile
  // ───────────────────────────────────────────────
  private commitGhostAt = async (index: number): Promise<void> => {
    if (!this.ghost) return
    this.committing = true

    try {
      const source = this.stack.cell()!
      const g = this.ghost as any

      const { cellId, ...rest } = g
      const newCell = <NewCell>{
        ...rest,
        kind: "Cell",
        index,
        sourceId: source.cellId!,
        hive: source.hive,
        hasChildrenFlag: "false",
      }

      g.setKind("Cell")
      await this.honeycomb.modify.addCell(newCell)
      await this.destroyGhost()
      this.activeIndex = null

    } finally {
      this.committing = false
    }
  }

  // ───────────────────────────────────────────────
  // remove ghost tile safely
  // ───────────────────────────────────────────────
  private destroyGhost = async (): Promise<void> => {
    if (!this.ghost) return
    await this.honeycomb.modify.removeCell(this.ghost as Cell)
    this.ghost = undefined
  }
}

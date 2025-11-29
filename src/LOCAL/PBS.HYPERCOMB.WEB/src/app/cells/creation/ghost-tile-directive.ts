// src/app/cells/creation/ghost-tile.directive.ts
import { Directive, effect, inject } from "@angular/core"
import { Container } from "pixi.js"
import { HypercombLayout } from "src/app/core/mixins/abstraction/hypercomb.base"
import { HypercombMode } from "src/app/core/models/enumerations"
import { Cell, Ghost, NewCell } from "../cell"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { CellEditContext } from "src/app/state/interactivity/cell-edit-context"
import { PIXI_MANAGER } from "src/app/shared/tokens/i-pixi-manager.token"

@Directive({
  selector: "[ghost-tile]",
  standalone: true,
})
export class GhostTileDirective extends HypercombLayout {
  private ghost: Ghost | undefined
  private activeIndex: number | null = null
  private committing = false
  private lastUpSeq = 0

  private readonly pixi = inject(PIXI_MANAGER)
  private readonly tileFactory = inject(TILE_FACTORY)
  private readonly editor = inject(EditorService)

  private ghostSprite?: Container

  constructor() {
    super()

    // 1. live hover tracking — ghost follows empty index
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) return

      const coord = this.detector.emptyCoordinate()

      if (!coord) {
        this.destroyGhost()
        this.activeIndex = null
        return
      }

      if (coord.index === this.activeIndex) return

      this.activeIndex = coord.index
      this.createGhostAt(coord)
    })

    // 2. pointer up → commit ghost
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) return

      const seq = this.ps.upSeq()
      if (seq === 0 || seq === this.lastUpSeq) return
      this.lastUpSeq = seq

      if (!this.ghost || this.committing) return

      const coord = this.detector.emptyCoordinate()
      if (!coord || coord.index !== this.activeIndex) {
        this.destroyGhost()
        this.activeIndex = null
        return
      }

      this.commitGhostAt(coord.index)
    })

    // 3. leaving edit mode → wipe ghost entirely
    effect(() => {
      if (!this.state.hasMode(HypercombMode.EditMode)) {
        this.destroyGhost()
        this.activeIndex = null
      }
    })
  }

  // create ghost tile (data + sprite)
  private createGhostAt = async (coordinate: any): Promise<void> => {
    await this.destroyGhost()

    this.debug.log("layout", `creating ghost at ${coordinate.index}`)

    const ghost = await this.cell.creator.createGhost({ index: coordinate.index })
    this.debug.log("layout", "ghost created", ghost)
    this.ghost = ghost

    const tile = await this.tileFactory.create(ghost as unknown as Cell)

    tile.alpha = 0.6
    tile.eventMode = "none"
    tile.zIndex = 9999

    const container = this.pixi.container
    if (container) {
      container.sortableChildren = true
      container.addChild(tile)
      this.ghostSprite = tile
    }
  }

  // commit ghost → new permanent tile + open editor
  private commitGhostAt = async (index: number): Promise<void> => {
    if (!this.ghost) return
    this.committing = true

    try {
      const source = this.stack.cell()!
      const g = this.ghost

      // use factory to build a real NewCell instance
      const newCell = this.cell.creator.newCell({
        index,
        hive: source.hive,
        sourceId: source.cellId,
        hasChildrenFlag: "false",
        imageHash: g.imageHash,
        name: "",
        link: "",
      })

      // mark kind properly before persisting
      newCell.setKind("Cell")

      // persist
      const saved = await this.honeycomb.modify.addCell(newCell)

      // update parent flag
      await this.honeycomb.modify.updateHasChildren(source)

      // open editor
      const ctx = new CellEditContext(saved)
      await this.editor.setContext(ctx)

      await this.destroyGhost()
      this.activeIndex = null
    } finally {
      this.committing = false
    }
  }


  // remove ghost tile sprite + data
  private destroyGhost = async (): Promise<void> => {
    if (this.ghostSprite) {
      const parent = this.ghostSprite.parent
      if (parent) parent.removeChild(this.ghostSprite)
      this.ghostSprite.destroy({ children: true })
      this.ghostSprite = undefined
    }

    this.ghost = undefined
  }
}

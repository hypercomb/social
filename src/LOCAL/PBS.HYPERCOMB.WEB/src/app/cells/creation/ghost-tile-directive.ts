// src/app/cells/creation/ghost-tile.directive.ts
import { Directive, effect, inject } from "@angular/core"
import { Container } from "pixi.js"
import { HypercombLayout } from "src/app/core/mixins/abstraction/hypercomb.base"
import { HypercombMode } from "src/app/core/models/enumerations"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { Cell, Ghost, NewCell } from "../cell"
import { PixiManager } from "src/app/pixi/pixi-manager"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"

@Directive({
  selector: "[ghost-tile]",
  standalone: true,
})
export class GhostTileDirective extends HypercombLayout {
  private ghost: Ghost | undefined
  private activeIndex: number | null = null
  private committing = false
  private lastUpSeq = 0

  // new: pixi + tile factory + sprite handle
  private readonly pixi = inject(PixiManager)
  private readonly tileFactory = inject(TILE_FACTORY)
  private ghostSprite?: Container

  constructor() {
    super()

    // ───────────────────────────────────────────────
    // 1. live hover tracking — ghost follows empty index
    // ───────────────────────────────────────────────
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
  // create ghost tile (data + sprite)
  // ───────────────────────────────────────────────
  private createGhostAt = async (coordinate: any): Promise<void> => {
    await this.destroyGhost()

    this.debug.log("layout", `creating ghost at ${coordinate.index}`)

    // domain ghost (uses CellFactory.createGhost)
    const ghost = await this.cell.creator.createGhost({ index: coordinate.index })
    this.debug.log("layout", "ghost created", ghost)
    this.ghost = ghost

    // build a visual tile for the ghost using the normal tile factory
    const tile = await this.tileFactory.create(ghost as unknown as Cell)

    // make it look “ghosty” and non-interactive
    tile.alpha = 0.6
    tile.eventMode = "none" // important: do not steal pointer events
    tile.zIndex = 9999

    const container = this.pixi.container
    if (container) {
      container.sortableChildren = true
      container.addChild(tile)
      this.ghostSprite = tile
    }
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
  // remove ghost tile sprite + data
  // ───────────────────────────────────────────────
  private destroyGhost = async (): Promise<void> => {
    // remove sprite from pixi
    if (this.ghostSprite) {
      const parent = this.ghostSprite.parent
      if (parent) parent.removeChild(this.ghostSprite)
      this.ghostSprite.destroy({ children: true })
      this.ghostSprite = undefined
    }

    // clear domain ghost reference
    this.ghost = undefined
  }
}

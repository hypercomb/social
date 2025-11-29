// src/app/cells/selection/selection-move-manager.ts
import { Injectable, inject } from "@angular/core"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { HONEYCOMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-comb-service.token"
import { AxialService } from "src/app/services/axial-service"
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector"
import { Cell } from "../cell"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { SelectionService } from "./selection-service"
import { effect } from "src/app/performance/effect-profiler"

@Injectable({ providedIn: "root" })
export class SelectionMoveManager extends PixiServiceBase {

  private readonly axials = inject(AxialService)
  private readonly store = inject(HONEYCOMB_STORE)
  private readonly modify = inject(MODIFY_COMB_SVC)
  private readonly detector = inject(CoordinateDetector)
  private readonly selectionsvc = inject(SelectionService)

  // internal drag state
  private anchorAx: AxialCoordinate | null = null
  private downPos: { x: number; y: number } | null = null
  private isDragging = false
  private readonly threshold = 6
  private get cells(): Cell[] { return this.store.cells() }

  // saved state for swap resolution
  private orig = new Map<number, AxialCoordinate>() // moved set → axial
  private occ0 = new Map<number, number>()         // index → cellId (all cells)
  private lastIndex: number = -1                   // last hovered index

  protected override onPixiReady(): void {
    const container = this.pixi.container!
    container.on("pointerup", (ev: PointerEvent) => this.onUp(ev))
  }

  constructor() {
    super()

    effect(() => {
      const coord = this.detector.coordinate()
      const index = coord?.index ?? -1

      if (index === this.lastIndex) return
      this.lastIndex = index

      if (!this.anchorAx || !this.downPos) return
      if (!coord) return
      if (this.orig.size === 0) return   // nothing to move (no group / tile)

      // first real drag frame
      if (!this.isDragging) {
        this.isDragging = true
      }

      const hoverAx = coord
      const diff = AxialCoordinate.subtract(hoverAx, this.anchorAx)
      const placements = this.computePlacements(diff)

      // reset all tiles to base positions
      for (const c of this.store.cells()) {
        const baseAx = this.axials.items.get(c.index)
        const tile = this.store.lookupTile(c.cellId)
        if (baseAx && tile) tile.setPosition(baseAx.Location)
      }

      // apply live drag preview (moved + swapped)
      for (const [cellId, ax] of placements) {
        const tile = this.store.lookupTile(cellId)
        if (tile) tile.setPosition(ax.Location)
      }
    })
  }

  // ------------------------------------------------------------------
  // called by TilePointerManager on pointerdown
  // ------------------------------------------------------------------
  public beginDrag(cell: Cell, ev: PointerEvent): void {
    const selections = this.selectionsvc.items()
    const inSelection = selections.some(c => c.cellId === cell.cellId)

    // if there is a selection and this tile is in it → move the whole group
    // otherwise → move just this tile (quick single-tile swap)
    const group: Cell[] =
      inSelection && selections.length > 0
        ? selections
        : [cell]

    const ax = this.axials.items.get(cell.index)
    if (!ax) return

    this.anchorAx = ax
    this.downPos = { x: ev.clientX, y: ev.clientY }
    this.isDragging = false
    this.lastIndex = -1

    // snapshot moved set
    this.orig.clear()
    for (const c of group) {
      const selAx = this.axials.items.get(c.index)
      if (selAx) this.orig.set(c.cellId, selAx)
    }

    // snapshot full occupancy for swap detection
    this.occ0.clear()
    for (const c of this.cells) {
      this.occ0.set(c.index, c.cellId)
    }
  }

  // ------------------------------------------------------------------
  // compute tile swapping layout (rigid block + direct swaps)
  // ------------------------------------------------------------------
  private computePlacements(diff: AxialCoordinate): Map<number, AxialCoordinate> {
    const placements = new Map<number, AxialCoordinate>()
    if (this.orig.size === 0) return placements

    // 1) move all tiles in the current move group by diff
    for (const [cellId, fromAx] of this.orig) {
      const toAx = AxialCoordinate.add(fromAx, diff)
      placements.set(cellId, toAx)
    }

    // 2) handle simple swaps for unselected occupants
    for (const [cellId, fromAx] of this.orig) {
      const toAx = placements.get(cellId)
      if (!toAx) continue

      const occId = this.occ0.get(toAx.index)
      if (occId == null) continue
      if (this.orig.has(occId)) continue // already part of the moving group

      placements.set(occId, fromAx)
    }

    return placements
  }

  // ------------------------------------------------------------------
  // pointerup → commit drag
  // ------------------------------------------------------------------
  public async onUp(ev: PointerEvent): Promise<void> {
    if (this.isDragging && this.anchorAx) {
      const local = this.pixi.container!.toLocal({ x: ev.clientX, y: ev.clientY })
      this.detector.detect(local)
      const hoverAx = this.detector.coordinate()

      if (hoverAx) {
        const diff = AxialCoordinate.subtract(hoverAx, this.anchorAx)
        const placements = this.computePlacements(diff)
        const updated: Cell[] = []

        for (const [cellId, ax] of placements) {
          const cell = this.store.lookupData(cellId)!
          if (cell.index !== ax.index) {
            cell.index = ax.index
            updated.push(cell)
          }
        }

        if (updated.length) {
          await this.modify.bulkPut(updated)
        }
      }
    }
    this.reset()
  }

  private reset(): void {
    this.anchorAx = null
    this.downPos = null
    this.isDragging = false
    this.lastIndex = -1
    this.orig.clear()
    this.occ0.clear()
  }
}

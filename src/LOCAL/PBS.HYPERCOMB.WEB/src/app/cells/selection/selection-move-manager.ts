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

  // saved state for swap resolution
  private orig = new Map<number, AxialCoordinate>()
  private occ0 = new Map<number, number>() // index → cellId


  protected override onPixiReady(): void {
    const container = this.pixi.container!
    container.on("pointermove", (ev: PointerEvent) => this.onMove(ev))
    container.on("pointerup", (ev: PointerEvent) => this.onUp(ev))
  }

  // ------------------------------------------------------------------
  // called by TilePointerManager on pointerdown
  // ------------------------------------------------------------------
  public beginDrag(cell: Cell, ev: PointerEvent): void {
    const selections = this.selectionsvc.items()
    if (!selections.some(c => c.cellId === cell.cellId)) return

    const ax = this.axials.items.get(cell.index)
    if (!ax) return

    this.anchorAx = ax
    this.downPos = { x: ev.clientX, y: ev.clientY }

    // do NOT snapshot here
    this.orig.clear()
    this.occ0.clear()

  }



  // ------------------------------------------------------------------
  // pointermove → compute ghost positions
  // ------------------------------------------------------------------
  public onMove(ev: PointerEvent): void {
    if (!this.anchorAx || !this.downPos || !this.selectionsvc.hasItems()) return

    // drag threshold – ignore micro jitter
    const dx = ev.clientX - this.downPos.x
    const dy = ev.clientY - this.downPos.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (!this.isDragging && distance < this.threshold) {
      return
    }

    // first real drag frame → snapshot original layout once
    if (!this.isDragging) {
      this.isDragging = true

      // 1. snapshot original positions once
      this.orig.clear()
      for (const c of this.selectionsvc.items()) {
        const ax = this.axials.items.get(c.index)
        if (ax) this.orig.set(c.cellId, ax)
      } 

      // 2. snapshot full occupancy map once
      this.occ0.clear()
      for (const c of this.store.cells()) {
        this.occ0.set(c.index, c.cellId)
      }
    }


    // update hover detection in container space
    const local = this.pixi.container!.toLocal({
      x: ev.clientX,
      y: ev.clientY,
    })

    this.detector.detect(local)
    const hoverAx = this.detector.coordinate()
    if (!hoverAx) return

    const diff = AxialCoordinate.subtract(hoverAx, this.anchorAx)

    // compute where everything should be
    const placements = this.computePlacements(diff)

    // reset all tiles to their base positions
    for (const c of this.store.cells()) {
      const baseAx = this.axials.items.get(c.index)
      const tile = this.store.lookupTile(c.cellId)
      if (baseAx && tile) tile.setPosition(baseAx.Location)
    }

    // apply live drag preview (moved + swapped tiles)
    for (const [cellId, ax] of placements) {
      const tile = this.store.lookupTile(cellId)
      if (tile) tile.setPosition(ax.Location)
    }
  }



  // ------------------------------------------------------------------
  // pointerup → commit drag
  // ------------------------------------------------------------------
  public async onUp(ev: PointerEvent): Promise<void> {

    if (this.isDragging && this.anchorAx) {
      const local = this.pixi.container!.toLocal({
        x: ev.clientX,
        y: ev.clientY,
      })

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

        // important: nothing touches the DB until here
        if (updated.length) {
          await this.modify.bulkPut(updated)
        }
      }
    }

    this.reset()
  }


  // ------------------------------------------------------------------
  // compute tile swapping layout
  // ------------------------------------------------------------------
  private computePlacements(diff: AxialCoordinate): Map<number, AxialCoordinate> {
    const placements = new Map<number, AxialCoordinate>()
    const toIndexToFallback = new Map<number, AxialCoordinate>()
    const movedIds = new Set<number>()

    // build moves
    for (const [cellId, from] of this.orig) {
      const to = AxialCoordinate.add(from, diff)
      placements.set(cellId, to)
      toIndexToFallback.set(to.index, from)
      movedIds.add(cellId)
    }

    // resolve collisions
    for (const [cellId, to] of placements.entries()) {
      const occId = this.occ0.get(to.index)
      if (occId == null || movedIds.has(occId) || occId === cellId) continue

      let dest = this.orig.get(cellId)!
      const visited = new Set<number>()

      // fallback chain
      while (toIndexToFallback.has(dest.index) && !visited.has(dest.index)) {
        visited.add(dest.index)
        dest = toIndexToFallback.get(dest.index)!
      }

      placements.set(occId, dest)
    }

    return placements
  }

  // ------------------------------------------------------------------
  // full reset after drag
  // ------------------------------------------------------------------
  private reset(): void {
    this.anchorAx = null
    this.downPos = null
    this.isDragging = false
    this.orig.clear()
    this.occ0.clear()
  }
}

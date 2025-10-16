import { Injectable, inject, effect, computed, signal } from "@angular/core"
import { PointerState } from "src/app/state/input/pointer-state"
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector"
import { AxialService } from "src/app/unsorted/utility/axial-service"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { POLICY } from "src/app/core/models/enumerations"
import { DataServiceBase } from "src/app/actions/service-base-classes"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-comb-service.token"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { SELECTIONS } from "src/app/shared/tokens/i-selection.token"

type Move = { from: AxialCoordinate; to: AxialCoordinate }

@Injectable({ providedIn: "root" })
export class SelectionMoveManager extends DataServiceBase {
  private readonly axials = inject(AxialService)
  private readonly ps = inject(PointerState)
  private readonly detector = inject(CoordinateDetector)
  private readonly modify = inject(MODIFY_COMB_SVC)
  private readonly selections = inject(SELECTIONS)
  private readonly store = inject(COMB_STORE)

  // latched state
  private anchor: AxialCoordinate | null = null
  private lastDelta = { dq: 0, dr: 0 }

  // drag signals
  private readonly _isDragging = signal(false)
  public readonly isDragging = this._isDragging.asReadonly()

  // snapshots
  private orig = new Map<number, AxialCoordinate>() // cellId → original axial
  private occ0 = new Map<number, number>()          // index → occupant cellId

  // policies
  public isControlDown = this.policy.any(POLICY.ControlDown)
  public isMoveMode = this.policy.all(POLICY.MovingTiles)
  public isBlocked = computed(() => this.isControlDown() || !this.isMoveMode())

  constructor() {
    super()

    // Stage A: pointerDown → latch anchor
    effect(() => {
      const tick = this.ps.downSeq()
      if (tick === 0 || this.isBlocked()) return
      if (this.anchor) return // already dragging, don’t re-latch

      const ev = this.ps.pointerDownEvent()
      if (!ev) return
      const lead = this.detector.activeTile()
      if (!lead) return
      const leadCell = this.store.lookupData(lead.cellId)
      if (!leadCell) return

      const leadAx = this.axials.items.get(leadCell.index)
      if (!leadAx) return

      this.anchor = leadAx
      this.lastDelta = { dq: 0, dr: 0 }
      this._isDragging.set(false) // not yet dragging until threshold crossed
    })

    // Stage B: pointerMove → ghost tiles
    effect(() => {
      const tick = this.ps.moveSeq()
      if (tick === 0 || this.isBlocked() || !this.anchor) return

      const hoverAx = this.detector.coordinate()
      if (!hoverAx) return

      const diff = AxialCoordinate.subtract(hoverAx, this.anchor)

      if (!this.isDragging()) {
        // first transition into a drag
        this._isDragging.set(true)

        const leadTile = this.detector.activeTile()
        const leadCell = leadTile ? this.store.lookupData(leadTile.cellId) : null
        const selected = this.store.selectedCells()
        let dragSet = selected

        if (leadCell && !selected.some(c => c.cellId === leadCell.cellId)) {
          dragSet = [leadCell]
        }

        this.orig.clear()
        for (const c of dragSet) {
          const ax = this.axials.items.get(c.index)
          if (ax) this.orig.set(c.cellId, ax)
        }

        this.occ0.clear()
        for (const c of this.store.cells()) {
          this.occ0.set(c.index, c.cellId)
        }
      }

      this.lastDelta = { dq: diff.q, dr: diff.r }

      // reset positions
      for (const c of this.store.cells()) {
        const baseAx = this.axials.items.get(c.index)
        const tile = this.store.lookupTile(c.cellId)
        if (baseAx && tile) tile.setPosition(baseAx.Location)
      }

      // apply placements
      const placements = this.computePlacements(diff)
      for (const [cellId, ax] of placements) {
        const tile = this.store.lookupTile(cellId)
        if (tile) tile.setPosition(ax.Location)
      }
    })

    // Stage C: pointerUp → commit
    effect(async () => {
      const tick = this.ps.upSeq()
      if (tick === 0 || !this.anchor) return

      if (!this.isDragging()) {
        this.resetMove()
        return
      }

      const hoverAx = this.detector.coordinate()
      if (!hoverAx) {
        this.snapAllToPersisted()
        this.resetMove()
        return
      }

      const diff = AxialCoordinate.subtract(hoverAx, this.anchor)
      const placements = this.computePlacements(diff)
      const updated: any[] = []

      for (const [cellId, ax] of placements) {
        let cell = this.store.lookupData(cellId) as any
        if (!cell) cell = this.store.cells().find(c => c.cellId === cellId)
        if (!cell) continue

        if (cell.index !== ax.index) {
          cell.index = ax.index
          updated.push(cell)
        }
      }

      if (updated.length) {
        await this.modify.bulkPut(updated)
      }

      this.snapAllToPersisted()
      this.resetMove()
    })

    // cancel drag if policy flips mid-gesture
    effect(() => {
      if (this.isBlocked() && this.anchor) {
        this.snapAllToPersisted()
        this.resetMove()
      }
    })
  }

  private computePlacements(diff: AxialCoordinate): Map<number, AxialCoordinate> {
    const moves = new Map<number, Move>()
    for (const [cellId, from] of this.orig) {
      moves.set(cellId, { from, to: AxialCoordinate.add(from, diff) })
    }

    const toIndexToFallback = new Map<number, AxialCoordinate>()
    for (const { from, to } of moves.values()) {
      toIndexToFallback.set(to.index, from)
    }

    const movedIds = new Set(moves.keys())
    const placements = new Map<number, AxialCoordinate>()
    const ordered = Array.from(moves.entries())

    for (const [cellId, { to }] of ordered) {
      placements.set(cellId, to)
    }

    for (const [cellId, { to, from }] of ordered) {
      const occId = this.occ0.get(to.index)
      if (occId == null || movedIds.has(occId) || occId === cellId) continue

      let dest: AxialCoordinate = from
      const visited = new Set<number>()
      while (toIndexToFallback.has(dest.index) && !visited.has(dest.index)) {
        visited.add(dest.index)
        dest = toIndexToFallback.get(dest.index)!
      }
      placements.set(occId, dest)
    }

    return placements
  }

  private snapAllToPersisted() {
    for (const c of this.store.cells()) {
      const baseAx = this.axials.items.get(c.index)
      const tile = this.store.lookupTile(c.cellId)
      if (baseAx && tile) tile.setPosition(baseAx.Location)
    }
  }

  private resetMove() {
    this._isDragging.set(false)
    this.anchor = null
    this.lastDelta = { dq: 0, dr: 0 }
    this.orig.clear()
    this.occ0.clear()
    this.selections.clear()
  }
}

import { Injectable, inject, effect, signal, computed } from "@angular/core"
import { Point } from "pixi.js"
import { AxialService } from "src/app/unsorted/utility/axial-service"
import { CoordinateLocator } from "src/app/unsorted/utility/coordinate-locator"
import { PointerState } from "src/app/state/input/pointer-state"
import { Tile } from "src/app/cells/models/tile"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { ICoordinateDetector } from "src/app/shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: "root" })
export class CoordinateDetector implements ICoordinateDetector {

  private readonly axial = inject(AxialService)
  private readonly combstore = inject(COMB_STORE)
  private readonly locator = inject(CoordinateLocator)
  private readonly pointer = inject(PointerState)

  private readonly _coordinate = signal<AxialCoordinate | undefined>(undefined)
  public readonly coordinate = this._coordinate.asReadonly()

  public emptyCoordinate = computed((): AxialCoordinate | null => {
    const ax = this.coordinate()
    if (!ax) return null

    const tile = this.combstore.lookupTileByIndex(ax.index)
    return tile ? null : ax
  })

  private readonly _suspended = signal(false)
  public suspend(on: boolean) {
    this._suspended.set(on)
  }

  // 🔑 derive active tile directly from coordinate + store
  public readonly activeTile = computed((): Tile | undefined => {
    const idx = this.coordinate()?.index
    if (idx === undefined) return undefined
    return this.combstore.lookupTileByIndex(idx)
  })
 
  public readonly activeCell = computed(() => {
    const idx = this.coordinate()?.index
    if (idx === undefined) return undefined
    return this.combstore.lookupCellByIndex(idx)
  })

  private previous?: number

  constructor() {
    // pointer-driven detection
    effect(() => {
      const seq = this.pointer.detectSeq()
      if (!seq) return

      const local = this.pointer.localPosition()
      this.detect(local)
    })

    this.startAutoDetectJiggle()
  }

  private jiggleDir = 1

  private startAutoDetectJiggle(): void {
    setInterval(() => {
      const pos = this.pointer.position()
      if (!pos) return

      // move +1 / -1 px on x axis
      const newPos = new Point(pos.x + this.jiggleDir, pos.y)
      this.jiggleDir *= -1

      // update signals
      this.pointer.position.set(newPos)

      // recompute local and force detect
      this.pointer.refresh()
      const local = this.pointer.localPosition()

      if (local) this.detect(local)
    }, 100) // every 100ms, adjust to taste
  }


  public detect(local: Point): void {
    if (this._suspended()) return // 🚫 ignore hover while dragging

    const coordinate = this.coordinate()
    const candidates = coordinate
      ? [coordinate, ...(this.axial.Adjacents.get(coordinate.index) ?? [])]
      : [...this.axial.items.values()] // spread to avoid iterator reuse issues

    // try fast-path
    let closest = this.locator.findClosest(local, candidates, coordinate)

    // fallback → full set if needed
    if (closest === undefined) {
      closest = this.locator.findClosest(local, [...this.axial.items.values()], coordinate)
      if (closest === undefined) {
        this._coordinate.set(undefined)
        this.previous = undefined
        return
      }
    }

    // avoid redundant updates
    if (closest.index === this.previous) return

    this.previous = closest.index
    this._coordinate.set(closest)
  }

  // in CoordinateDetector
  public refresh(): void {
    this.pointer.refresh() // updates localPosition
    const pos = this.pointer.localPosition()
    if (pos) {
      this.detect(pos) // immediately run detection
    }
  }

}

// core/axial/axial-service.ts
//
// THE SLOT GRID. Slot number → hex coordinate. The renderer places the tile
// whose `index` is i at `items.get(i)`; drag-to-move, drop landing, the
// arrangement cycle and the selection marquee all read the same map, and
// `buildCoordToIndex` inverts it. It is the one place the desktop's spiral
// and the phone's rails meet: `createMatrix` builds the spiral once, and
// `project()` swaps a rail matrix in and out (documentation/
// mobile-rails-projection.md). Nothing downstream knows which answered.
import { Point } from 'pixi.js';
 import { AxialCoordinate } from './axial-coordinate.js';
import type { Settings } from '../../preferences/settings.js';

export const distance = (a: Point, b: Point): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** A slot → coordinate map from somewhere else (the rail grid). Plain
 *  numbers in; this service mints the AxialCoordinate objects itself so the
 *  static index register and the adjacency lists stay its own business. */
export type SlotMatrix = ReadonlyMap<number, { q: number; r: number }>

type Parked = {
  items: Map<number, AxialCoordinate>
  count: number
  adjacents: Map<number, AxialCoordinate[]>
}

export class AxialService {
  public count: number = 0
  public items: Map<number, AxialCoordinate> = new Map<number, AxialCoordinate>()
  public Adjacents: Map<number, AxialCoordinate[]> = new Map<number, AxialCoordinate[]>()

  private settings!: Settings
  private width: number = 0
  private height: number = 0
  private initialized = false
  /** The spiral, parked while a projection answers instead. */
  #spiral: Parked | null = null

  public initialize = (settings: Settings): void => {
    if (this.initialized) return

    this.settings = settings
    const { width, height } = this.settings.hexagonDimensions
    this.width = width
    this.height = height

    this.createMatrix()
    this.initialized = true
  }

  /** Is a projection (the phone's rails) answering instead of the spiral? */
  public get projected(): boolean {
    return this.#spiral !== null
  }

  /** How many slots the spiral holds — the size any projection should match,
   *  so every `index` the spiral could have handed out still has a slot. */
  public get capacity(): number {
    return (this.#spiral?.items ?? this.items).size
  }

  /**
   * Swap the answering matrix. `matrix` = project (slot i → its coordinate);
   * `null` = the spiral again. Re-registers every coordinate's static index
   * for the active matrix and rebuilds the adjacency lists, so `.index` reads
   * and the placement allocator agree with what `items` says. Returns whether
   * anything changed. A no-op before `initialize` — there is no spiral to
   * park yet, and the caller retries on `render:host-ready`.
   */
  public project = (matrix: SlotMatrix | null): boolean => {
    if (!this.initialized) return false

    if (matrix === null) {
      const spiral = this.#spiral
      if (!spiral) return false
      this.#spiral = null
      this.items = spiral.items
      this.count = spiral.count
      this.Adjacents = spiral.adjacents
      for (const [index, coord] of this.items) AxialCoordinate.setIndex(coord, index)
      return true
    }

    if (!this.#spiral) {
      this.#spiral = { items: this.items, count: this.count, adjacents: this.Adjacents }
    }
    const items = new Map<number, AxialCoordinate>()
    let last = -1
    for (const [slot, { q, r }] of matrix) {
      const coord = this.newCoordinate(q, r, -q - r)
      AxialCoordinate.setIndex(coord, slot)
      items.set(slot, coord)
      if (slot > last) last = slot
    }
    this.items = items
    this.count = Math.max(0, last)
    this.Adjacents = new Map<number, AxialCoordinate[]>()
    this.createAdjacencyList()
    return true
  }

  private createAdjacencyList = (): void => {
    this.items.forEach((axial, index) => {
      this.Adjacents.set(index, this.getAdjacentCoordinates(axial))
    })
  }

  public createMatrix = (): void => {
    // note: assumes settings has been set by initialize()
    const rings = this.settings.rings

    let coordinate = this.newCoordinate(0, 0, 0)
    AxialCoordinate.setIndex(coordinate, this.count)
    this.items.set(this.count, coordinate)

    for (let n = 0; n < rings; n++) {
      let axial = this.newCoordinate(this.Start.q, this.Start.r, this.Start.s)
      axial = AxialCoordinate.subtract(axial, this.newCoordinate(n, 0, n))

      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < n; j++) {
          switch (i) {
            case 0: axial = AxialCoordinate.add(axial, this.newCoordinate(1, -1, 0)); break
            case 1: axial = AxialCoordinate.add(axial, this.newCoordinate(1, 0, -1)); break
            case 2: axial = AxialCoordinate.add(axial, this.newCoordinate(0, 1, -1)); break
            case 3: axial = AxialCoordinate.add(axial, this.newCoordinate(-1, 1, 0)); break
            case 4: axial = AxialCoordinate.add(axial, this.newCoordinate(-1, 0, 1)); break
            default: axial = AxialCoordinate.add(axial, this.newCoordinate(0, -1, 1)); break
          }

          coordinate = this.newCoordinate(axial.q, axial.r, axial.s)
          AxialCoordinate.setIndex(coordinate, ++this.count)
          this.items.set(coordinate.index, coordinate)
        }
      }
    }

    // cache adjacent lists for faster lookup.
    this.createAdjacencyList()
  }

  private get Start(): AxialCoordinate {
    return this.newCoordinate(0, 0, 0)
  }

  public getAdjacentCoordinates = (axial: AxialCoordinate): AxialCoordinate[] => {
    return [
      this.newCoordinate(axial.q + 1, axial.r - 1, axial.s), // northeast
      this.newCoordinate(axial.q + 1, axial.r, axial.s - 1), // east
      this.newCoordinate(axial.q, axial.r + 1, axial.s - 1), // southeast
      this.newCoordinate(axial.q - 1, axial.r + 1, axial.s), // southwest
      this.newCoordinate(axial.q - 1, axial.r, axial.s + 1), // west
      this.newCoordinate(axial.q, axial.r - 1, axial.s + 1), // northwest
    ]
  }

  public closestAxial = (local: Point | undefined): AxialCoordinate | undefined => {
    if (!local) return undefined

    const width = this.settings.hexagonDimensions.width
    const height = this.settings.hexagonDimensions.height
    const threshold = Math.min(width / 2, (0.75 * height) / 2)

    let closest: AxialCoordinate | undefined
    let minDistance = Infinity

    for (const item of this.items.values()) {
      const dist = distance(local, item.Location)

      // note: optional short-circuit if you want a hit-test feel
      // if (dist <= threshold) return item

      if (dist < minDistance) {
        minDistance = dist
        closest = item
      }
    }

    return closest
  }

  public newCoordinate = (q: number, r: number, s: number): AxialCoordinate => {
    const coordinate = new AxialCoordinate(q, r, s)
    coordinate.width = this.width
    coordinate.height = this.height
    return coordinate
  }
}

window.ioc.register('@diamondcoreprocessor.com/AxialService', new AxialService())

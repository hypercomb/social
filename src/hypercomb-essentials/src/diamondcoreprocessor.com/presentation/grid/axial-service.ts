// diamondcoreprocessor.com/core/axial/axial-service.ts
import { Point } from 'pixi.js';
 import { AxialCoordinate } from './axial-coordinate.js';
import type { Settings } from '../../preferences/settings.js';

export const distance = (a: Point, b: Point): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export class AxialService {
  public count: number = 0
  public items: Map<number, AxialCoordinate> = new Map<number, AxialCoordinate>()
  public Adjacents: Map<number, AxialCoordinate[]> = new Map<number, AxialCoordinate[]>()

  private settings!: Settings
  private width: number = 0
  private height: number = 0
  private initialized = false

  public initialize = (settings: Settings): void => {
    if (this.initialized) return

    this.settings = settings
    const { width, height } = this.settings.hexagonDimensions
    this.width = width
    this.height = height

    this.createMatrix()
    this.initialized = true
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

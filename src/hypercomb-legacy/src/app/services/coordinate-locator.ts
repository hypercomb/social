import { Injectable, inject } from "@angular/core"
import { Point } from "pixi.js"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { AxialService } from "./axial-service"

@Injectable({ providedIn: 'root' })
export class CoordinateLocator extends PixiServiceBase {

  private readonly axialService = inject(AxialService)

  public findClosest(mousePosition: Point, searchList?: any, coordinate?: AxialCoordinate): AxialCoordinate {

    // Adjust the mouse position based on hexagon offset
    const localPosition = new Point(mousePosition.x - this.hexagonOffsetX, mousePosition.y - this.hexagonOffsetY)
    
    // Ensure the search list is an array
    searchList = searchList ?? Array.from(this.axialService.items.values())

    let minDistance = Infinity
    let closest = coordinate

    for (const axial of searchList) {
      if (!axial || !axial.Location) {
        console.warn('Invalid axial data:', axial)
        continue
      }

      // Use localPosition to maintain consistent coordinate space
      const distance = this.getDistance(localPosition, axial.Location)

      if (distance < minDistance) {
        minDistance = distance
        closest = axial
      }
    }

    return closest!
  }

  // Optimized distance calculation
  private getDistance(point: Point, location: { x: number, y: number }): number {
    return Math.hypot(point.x - location.x, point.y - location.y)
  }
}



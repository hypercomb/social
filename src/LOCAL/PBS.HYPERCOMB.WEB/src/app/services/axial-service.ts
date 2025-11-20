import { Injectable } from "@angular/core"
import { Point } from "pixi.js"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { Constants } from "../unsorted/constants"
import { Settings } from "../unsorted/settings"


export const distance = (a: Point, b: Point): number => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
}

@Injectable({ providedIn: 'root' })
export class AxialService {

    public static hexagonSide = Constants.HexagonSide
    public count: number = 0
    public items: Map<number, AxialCoordinate>
    private settings: Settings
    private width: number
    private height: number
    Adjacents: Map<number, AxialCoordinate[]> = new Map<number, AxialCoordinate[]>()

    constructor(settings: Settings) {
        this.settings = settings
        this.items = new Map<number, AxialCoordinate>()
        const { width, height } = this.settings.hexagonDimensions
        this.width = width
        this.height = height
    }

    private createAdjacencyList = () => {
        this.items.forEach((axial, index) => {
            this.Adjacents?.set(index, this.getAdjacentCoordinates(axial))
        })
    }

    public createMatrix = () => {

        const rings = this.settings.rings
        let coordinate = this.newCoordinate(0, 0, 0)
        coordinate.setIndex(this.count)
        this.items.set(this.count, coordinate)

        for (let n = 0; n < rings; n++) {
            let axial = this.newCoordinate(this.Start.q, this.Start.r, this.Start.s)
            axial = AxialCoordinate.subtract(axial, this.newCoordinate(n, 0, n))
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < n; j++) {
                    switch (i) {
                        case 0:
                            axial = AxialCoordinate.add(axial, this.newCoordinate(1, -1, 0))
                            break
                        case 1:
                            axial = AxialCoordinate.add(axial, this.newCoordinate(1, 0, -1))
                            break
                        case 2:
                            axial = AxialCoordinate.add(axial, this.newCoordinate(0, 1, -1))
                            break
                        case 3:
                            axial = AxialCoordinate.add(axial, this.newCoordinate(-1, 1, 0))
                            break
                        case 4:
                            axial = AxialCoordinate.add(axial, this.newCoordinate(-1, 0, 1))
                            break
                        default:
                            axial = AxialCoordinate.add(axial, this.newCoordinate(0, -1, 1))
                            break
                    }
                    coordinate = this.newCoordinate(axial.q, axial.r, axial.s)
                    coordinate.setIndex(++this.count)
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



    // Add a method to get adjacent coordinates
    public getAdjacentCoordinates = (axial: AxialCoordinate): AxialCoordinate[] => {
        let coordinates = [
            this.newCoordinate(axial.q + 1, axial.r - 1, axial.s), // Northeast
            this.newCoordinate(axial.q + 1, axial.r, axial.s - 1), // East
            this.newCoordinate(axial.q, axial.r + 1, axial.s - 1), // Southeast
            this.newCoordinate(axial.q - 1, axial.r + 1, axial.s), // Southwest
            this.newCoordinate(axial.q - 1, axial.r, axial.s + 1), // West
            this.newCoordinate(axial.q, axial.r - 1, axial.s + 1), // Northwest
        ]
        return coordinates
    }

    public closestAxial(local: Point | undefined): AxialCoordinate | undefined {
        if (!local) return undefined

        // calculate threshold based on hex geometry
        const width = this.settings.hexagonDimensions.width
        const height = this.settings.hexagonDimensions.height
        const threshold = Math.min(width / 2, (0.75 * height) / 2)

        let closest: AxialCoordinate | undefined
        let minDistance = Infinity

        for (const item of this.items.values()) {
            const dist = distance(local, item.Location)

                // // short-circuit: found a valid hit
                // if (dist <= threshold) {
                //     return item
                // }

            // otherwise, track closest so far
            if (dist < minDistance) {
                minDistance = dist
                closest = item
            }
        }

        return closest
    }

    public newCoordinate = (q: number, r: number, s: number): AxialCoordinate => {
        let coordinate = new AxialCoordinate(q, r, s)
        coordinate.width = this.width
        coordinate.height = this.height
        return coordinate
    }
}



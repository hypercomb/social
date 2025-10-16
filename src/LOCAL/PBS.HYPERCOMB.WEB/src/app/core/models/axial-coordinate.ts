import { inject } from "@angular/core"
import { Point } from "pixi.js"
import { Constants, } from "src/app/unsorted/constants"
import { Settings } from "src/app/unsorted/settings"

export class AxialCoordinate {
    private static axialToIndex: Map<number, number> = new Map()
    public Location: Point = new Point(0, 0)
    public color: any

    constructor(public q: number, public r: number, public s: number, public height?: number, public width?: number) {
        this.Location = this.getLocation(q, r, s)
    }

    get index(): number {
        return Number(AxialCoordinate.axialToIndex.get(this.hashCode()))
    }

    static add(a: AxialCoordinate, b: AxialCoordinate) {
        return new AxialCoordinate(a.q + b.q, a.r + b.r, a.s + b.s, a.height, a.width)
    }

    static subtract(a: AxialCoordinate, b: AxialCoordinate) {
        return new AxialCoordinate(a.q - b.q, a.r - b.r, a.s - b.s, a.height, a.width)
    }

    static equals(a: AxialCoordinate, b: AxialCoordinate) {
        if (a === b) return true
        if (!a || !b) return false
        return a.q === b.q && a.r === b.r && a.s === b.s
    }

    hashCode() {
        return this.cantorPairing(this.q, this.r)
    }

    private cantorPairing(q: number, r: number) {
        let a = q >= 0 ? 2 * q : -2 * q - 1
        let b = r >= 0 ? 2 * r : -2 * r - 1
        return ((a + b) * (a + b + 1) / 2) + b
    }

    private getLocation = (q: number, r: number, s: number): Point => {
        let xCoord = Constants.HexagonSide * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r)
        let yCoord = Constants.HexagonSide * (3.0 / 2.0 * r)
        return new Point(xCoord, yCoord)
    }

    setIndex(newIndex: number) {
        AxialCoordinate.axialToIndex.set(this.hashCode(), newIndex)
    }
}



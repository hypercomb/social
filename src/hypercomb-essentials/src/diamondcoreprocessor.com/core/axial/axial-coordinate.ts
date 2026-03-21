// diamondcoreprocessor.com/core/axial/axial-coordinate.ts
import { Point } from "pixi.js"
import { Settings } from "../settings.js"
const { get } = window.ioc

export class AxialCoordinate {
    private static axialToIndex: Map<number, number> = new Map()
    public Location: Point = new Point(0, 0)
    public color: any

    constructor(public q: number, public r: number, public s: number, public height?: number, public width?: number) {
        this.Location = AxialCoordinate.getLocation(q, r, s)
    }

    public get index(): number {
        return Number(AxialCoordinate.axialToIndex.get(this.hashCode()))
    }

    public static add(a: AxialCoordinate, b: AxialCoordinate) {
        return new AxialCoordinate(a.q + b.q, a.r + b.r, a.s + b.s, a.height, a.width)
    }

    public static subtract(a: AxialCoordinate, b: AxialCoordinate) {
        return new AxialCoordinate(a.q - b.q, a.r - b.r, a.s - b.s, a.height, a.width)
    }

   public static equals(a: AxialCoordinate, b: AxialCoordinate) {
        if (a === b) return true
        if (!a || !b) return false
        return a.q === b.q && a.r === b.r && a.s === b.s
    }

   public hashCode() {
        return AxialCoordinate.cantorPairing(this.q, this.r)
    }

    private static cantorPairing(q: number, r: number) {
        let a = q >= 0 ? 2 * q : -2 * q - 1
        let b = r >= 0 ? 2 * r : -2 * r - 1
        return ((a + b) * (a + b + 1) / 2) + b
    }

    private static getLocation = (q: number, r: number, s: number): Point => {
        const settings = get("@diamondcoreprocessor.com/Settings") as Settings

        let xCoord = settings.hexagonSide * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r)
        let yCoord = settings.hexagonSide * (3.0 / 2.0 * r)
        return new Point(xCoord, yCoord)
    }

    public static setIndex(coordinate: AxialCoordinate, newIndex: number) {
        AxialCoordinate.axialToIndex.set(coordinate.hashCode(), newIndex)
    }
}



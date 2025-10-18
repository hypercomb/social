import { Injectable, inject, effect } from "@angular/core"
import { Router } from "@angular/router"
import { HexagonEditManager } from "../unsorted/hexagons/hexagon-edit-manager"
import { LocatorService } from "../unsorted/utility/locator-service"
import { HypercombData } from "../actions/hypercomb-data"
import { Cell } from "../cells/cell"
import { HIVE_STATE } from "../shared/tokens/i-hive-store.token"
import { Tile } from "../cells/models/tile"

@Injectable({ providedIn: "root" })
export class HoneycombService extends HypercombData {
    private readonly locator = inject(LocatorService)
    private readonly router = inject(Router)
    private readonly store = inject(HIVE_STATE)

    constructor() {
        super()
        effect(() => {
            const created = this.hs.lastCreated()
            if (created) {
                // this.notifications.success(`hive "${created.name}" created`)
                this.hs.resetLastCreated()
            }
        })
    }
    // --------------------------------------------------
    // validation
    // --------------------------------------------------
    public isValid = async (sanitizedName: string) => {
        if (!sanitizedName) return false

        if (sanitizedName.length < 4) {
            // this.notifications.warning(
            //     `this hive name ${sanitizedName} must be 4 chars or more`
            // )
            return false
        }

        return true
    }

    // --------------------------------------------------
    // workflow / navigation
    // --------------------------------------------------
    public async changeLocation(location: string) {
        const [path, fragment] = location.split("#")
        await this.router.navigate([path], { fragment })
        await this.state.resetMode()
    }


    public findByLocation(location: { x: number, y: number }, tolerance = 0.001): Tile | undefined {
        const tiles = this.store.combTiles() as Tile[]
        return tiles.find(
            (c) =>
                Math.abs(c.x - location.x) <= tolerance &&
                Math.abs(c.y - location.y) <= tolerance
        )
    }

    public async findHiveNameFromUrl(): Promise<string> {
        const path = window.location.href
        return this.locator.simplifyUrl(path)
    }

    // --------------------------------------------------
    // utility
    // --------------------------------------------------
    public getHashCode(input: string): number {
        let hash = 5381
        for (let i = 0; i < input.length; i++) {
            hash = (hash * 33) ^ input.charCodeAt(i)
        }
        return hash >>> 0
    }

    public findLowestIndex = async (data: Cell[]): Promise<number> => {
        let currentIndex = 0
        // Sort the data array by index in ascending order
        const sortedData = data.sort((a, b) => a.index - b.index)

        // Find the next lowest unused index
        for (const item of sortedData) {
            if (item.index > currentIndex) {
                break // Found a gap
            }
            currentIndex++
        }
        return currentIndex
    }

    public findLowestNextIndex = async (indexes: number[]): Promise<number> => {
        if (!indexes) return 0

        // Remove duplicates and sort the indexes
        const uniqueIndexes = Array.from(new Set(indexes)).sort((a, b) => a - b)

        // Find the first gap
        let nextIndex = uniqueIndexes.find((value, index, array) => array[index + 1] !== value + 1)

        // If a gap is found, return the index after the gap
        if (nextIndex !== undefined) {
            return nextIndex + 1
        }
        else {
            return 0
        }
    }

    public findNextIndex = async (existing: number[]): Promise<number> => {

        let index = 0

        while (index < 10000) {
            if (!existing.includes(index)) {
                return index
            }
            index++
        }

        return 0
    }

}

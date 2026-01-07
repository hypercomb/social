import { Tile } from "src/app/cells/models/tile"
import { AxialCoordinate } from '../../core/models/axial-coordinate'

export interface TileDetectedPayload {
    axial: AxialCoordinate
    activeTile: Tile
}

export interface TileNotDetectedPayload {
    axial: AxialCoordinate
}


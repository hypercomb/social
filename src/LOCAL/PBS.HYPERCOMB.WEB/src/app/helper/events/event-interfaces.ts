import { Point } from "pixi.js"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { Tile } from "src/app/cells/models/tile"
import { HypercombMode } from "../../core/models/enumerations"




export interface CancelledAddingCells { }
export interface DeleteEvent { event?: KeyboardEvent }
export interface HexagonDropCompleted { }
export interface DragOverEvent { event: DragEvent }
export interface HexagonDropEvent { event: DragEvent, json: string }
export interface HexagonDropped { }
export interface HexagonLinkDroppedEvent { event: DragEvent, link: string }
export interface HexagonDetectionDetails { axial: AxialCoordinate, tile: Tile, point: Point }
export interface HypercombModeChanged { mode: HypercombMode }
export interface HypercombCancelEvent { event?: KeyboardEvent }
export interface RefreshDetectionRequested { location: Point }
export interface ScreenResizedEvent { }
export interface TileDeletedEvent { hiveId: string }





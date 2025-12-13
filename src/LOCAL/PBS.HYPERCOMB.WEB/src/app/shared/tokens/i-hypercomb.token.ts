import { InjectionToken, Signal } from "@angular/core";
import { PayloadBase } from "src/app/actions/action-contexts";
import { ActionBase } from "src/app/actions/action.base";
import { Tile } from "src/app/cells/models/tile";
import { AxialCoordinate } from "src/app/core/models/axial-coordinate";
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector";
import { Cell } from "src/app/models/cell";

export interface IActionRegistry {
    invoke<TPayload extends PayloadBase = PayloadBase>(id: string, payload?: TPayload): Promise<boolean>
    register<TPayload = unknown>(instance: ActionBase<TPayload>): void
}

export interface ICarouselService { }

export interface ICoordinateDetector {
    coordinate: Signal<AxialCoordinate | undefined>;
    activeTile: Signal<Tile | undefined>;
    emptyCoordinate: Signal<AxialCoordinate | null>;
}

export interface IClipboardState {
    clipboards: Signal<Cell[]>
    activeClipboard: Signal<Cell | null>
    activeItems: Signal<Cell[]>
    hasClipboards: Signal<boolean>
    hasActive: Signal<boolean>
}

export interface IContextMenu {
    isVisible: any;
    show(cell: Cell): Promise<void>;
    hide(): Promise<void>;
}

export interface ITileService {
        create: (coordinate: AxialCoordinate) => Promise<void>
}

export enum TOKEN_LIST {
    ACTION_REGISTRY = "ACTION_REGISTRY",
    DETECTOR_STATE = "DETECTOR_STATE",
    CLIPBOARD_STATE = "CLIPBOARD_STATE",
    CAROUSEL_SVC = "CAROUSEL_SVC",
    CONTEXT_MENU = "CONTEXT_MENU",
    COORDINATE_DETECTOR = "COORDINATE_DETECTOR"
}
export interface ITileFactory {
    create(cell: Cell): Promise<Tile>
}

export const ACTION_REGISTRY = new InjectionToken<IActionRegistry>(TOKEN_LIST.ACTION_REGISTRY)
export const CONTEXT_MENU = new InjectionToken<IContextMenu>(TOKEN_LIST.CONTEXT_MENU)
export const CLIPBOARD_STATE = new InjectionToken<IClipboardState>(TOKEN_LIST.CLIPBOARD_STATE)
export const DETECTOR_STATE = new InjectionToken<CoordinateDetector>(TOKEN_LIST.DETECTOR_STATE)
export const COORDINATE_DETECTOR = new InjectionToken<ICoordinateDetector>(TOKEN_LIST.COORDINATE_DETECTOR)
export const TILE_SERVICE = new InjectionToken<ITileService>("TILE_SERVICE")
export const TILE_FACTORY = new InjectionToken<ITileFactory>("TILE_FACTORY")
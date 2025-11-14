import { FederatedPointerEvent } from "pixi.js"
import { Cell } from "../cells/cell"
import { HypercombMode } from "../core/models/enumerations"
import { IDexieHive } from "../hive/hive-models"

export type ContextKind =
    | "cell"
    | "copy-cells"
    | "cut-cells"
    | "delete-cells"
    | "change-mode"
    | "keyboard"
    | "mouse"
    | "show"
    | "rename-hive"
    | "import-hive"

// base context is generic, defaults to Event
export interface PayloadBase<TEvent extends Event = Event> {
    event?: TEvent          // optional programmatic calls can omit
    hovered?: Cell
    kind?: ContextKind
}


// individual context variants
export interface KeyboardPayload extends PayloadBase<KeyboardEvent> {
    kind: "keyboard"
    keyboard: KeyboardEvent
}

export interface MousePayload extends PayloadBase<
    MouseEvent | PointerEvent | FederatedPointerEvent
> {
    kind: "mouse"
    mouse: MouseEvent | PointerEvent | FederatedPointerEvent
    cell?: Cell
}

export interface CellPayload extends PayloadBase {
    kind: "cell"
    cell: Cell
}

export interface CopyPayload extends PayloadBase {
    kind: "copy-cells"
    cells: Cell[],
    hasSelections: boolean
}

export interface CutPayload extends PayloadBase {
    kind: "cut-cells"
    cells: Cell[],
    hasSelections: boolean
}
export interface DeletePayload extends PayloadBase {
    kind: "delete-cells"
    cells: Cell[],
    hasSelections: boolean
}

export interface ImportHivePayload extends PayloadBase {
    kind: "import-hive"
    hive: IDexieHive
}

export interface ShowContext extends PayloadBase {
    kind: "show"
    hiveId: string
}

export interface RenameHiveContext extends PayloadBase {
    kind: "rename-hive"
    hive: { name: string }
    newName: string
}

export interface ChangeModeContext extends PayloadBase {
    kind: "change-mode"
    mode: HypercombMode
}
// discriminated union of all supported contexts
export type ActionContext =
    | PayloadBase
    | ImportHivePayload
    | ShowContext
    | KeyboardPayload
    | MousePayload
    | CellPayload
    | DeletePayload
    | CopyPayload
    | CutPayload
    | RenameHiveContext

// helpers to construct contexts
export const fromKeyboard = (
    ev: KeyboardEvent,
    payload?: unknown
): KeyboardPayload & { payload?: unknown } => ({
    kind: "keyboard",
    keyboard: ev,
    event: ev,
    ...(payload !== undefined ? { payload } : {}),
})

export const fromMouse = (
    ev: MouseEvent | PointerEvent | FederatedPointerEvent,
    cell?: Cell,
    payload?: unknown
): MousePayload & { payload?: unknown } => ({
    kind: "mouse",
    mouse: ev,
    event: ev,
    cell,
    ...(payload !== undefined ? { payload } : {}),
})

export const fromRender = (
    cell: Cell,
    payload?: unknown
): CellPayload & { payload?: unknown } => ({
    kind: "cell",
    cell,
    ...(payload !== undefined ? { payload } : {}),
})

// type guards
export const isRender = (c: ActionContext): c is CellPayload =>
    c.kind === "cell"

export const hasCellList = (c: ActionContext): c is CopyPayload => {
    return (
        c.kind === "copy-cells" &&
        Array.isArray((c as Partial<CopyPayload>).cells) &&
        (c as Partial<CopyPayload>).cells!.length > 0
    )
}


// generic event type guard
export function hasEvent<T extends Event>(
    payload: PayloadBase
): payload is PayloadBase<T> {
    return payload.event instanceof Event
}
export function getEvent<T extends Event>(payload: PayloadBase): T | undefined {
    if (hasEvent<T>(payload)) {
        return payload.event
    }
    return undefined
}
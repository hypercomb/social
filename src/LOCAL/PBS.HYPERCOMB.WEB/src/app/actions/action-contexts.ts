import { FederatedPointerEvent } from "pixi.js"
import { Cell } from "../cells/cell"
import { HypercombMode } from "../core/models/enumerations"
import { IDexieHive } from "../hive/hive-models"

export type ContextKind =
    | "cell"
    | "cell-list"
    | "change-mode"
    | "keyboard"
    | "mouse"
    | "show"
    | "rename-hive"
    | "import-hive"

// base context is generic, defaults to Event
export interface BaseContext<TEvent extends Event = Event> {
    event?: TEvent          // optional programmatic calls can omit
    hovered?: Cell
    kind?: ContextKind
}

// optional payload wrapper
export interface PayloadContext<TPayload = unknown, TEvent extends Event = Event>
    extends BaseContext<TEvent> {
    payload?: TPayload
}

// individual context variants
export interface KeyboardContext extends BaseContext<KeyboardEvent> {
    kind: "keyboard"
    keyboard: KeyboardEvent
}

export interface MouseContext extends BaseContext<
    MouseEvent | PointerEvent | FederatedPointerEvent
> {
    kind: "mouse"
    mouse: MouseEvent | PointerEvent | FederatedPointerEvent
    cell?: Cell
}

export interface CellContext extends BaseContext {
    kind: "cell"
    cell: Cell
}

export interface CellListContext extends BaseContext {
    kind: "cell-list"
    cells: Cell[]
}
export interface ImportHiveContext extends BaseContext { 
    kind: "import-hive"
    hive: IDexieHive
}

export interface ShowContext extends BaseContext {
    kind: "show"
    hiveId: string
}

export interface RenameHiveContext extends BaseContext {
    kind: "rename-hive"
    hive: { name: string }
    newName: string
}

export interface ChangeModeContext extends BaseContext {
    kind: "change-mode"
    mode: HypercombMode
}
// discriminated union of all supported contexts
export type ActionContext =
    | BaseContext
    | ImportHiveContext
    | PayloadContext
    | ShowContext
    | KeyboardContext
    | MouseContext
    | CellContext
    | CellListContext
    | RenameHiveContext

// helpers to construct contexts
export const fromKeyboard = (
    ev: KeyboardEvent,
    payload?: unknown
): KeyboardContext & { payload?: unknown } => ({
    kind: "keyboard",
    keyboard: ev,
    event: ev,
    ...(payload !== undefined ? { payload } : {}),
})

export const fromMouse = (
    ev: MouseEvent | PointerEvent | FederatedPointerEvent,
    cell?: Cell,
    payload?: unknown
): MouseContext & { payload?: unknown } => ({
    kind: "mouse",
    mouse: ev,
    event: ev,
    cell,
    ...(payload !== undefined ? { payload } : {}),
})

export const fromRender = (
    cell: Cell,
    payload?: unknown
): CellContext & { payload?: unknown } => ({
    kind: "cell",
    cell,
    ...(payload !== undefined ? { payload } : {}),
})

// type guards
export const isRender = (c: ActionContext): c is CellContext =>
    c.kind === "cell"

export const hasCellList = (c: ActionContext): c is CellListContext => {
    return (
        c.kind === "cell-list" &&
        Array.isArray((c as Partial<CellListContext>).cells) &&
        (c as Partial<CellListContext>).cells!.length > 0
    )
}


// generic event type guard
export function hasEvent<T extends Event>(
    payload: BaseContext
): payload is BaseContext<T> {
    return payload.event instanceof Event
}
export function getEvent<T extends Event>(payload: BaseContext): T | undefined {
    if (hasEvent<T>(payload)) {
        return payload.event
    }
    return undefined
}
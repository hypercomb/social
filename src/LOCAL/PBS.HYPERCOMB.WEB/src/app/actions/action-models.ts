import { Cell } from "../cells/cell"
import { Signal } from "@angular/core"

export interface ActionMeta {
  id: string
  category?: string          // groupings like "cell", "hive", "view"
  description?: string       // human-readable explanation
  risk?: "warning" | "danger" // UI can show yellow/red styling
}

export interface LayoutSource {
  getTiles(state: any): Promise<Cell[]>
  canLayout(state: any): Promise<boolean>
}

export interface RenderAction { }

export interface Action<TContext = void> {
  id: string
  label?: string
  category?: string
  description?: string
  risk?: "none" | "warning" | "danger"

  enabled?:
  | boolean
  | Signal<boolean>
  | ((ctx: TContext) => boolean | Promise<boolean>)

  run: (payload: TContext) => Promise<void>
  snapshot: () => void
}

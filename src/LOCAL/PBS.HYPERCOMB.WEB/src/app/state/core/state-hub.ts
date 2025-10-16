import { Injectable } from "@angular/core"
import { LayoutState } from "src/app/layout/layout-state"
import { StateDebugRegistry } from "src/app/unsorted/utility/debug-registry"
import { EditorService } from "../interactivity/editor-service"
import { HypercombState } from "./hypercomb-state"

@Injectable({
  providedIn: 'root'
})
export class StateHub {
  constructor(public es: EditorService, public hs: HypercombState, public ls: LayoutState) {
    StateDebugRegistry.expose('es', es)
    StateDebugRegistry.expose('ls', ls)
    StateDebugRegistry.expose('hs', hs)
  }
}



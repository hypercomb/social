import { Injectable } from "@angular/core"
import { LayoutState } from "src/app/layout/layout-state"
import { EditorService } from "../interactivity/editor-service"
import { HypercombState } from "./hypercomb-state"
import { DebugService } from "src/app/core/diagnostics/debug-service"

@Injectable({
  providedIn: 'root'
})
export class StateHub {
  constructor(public es: EditorService, public hs: HypercombState, public ls: LayoutState) {
    DebugService.expose('es', es)
    DebugService.expose('ls', ls)
    DebugService.expose('hs', hs)
  }
}



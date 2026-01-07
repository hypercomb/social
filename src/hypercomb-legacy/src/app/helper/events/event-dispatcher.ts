import { inject, Injectable } from "@angular/core"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { HypercombMode } from "../../core/models/enumerations"
import { appEvents } from "src/app/core/generic-event-bus"
import { Events } from "./events"

@Injectable({ providedIn: "root" })
export class EventDispatcher {
  private readonly state = inject(HypercombState)

  public hexagonDropCompleted() {
    appEvents.dispatch(Events.HexagonDropCompleted, {})
  }


  public cancelEvent(event: any) {
    appEvents.dispatch(Events.EscapeCancel, { event })
    this.state.resetMode()
  }

  public notifyLocked() {
    appEvents.dispatch(Events.NotifyLocked, {})
  }

  public tileDeleted(hiveId: string) {
    appEvents.dispatch(Events.TileDeleted, { hiveId })
  }
}

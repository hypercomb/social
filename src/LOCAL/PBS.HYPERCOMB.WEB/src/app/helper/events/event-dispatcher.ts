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

  public cancelPanning() {
    // add CancelPanning if you want it distinct in AppEvents
    appEvents.dispatch(Events.PanningThreshold, { dx: 0, dy: 0 })
  }

  public cancelEvent(event: any) {
    appEvents.dispatch(Events.EscapeCancel, { event })
    this.state.resetMode()
  }

  public panningThresholdAttained(dx: number = 0, dy: number = 0) {
    appEvents.dispatch(Events.PanningThreshold, { dx, dy })
  }

  public notifyLocked() {
    appEvents.dispatch(Events.NotifyLocked, {})
  }

  public tileDeleted(hiveId: string) {
    appEvents.dispatch(Events.TileDeleted, { hiveId })
  }
}

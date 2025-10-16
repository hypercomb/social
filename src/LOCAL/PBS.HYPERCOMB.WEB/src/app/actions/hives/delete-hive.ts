import { inject } from "@angular/core"
import { HIVE_STATE } from "src/app/shared/tokens/i-hive-store.token"
import { COMB_SERVICE } from "src/app/shared/tokens/i-comb-store.token"
import { NotificationService } from "src/app/unsorted/utility/notification-service"
import { KeyboardContext } from "../action-contexts"
import { ActionBase } from "../action.base"

export class DeleteHiveAction extends ActionBase<KeyboardContext> {

  public override id = "hive.delete"
  public override label = "Delete Hive"
  public override description = "Delete the currently focused hive and all its cells"
  public override category = "Hive"

  public override enabled = (): boolean => true

  public override run = async (payload: KeyboardContext): Promise<void> => {
    const hivestate = inject(HIVE_STATE)
    const modify = inject(COMB_SERVICE)
    const notifications = inject(NotificationService)

    const title = `Confirm Delete Hive`
    const message = `Are you sure you want to delete this hive and all its cells?`
    const options = { labels: { confirm: title } }

    // notifications.confirm(
    //   message,
    //   async () => {
    //     modify.(payload.hovered)

    //     // 📝 TODO: choose a sensible fallback head or navigate
    //     // const fallback = hivestate.items()[0]
    //     // if (fallback) ...
    //   },
    //   () => notifications.info("Delete hive cancelled!"),
    //   options
    // )
    throw new Error("Not implemented")
  }
}

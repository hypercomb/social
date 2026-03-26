// remove-cells.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { ActionBase } from "src/app/actions/action.base"
import { CLIPBOARD_REPOSITORY } from "src/app/shared/tokens/i-clipboard-repository"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-honeycomb-service.token"
import { RemovePayload } from "../action-contexts"

@Injectable({ providedIn: "root" })
export class RemoveCellsAction extends ActionBase<RemovePayload> {
  public readonly hydration = inject(HIVE_HYDRATION)
  public readonly repository = inject(CLIPBOARD_REPOSITORY)
  public static ActionId = "tile.remove"
  public override id = RemoveCellsAction.ActionId
  public override label = "Remove Cell(s)"
  public override description = "Remove one or more cells and their hierarchy unless blocked by host"
  public override category = "Editing"
  public override risk: "danger" = "danger"

  private readonly hypercomb = inject(HypercombState)

  private readonly blockedHosts = ["hypercomb.io", "localhost:4200"]

  public override enabled = async (payload: RemovePayload): Promise<boolean> => {
    if (!payload.cells?.length) return false

    // protect special links
    const allowed = payload.cells.every(
      (cell) =>
        !cell.link ||
        this.blockedHosts.every((host) => !cell.link!.includes(host))
    )

    return allowed && this.hypercomb.hasMode(HypercombMode.Normal)
  }

  public override run = async (payload: RemovePayload): Promise<void> => {
    for (const cell of payload.cells) {
      if (!cell.seed) continue
      const hierarchy = await this.repository.fetchHierarchy(cell.seed)
      await this.modify.deleteAll(cell, hierarchy)
      this.hydration.invalidateTile(cell.seed)
    }
  }
}

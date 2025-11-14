// actions/pathway.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "../../core/models/enumerations"
import { CellPayload } from "../action-contexts"
import { ActionBase } from "../action.base"
import { LocatorService } from "src/app/services/locator-service"

const getPath = (link: string): string | null => {
  const domain = "localhost:4200"
  const match = link.match(
    new RegExp(`^https?:\/\/(?:[a-z0-9-]+\\.)?${domain}\/(.+)$`, "i")
  )
  return match ? match[1] : null
}

@Injectable({ providedIn: "root" })
export class RiftAction extends ActionBase<CellPayload> {
  private readonly locator = inject(LocatorService)

  public id = "cell.path"
  public override label = "Path"
  public override description = "Navigate to a linked pathway inside this hive"
  public override category = "Navigation"

  public override enabled = async (ctx: CellPayload): Promise<boolean> => {
    const path = getPath(ctx.cell.link)
    return (
      !!path &&
      this.state.hasMode(HypercombMode.Normal) &&
      !this.state.hasMode(HypercombMode.ViewingClipboard) &&
      !this.state.isCommandMode()
    )
  }

  public override run = async(ctx: CellPayload) => {
    const path = getPath(ctx.cell.link)
    if (!path) return

    history.replaceState(history.state, "", path)
    await this.locator.changeLocation(path)
  }
}

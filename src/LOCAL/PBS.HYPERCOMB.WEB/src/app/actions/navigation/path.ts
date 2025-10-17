// actions/pathway.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "../../core/models/enumerations"
import { CellContext } from "../action-contexts"
import { HoneycombService } from "src/app/hive/honeycomb-service"
import { ActionBase } from "../action.base"

const getPath = (link: string): string | null => {
  const domain = "localhost:4200"
  const match = link.match(
    new RegExp(`^https?:\/\/(?:[a-z0-9-]+\\.)?${domain}\/(.+)$`, "i")
  )
  return match ? match[1] : null
}

@Injectable({ providedIn: "root" })
export class PathwayAction extends ActionBase<CellContext> {
  private readonly honeycomb = inject(HoneycombService)

  public id = "cell.path"
  public override label = "Path"
  public override description = "Navigate to a linked pathway inside this hive"
  public override category = "Navigation"

  public override enabled = async (ctx: CellContext): Promise<boolean> => {
    const path = getPath(ctx.cell.link)
    return (
      !!path &&
      this.state.hasMode(HypercombMode.Normal) &&
      !this.state.hasMode(HypercombMode.ViewingClipboard) &&
      !this.state.isCommandMode()
    )
  }

  public override run = async(ctx: CellContext) => {
    const path = getPath(ctx.cell.link)
    if (!path) return

    history.replaceState(history.state, "", path)
    await this.honeycomb.changeLocation(path)
  }
}

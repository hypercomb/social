// actions/view-photo.action.ts
import { Injectable, inject } from "@angular/core"
import { CellPayload } from "../action-contexts"
import { HypercombMode } from "../../core/models/enumerations"
import { PhotoState } from "src/app/state/feature/photo-state"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ViewPhotoAction extends ActionBase<CellPayload> {
  public id = "tile.photo"

  private readonly photoState = inject(PhotoState)

  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    const link = (payload.cell || payload.hovered)?.link
    if (!link) return false

    if (!this.state.hasMode(HypercombMode.Normal)) return false
    if (this.state.hasMode(HypercombMode.ViewingClipboard)) return false
    if (this.state.isCommandMode()) return false

    const imageFormats = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "jfif"]
    const ext = link.split(".").pop()?.toLowerCase()
    return !!ext && imageFormats.includes(ext)
  }

  public run = async (payload: CellPayload) => {
    const link = payload.cell?.link
    if (!link) return
    this.photoState.imageUrl = link

  }
}

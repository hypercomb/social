// actions/show-chat-window.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "../../core/models/enumerations"
import { CellPayload } from "../action-contexts"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ToggleChatWindowAction extends ActionBase<CellPayload> {
  public id = "toggle.chat-window"

  // Optional: you can also add a nice icon later
  // public icon = "chat_bubble_outline"

  /** Always available in normal mode (or tweak as needed) */
  public override enabled = async (ctx: CellPayload): Promise<boolean> => {
    return this.state.hasMode(HypercombMode.Normal)
  }

  /** Simply toggle the chat mode on → opens the chat window */
  public run = async (ctx: CellPayload) => {
    this.state.setMode(HypercombMode.ShowChat)
  }
}
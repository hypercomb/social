// shortcut-registry.ts

import { Injectable, inject } from "@angular/core"
import { ActionRegistry } from "../actions/action-registry"
import { IShortcutBinding } from "./shortcut-model"
import { ActionContext } from "../actions/action-contexts"
import { CoordinateDetector } from "../helper/detection/coordinate-detector"
import { Cell } from "../cells/cell"
import { PayloadInfuser } from "./payload-infuser"
import { ACTION_REGISTRY } from "../shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: 'root' })
export class ShortcutRegistry {
  private readonly infuser = inject(PayloadInfuser)
  private readonly detector = inject(CoordinateDetector)
  private bindings: IShortcutBinding[] = []
  private actions = inject(ACTION_REGISTRY)

  // convenience passthrough so existing code can call invoke via shortcuts
  async invoke<T extends ActionContext = ActionContext>(cmdId: string, ctx: T) {
    return this.actions.invoke<T>(cmdId, ctx)
  }

  //#region Key Handling

 bind<T = any>(binding: IShortcutBinding<T>): () => void {
    this.bindings.push(binding)
    this.bindings.sort((a, b) => b.priority - a.priority)
    return () => { this.bindings = this.bindings.filter(x => x !== binding) }
  }

  async handleKeydown(ev: KeyboardEvent) {
    const combo = this.serialize(ev)
    const matches = this.bindings.filter(b => b.keys === combo)
    const tile = this.detector.activeTile()


    let cell: Cell | undefined = undefined
    for (const b of matches) {
      let payload = b.toPayload ? b.toPayload(ev) : (ev as any)

      if (tile) {
        payload = this.infuser.infuse(payload, tile)
        await this.actions.invoke(b.cmdId, { cell, ...payload })
      }
      else {
        await this.actions.invoke(b.cmdId, { ...payload })
      }
    }
  }
  private serialize(ev: KeyboardEvent): string {
    const parts: string[] = []
    if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl')
    if (ev.shiftKey) parts.push('Shift')
    if (ev.altKey) parts.push('Alt')
    parts.push(ev.key.length === 1 ? ev.key.toUpperCase() : ev.key)
    return parts.join('+')
  }

  //#endregion
}



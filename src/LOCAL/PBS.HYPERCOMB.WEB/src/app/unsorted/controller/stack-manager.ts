
import { Inject, inject, Injectable } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { IDexieHive } from "src/app/hive/hive-models"
import { StackEntry } from "src/app/models/stack-entry"
import { ContextStack } from "./context-stack"

@Injectable({ providedIn: "root" })
export class StackManager {
  private readonly stack = inject(ContextStack)

  public refresh(cell: Cell, hive: IDexieHive): void {
    this.stack.update(list => {
      const idx = list.findIndex(e => e.hive.name === hive.name)
      if (idx === -1) return list // nothing to refresh

      // replace with new StackEntry referencing the updated hive
      const updated = new StackEntry(hive, true)
      const next = [...list]
      next[idx] = updated
      return next
    })
  }
}

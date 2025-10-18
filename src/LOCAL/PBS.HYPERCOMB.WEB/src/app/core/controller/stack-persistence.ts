import { Injectable, effect } from "@angular/core"
import { ContextStack } from "./context-stack"
import { StackEntry } from "src/app/models/stack-entry"
import { StorageManager } from "src/app/helper/storage-manager"

@Injectable({ providedIn: "root" })
export class StackPersistence {
  private static readonly storageKey = "ContextStack"

  constructor(
    private readonly stack: ContextStack,
    private readonly storage: StorageManager
  ) {
    // auto-save on every stack change
    effect(() => {
      const ids = this.stack.snapshot().map(e => ({
        cellId: e.cellId,
        hive: e.hive,
      }))
      this.storage.set(StackPersistence.storageKey, ids)
    })
  }

  public load(): void {
    const cached = this.storage.get<{ cellId: number; hive: string }[]>(
      StackPersistence.storageKey
    )
    if (!cached) return

    try {
      const entries = cached.map(v => new StackEntry(v.cellId, v.hive))
      this.stack.restore(entries)
    } catch {
      this.stack.clear()
    }
  }

  public clear(): void {
    this.storage.remove(StackPersistence.storageKey)
    this.stack.clear()
  }
}

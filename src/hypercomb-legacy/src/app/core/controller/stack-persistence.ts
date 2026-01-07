import { Injectable, effect } from "@angular/core"
import { ParentContext } from "./context-stack"
import { StackEntry } from "src/app/models/stack-entry"
import { StorageManager } from "src/app/helper/storage-manager"

@Injectable({ providedIn: "root" })
export class StackPersistence {
  private static readonly storageKey = "ParentContext"

  constructor(
    private readonly stack: ParentContext,
    private readonly storage: StorageManager
  ) {
    // auto-save on every stack change
    effect(() => {
      const ids = this.stack.snapshot().map(e => ({
        seed: e.seed,
        hive: e.hive,
      }))
      this.storage.set(StackPersistence.storageKey, ids)
    })
  }

  public load(): void {
    const cached = this.storage.get<{ seed: string; hive: string }[]>(
      StackPersistence.storageKey
    )
    if (!cached) return

    try {
      const entries = cached.map(v => new StackEntry(v.seed, v.hive))
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

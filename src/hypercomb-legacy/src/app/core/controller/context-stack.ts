import { Injectable, signal, computed } from "@angular/core"
import { StackEntry } from "src/app/models/stack-entry"
import { HashService } from "src/app/hive/storage/hash.service"

@Injectable({ providedIn: "root" })
export class ParentContext {

  private readonly _stack = signal<StackEntry[]>([])
  private readonly capacity = 50

  // ---------------------------------------------------
  // computed seed: top-of-stack OR fallback to Hypercomb
  // ---------------------------------------------------
  public readonly top = computed(() => this._stack().at(-1) ?? undefined)

  public readonly seed = computed(() => {
    const top = this.top()
     return top?.seed || null
  })

  public readonly entries = computed(() => [...this._stack()].reverse())
  public readonly size = computed(() => this._stack().length)
  public readonly navigating = signal(false)

  // ---------------------------------------------------
  // push
  // ---------------------------------------------------
  public push(seed: string): void {
    this.navigating.set(true)

    const entry = new StackEntry(seed)

    this._stack.update(list => {
      const last = list.at(-1)
      if (last && last.seed === seed) return list
      const next = [...list, entry]
      if (next.length > this.capacity) next.shift()
      return next
    })

    this.navigating.set(false)
  }

  // ---------------------------------------------------
  // pop
  // ---------------------------------------------------
  public canPop(): boolean {
    return this._stack().length > 1
  }

  public pop(): StackEntry | undefined {
    this.navigating.set(true)
    try {
      if (!this.canPop()) return undefined

      let popped: StackEntry | undefined
      this._stack.update(list => {
        popped = list.at(-1)
        return list.slice(0, -1)
      })
      return popped
    } finally {
      this.navigating.set(false)
    }
  }

  // ---------------------------------------------------
  // maintenance
  // ---------------------------------------------------
  public clear(): void {
    this._stack.set([])
  }

  public doneNavigating(): void {
    this.navigating.set(false)
  }

  public refresh(seed: string): void {
    this._stack.update(list => {
      const idx = list.findIndex(e => e.seed === seed)
      if (idx === -1) return list
      const next = [...list]
      next[idx] = new StackEntry(seed)
      return next
    })
  }

  public restore(entries: StackEntry[]): void {
    this._stack.set(entries.slice(-this.capacity))
  }

  public snapshot(): StackEntry[] {
    return this._stack()
  }
}

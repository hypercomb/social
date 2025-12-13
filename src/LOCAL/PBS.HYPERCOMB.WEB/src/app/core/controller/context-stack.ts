import { Injectable, signal, computed } from "@angular/core"
import { StackEntry } from "src/app/models/stack-entry"
import { HashService } from "src/app/hive/storage/hashing-service"

@Injectable({ providedIn: "root" })
export class ParentContext {

  private readonly _stack = signal<StackEntry[]>([])
  private readonly capacity = 50

  // ---------------------------------------------------
  // computed gene: top-of-stack OR fallback to Hypercomb
  // ---------------------------------------------------
  public readonly top = computed(() => this._stack().at(-1) ?? undefined)

  public readonly gene = computed(() => {
    const top = this.top()
     return top?.gene || null
  })

  public readonly entries = computed(() => [...this._stack()].reverse())
  public readonly size = computed(() => this._stack().length)
  public readonly navigating = signal(false)

  // ---------------------------------------------------
  // push
  // ---------------------------------------------------
  public push(gene: string): void {
    this.navigating.set(true)

    const entry = new StackEntry(gene)

    this._stack.update(list => {
      const last = list.at(-1)
      if (last && last.gene === gene) return list
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

  public refresh(gene: string): void {
    this._stack.update(list => {
      const idx = list.findIndex(e => e.gene === gene)
      if (idx === -1) return list
      const next = [...list]
      next[idx] = new StackEntry(gene)
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

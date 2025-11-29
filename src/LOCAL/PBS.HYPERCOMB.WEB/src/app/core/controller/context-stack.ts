import { Injectable, signal, computed } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { StackEntry } from "src/app/models/stack-entry"

@Injectable({ providedIn: "root" })
export class ContextStack {
  private readonly _stack = signal<StackEntry[]>([])
  private readonly capacity = 50

  // derived signals
  public readonly top = computed(() => this._stack().at(-1) ?? undefined)
  public readonly cell = computed(() => this.top()?.cell ?? undefined)
  public readonly hiveName = computed(() => this.cell()?.hive ?? undefined)
  public readonly entries = computed(() => [...this._stack()].reverse())
  public readonly size = computed(() => this._stack().length)

  // navigation flag
  public readonly navigating = signal(false)
  public push(cell: Cell): void {
    this.navigating.set(true)
    const entry = new StackEntry(cell.cellId, cell.hive, cell)

    this._stack.update(list => {
      const last = list.at(-1)

      if (last && last.cellId === entry.cellId && last.hive === entry.hive) {
        return list
      }

      const next = [...list, entry]
      if (next.length > this.capacity) next.shift()
      return next
    })

    this.navigating.set(false)
  }

  public canPop(): boolean {
    const list = this._stack()
    return list.length > 1
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


  // ─────────────────────────────────────────────
  // maintenance
  // ─────────────────────────────────────────────

  public clear(): void {
    this._stack.set([])
  }

  public doneNavigating(): void {
    this.navigating.set(false)
  }

  public refresh(cell: Cell): void {
    this._stack.update(list => {
      const idx = list.findIndex(e => e.cellId === cell.cellId && e.hive === cell.hive)
      if (idx === -1) return list // nothing to refresh

      const updated = new StackEntry(cell.cellId, cell.hive, cell)
      const next = [...list]
      next[idx] = updated
      return next
    })
  }

  public restore(entries: StackEntry[]): void {
    this._stack.set(entries.slice(-this.capacity))
  }

  public snapshot(): StackEntry[] {
    return this._stack()
  }

  public toString(): string {
    const list = this._stack()
    if (!list.length) return '[ContextStack empty]'

    const lines: string[] = []

    lines.push(`ContextStack(size=${list.length}, navigating=${this.navigating()})`)
    lines.push(`top: hive=${this.hiveName() ?? 'none'} cellId=${this.cell()?.cellId ?? 'none'}`)
    lines.push('entries:')

    list.forEach((e, i) => {
      const mark = (i === list.length - 1) ? ' <— top' : ''
      lines.push(
        `[${i}] hive=${e.hive} cellId=${e.cellId}${mark}`
      )
    })

    return lines.join('\n')
  }
}

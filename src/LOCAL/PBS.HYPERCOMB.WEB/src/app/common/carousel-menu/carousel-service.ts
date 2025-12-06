import { Injectable, computed, signal, inject } from '@angular/core'
import { Router } from '@angular/router'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { IDexieHive } from 'src/app/hive/hive-models'

@Injectable({ providedIn: 'root' })
export class CarouselService extends Hypercomb {
  private readonly router = inject(Router)

  private readonly _items = signal<IDexieHive[]>([])
  private readonly _index = signal(0)
  private readonly _tileLimit = signal(5)
  private readonly _previous = signal<IDexieHive | null>(null)
  private readonly _changeSeq = signal(0)

  public readonly previousHive = this._previous.asReadonly()
  public readonly changeSeq = this._changeSeq.asReadonly()

  // current hive is always the head of the internal list
  public readonly current = computed(() => this._items()[0] ?? null)

  public readonly upper = computed(() => {
    const items = this._items()
    if (items.length <= 1) return []
    const limit = Math.min(this._tileLimit(), items.length - 1)
    return items.slice(1, 1 + limit).reverse()
  })

  public readonly lower = computed(() => {
    const items = this._items()
    if (items.length <= 1) return []
    const limit = Math.min(this._tileLimit(), items.length - 1)
    return items.slice(-limit).reverse()
  })

  // keep the current hive at the head when refreshing items
  // this prevents the menu from "snapping back" after a navigation or filter change
  public setItems = (items: IDexieHive[]): void => {
    const incoming = items ?? []
    const current = this.current()

    this._previous.set(current)

    if (current) {
      const idx = incoming.findIndex(h => h.name === current.name)
      if (idx >= 0) {
        const reordered = [
          incoming[idx],
          ...incoming.slice(0, idx),
          ...incoming.slice(idx + 1),
        ]
        this._items.set(reordered)
        this._index.set(0)
      } else {
        this._items.set(incoming)
        this._index.set(0)
      }
    } else {
      this._items.set(incoming)
      this._index.set(0)
    }

    this._changeSeq.update(v => v + 1)
  }

  public setTileLimit = (limit: number): void =>
    this._tileLimit.set(Math.max(1, limit))

  // accepts:
  // "crypto#1000"
  // "/crypto#1000"
  // "crypto"
  public jumpTo = (name: string): void => {
    if (!name) return

    const raw = name.startsWith('/') ? name.slice(1) : name
    const [base, fragment] = raw.split('#')

    if (!base) return

    void this.router.navigate([base], {
      fragment: fragment || undefined
    })
  }

  public setHive = (name: string): void => {
    if (!name) return

    const items = this._items()
    const idx = items.findIndex(h => h.name === name)
    if (idx < 0) return

    const reordered = [items[idx], ...items.slice(0, idx), ...items.slice(idx + 1)]
    this._items.set(reordered)
    this._index.set(0)
    this._changeSeq.update(v => v + 1)
  }

  public next = (): void => {
    const items = this._items()
    if (items.length <= 1) return

    this._previous.set(items[0])
    this._items.set([...items.slice(1), items[0]])
    this._changeSeq.update(v => v + 1)
  }

  public previous = (): void => {
    const items = this._items()
    if (items.length <= 1) return

    this._previous.set(items[0])
    this._items.set([items[items.length - 1], ...items.slice(0, -1)])
    this._changeSeq.update(v => v + 1)
  }

  public items(): IDexieHive[] {
    return this._items()
  }
}

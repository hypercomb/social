import { Injectable, computed, signal, inject, untracked } from '@angular/core'
import { Router } from '@angular/router'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { IDexieHive } from 'src/app/hive/hive-models'

@Injectable({ providedIn: 'root' })
export class CarouselService extends Hypercomb {
  private readonly router = inject(Router)

  private readonly _items = signal<IDexieHive[]>([])
  private readonly _index = signal(0)
  private readonly _tileLimit = signal(4)
  private readonly _previous = signal<IDexieHive | null>(null)
  

  public readonly previousHive = this._previous.asReadonly()

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

  // ─────────────────────────────────────────────
  // public api
  // ─────────────────────────────────────────────

  /** set a new hive list, preserving the previous head as previous */
  public setItems = (items: IDexieHive[]): void => {
    const current = this.current()
    this._previous.set(current)
    this._items.set(items ?? [])
    if (current) {
      const keep = items.findIndex(h => h.name === current.name)
      this._index.set(keep >= 0 ? keep : 0)
    } else {
      this._index.set(0)
    }
  }

  public setTileLimit = (limit: number): void =>
    this._tileLimit.set(Math.max(1, limit))


  /** navigate to new hive route */
  public jumpTo = (name: string): void => {
    if (!name) return
    const [base, fragment] = name.split('#')
    const url = `/${base}${fragment ? `#${fragment}` : ''}`
    this.router.navigateByUrl(url)
  }

  public setHive = (name: string): void => {

    if (!name) return
    const items = this._items()
    const idx = items.findIndex(h => h.name === name)
    if (idx < 0) return

    // move the selected hive to the 0 index
    const reordered = [items[idx], ...items.slice(0, idx), ...items.slice(idx + 1)]
    this._items.set(reordered)
    this._index.set(0)
  }


  /** rotation helpers remain for visual state only */
  public next = (): void => {
    const items = this._items()
    if (items.length <= 1) return
    this._previous.set(items[0])
    this._items.set([items[items.length - 1], ...items.slice(0, -1)])
  }

  public previous = (): void => {
    const items = this._items()
    if (items.length <= 1) return
    this._previous.set(items[0])
    this._items.set([...items.slice(1), items[0]])
  }
}

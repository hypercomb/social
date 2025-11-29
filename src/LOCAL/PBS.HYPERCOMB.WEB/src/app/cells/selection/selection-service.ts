import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { fromEvent } from 'rxjs'
import { CellOptions } from 'src/app/core/models/enumerations'
import { Cell } from '../cell'
import { isSelected } from '../models/cell-filters'
import { HypercombState } from 'src/app/state/core/hypercomb-state'
import { HONEYCOMB_STORE } from 'src/app/shared/tokens/i-comb-store.token'
import { PixiServiceBase } from 'src/app/pixi/pixi-service-base'
import { Assets } from 'pixi.js'
import { Events } from 'src/app/helper/events/events'
import { ISelections } from 'src/app/shared/tokens/i-selection.token'
import { MODIFY_COMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'

@Injectable({ providedIn: 'root' })
export class SelectionService extends PixiServiceBase implements ISelections {
  private readonly modify = inject(MODIFY_COMB_SVC)
  private readonly destroyRef = inject(DestroyRef)
  private readonly store = inject(HONEYCOMB_STORE)
  private readonly hs = inject(HypercombState)

  // override lets clipboard mode (or other tools) bypass Ctrl requirement
  private readonly override = signal(false)
  public readonly canSelect = computed(() => this.ks.primary() || this.override())

  // derived selection state directly from store
  public readonly items = computed(() =>
    this.store.cells().filter(isSelected)
  )

  public readonly hasItems = computed(() => this.items().length > 0)
  public readonly latest = computed(() => {
    const arr = this.items()
    return arr.length ? arr[arr.length - 1] : null
  })

  // guard so we don’t double-arm the one-shot blocker
  private upBlockerArmed = false

  constructor() {
    super()

    // escape clears selection
    document.addEventListener(Events.EscapeCancel, () => this.clear())

    // blur cancels override
    fromEvent(window, 'blur')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.override.set(false))
  }


  // ----------------- selection mutators -----------------

  public async add(cell: Cell) {
    cell.options.update((options) => options | CellOptions.Selected)
    await this.invalidate(cell)
  }

  public async remove(cell: Cell) {
    cell.options.update((options) => options & ~CellOptions.Selected)
    await this.invalidate(cell)
  }

  public async toggle(cell: Cell) {
    if (!cell) return
    isSelected(cell) ? await this.remove(cell) : await this.add(cell)
  }

  public async clear(): Promise<void> {
    const selected = this.store.cells()
      .filter(c => (c.options() & CellOptions.Selected) !== 0)

    for (const cell of selected) {
      // remove the Selected flag
      cell.options.update(options => options & ~CellOptions.Selected)

      // invalidate or refresh as before
      await this.invalidate(cell)
    }
  }

  public isSelected(cellId: number): boolean {
    return this.items().some(cell => cell.cellId === cellId)
  }

  // clipboard (or any feature) toggles this
  public setCanSelect(can: boolean) {
    this.override.set(can)
  }

  private async invalidate(cell: Cell) {
    // remove old cache + force Pixi redraw
    let tile = this.store.lookupTile(cell.cellId)
    const key = this.hs.cacheId(cell)
    Assets.cache.remove(key)

    tile?.invalidate()
    this.modify.updateCell(cell)  
  }
}

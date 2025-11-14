import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { fromEvent } from 'rxjs'
import { CellOptions } from 'src/app/core/models/enumerations'
import { Cell } from '../cell'
import { isSelected } from '../models/cell-filters'
import { HypercombState } from 'src/app/state/core/hypercomb-state'
import { COMB_STORE } from 'src/app/shared/tokens/i-comb-store.token'
import { PixiServiceBase } from 'src/app/pixi/pixi-service-base'
import { Assets } from 'pixi.js'
import { Events } from 'src/app/helper/events/events'
import { ISelections } from 'src/app/shared/tokens/i-selection.token'
import { TILE_FACTORY } from 'src/app/shared/tokens/i-hypercomb.token'

@Injectable({ providedIn: 'root' })
export class SelectionService extends PixiServiceBase implements ISelections {
  private readonly destroyRef = inject(DestroyRef)
  private readonly factory = inject(TILE_FACTORY)
  private readonly store = inject(COMB_STORE)
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

  // selection flags
  private _isSelecting = signal(false)
  public readonly isSelecting = this._isSelecting.asReadonly()

  // suppress-next-up flag → avoids navigation on the immediate pointerUp after selection
  private _suppressNextUp = signal(false)
  public readonly suppressNextUp = this._suppressNextUp.asReadonly()

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

  /** called when selection mode begins */
  public beginSelection() {
    this._isSelecting.set(true)
  }

  /** called when selection finishes (ctrl released or explicit end) */
  public finishSelection() {
    if (!this._isSelecting()) return
    this._isSelecting.set(false)
    this._suppressNextUp.set(true)
    this.armOneShotUpBlocker()
  }

  /** one-shot DOM capture blocker for the next pointerup/click */
  private armOneShotUpBlocker() {
    if (this.upBlockerArmed) return
    this.upBlockerArmed = true

    const cleanup = () => {
      window.removeEventListener('pointerup', consume, true)
      window.removeEventListener('click', consume, true)
      window.removeEventListener('pointercancel', consume, true)
      this._suppressNextUp.set(false)
      this.upBlockerArmed = false
    }

    const consume = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      cleanup()
    }

    window.addEventListener('pointerup', consume, true)
    window.addEventListener('click', consume, true)
    window.addEventListener('pointercancel', consume, true)

    // safety fallback: auto-clean if no events fire
    setTimeout(cleanup, 200)
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
    tile = await this.factory.create(cell)
    this.pixi.container?.addChild(tile)
  }
}

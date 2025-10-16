import { Injectable, signal, computed, inject } from "@angular/core"
import { EditorMode } from "src/app/core/models/enumerations"
import { Cell, EditCell, NewCell } from "src/app/cells/cell"
import { isNewHive } from "src/app/cells/models/cell-filters"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { ImageService } from "src/app/database/images/image-service"

@Injectable({ providedIn: "root" })
export class EditorService {


  private readonly images = inject(ImageService)
  
  // internal state
  private readonly _mode = signal<EditorMode>(EditorMode.None)
  private readonly _context = signal<EditCell | null>(null)
  private readonly _dragOver = signal(false)
  private readonly _initialScale = signal<number | undefined>(undefined)
  private readonly _selectedColor = signal<string | null>(null)
  private readonly _tileColor = signal<string | null>(null)
  private readonly _debug = signal(false)
  // tile visuals
  private readonly _borderColorTile = signal<Cell | null>(null)
  private readonly _branchTile = signal<Cell | null>(null)
  private readonly _backgroundTile = signal<Cell | null>(null)
  public readonly isEditing = computed(() => this._context() !== null)

  // readonly selectors
  public readonly mode = this._mode.asReadonly()
  public readonly context = this._context.asReadonly()
  public readonly dragOver = this._dragOver.asReadonly()
  public readonly initialScale = this._initialScale.asReadonly()
  public readonly selectedColor = this._selectedColor.asReadonly()
  public readonly borderColorTile = this._borderColorTile.asReadonly()
  public readonly branchTile = this._branchTile.asReadonly()
  public readonly backgroundTile = this._backgroundTile.asReadonly()
  public readonly debug = this._debug.asReadonly()


  // derived properties
  public readonly isSwatchMode = computed(() => (this._mode() & EditorMode.Swatch) !== 0)
  public isNewHive = computed(() => {
    const cell = this._context()
    if (!cell) return false
    return isNewHive(cell)
  })

  public rendered = signal(false)


  // setters
  public setMode(mode: EditorMode) {
    this._mode.set(mode)
  }

  public setContext = async (cell: Cell | null) => {
    if (!cell) {
      this._context.set(null)
      return
    }

    const context = Object.create(Object.getPrototypeOf(cell)) as EditCell
    Object.assign(context, cell)
    context.originalImage = <IHiveImage>{ ...cell.image }
    context.image = <IHiveImage>{ ...cell.image }
    const large  = await this.images.loadForCell(cell, 'large')
    context.largeImage = large || cell.image
    
    this._context.set(context)
  }

  public setDragOver(over: boolean) {
    this._dragOver.set(over)
  }

  public setInitialScale(scale: number) {
    this._initialScale.set(scale)
  }

  // tile update triggers
  public updateBorderVisual(cell: Cell) {
    this._borderColorTile.update(() => cell)
  }

  public updateBranchVisual(cell: Cell) {
    this._branchTile.update(() => cell)
  }

  public updateBackgroundVisual(cell: Cell) {
    this._backgroundTile.update(() => cell)
  }

  // debug togglesthis.
  public enableDebug() {
    this._debug.set(true)
  }

  public disableDebug() {
    this._debug.set(false)
  }

    reset() {
      this._branchTile.set(null)
      this._backgroundTile.set(null)
      this._borderColorTile.set(null)
    }
}

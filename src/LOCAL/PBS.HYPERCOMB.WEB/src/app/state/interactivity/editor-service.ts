import { Injectable, signal, computed, inject } from "@angular/core"
import { EditorMode } from "src/app/core/models/enumerations"
import { Cell } from "src/app/cells/cell"
import { isNewHive } from "src/app/cells/models/cell-filters"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { ImageService } from "src/app/database/images/image-service"
import { CellEditContext } from "./cell-edit-context"

@Injectable({ providedIn: "root" })
export class EditorService {

  private readonly images = inject(ImageService)

  // internal state
  private readonly _mode = signal<EditorMode>(EditorMode.None)
  private readonly _context = signal<CellEditContext | null>(null)
  private readonly _dragOver = signal(false)
  private readonly _initialScale = signal<number | undefined>(undefined)
  private readonly _selectedColor = signal<string | null>(null)
  private readonly _debug = signal(false)

  // tile visuals
  private readonly _borderColorTile = signal<Cell | null>(null)
  private readonly _branchTile = signal<Cell | null>(null)
  private readonly _backgroundTile = signal<Cell | null>(null)

  public readonly isEditing = computed(() => this._context() !== null)

  public readonly operation = computed(() => {
    const ctx = this.context()
    if (!ctx) return "edit-cell"
    if (ctx.kind === "Hive") {
      return ctx.cellId == null ? "new-hive" : "edit-hive"
    }
    return ctx.cellId == null ? "new-cell" : "edit-cell"
  })

  // readonly selectors
  public readonly mode = this._mode.asReadonly()
  public readonly cell = computed(() => this._context()?.cell)
  public readonly context = this._context.asReadonly()
  public readonly dragOver = this._dragOver.asReadonly()
  public readonly initialScale = this._initialScale.asReadonly()
  public readonly selectedColor = this._selectedColor.asReadonly()
  public readonly borderColorTile = this._borderColorTile.asReadonly()
  public readonly branchTile = this._branchTile.asReadonly()
  public readonly backgroundTile = this._backgroundTile.asReadonly()
  public readonly debug = this._debug.asReadonly()

  public readonly isSwatchMode = computed(() => (this._mode() & EditorMode.Swatch) !== 0)

  public isNewHive = computed(() => {
    const cell = this.context()?.cell
    return cell ? isNewHive(cell) : false
  })

  public rendered = signal(false)

  public clearContext = async () => {
    this._context.set(null)
  }

  public setMode(mode: EditorMode) {
    this._mode.set(mode)
  }

  // safe cloning helper
  private cloneImage(image: IHiveImage | undefined): IHiveImage | undefined {
    if (!image) return undefined
    return {
      imageHash: image.imageHash,
      blob: image.blob,
      x: image.x,
      y: image.y,
      scale: image.scale
    }
  }

  public setContext = async (context: CellEditContext | null) => {
    if (!context) {
      this._context.set(null)
      return
    }

    const cell = context.cell
    
    // preserve prototype
    const editCell = Object.create(Object.getPrototypeOf(cell)) as Cell
    Object.assign(editCell, cell)

    // guaranteed-valid IHiveImage clones
    context.originalSmall = this.cloneImage(context.originalSmall)
    context.modifiedSmall = this.cloneImage(context.modifiedSmall)

    // large image loading via hash
    const large = await this.images.getBaseImage(cell) // automatically handles large → small fallback
    context.modifiedLarge = large ? this.cloneImage(large) : context.originalSmall

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
    this._borderColorTile.set(cell)
  }

  public updateBranchVisual(cell: Cell) {
    this._branchTile.set(cell)
  }

  public updateBackgroundVisual(cell: Cell) {
    this._backgroundTile.set(cell)
  }

  // debug toggles
  public enableDebug() {
    this._debug.set(true)
  }

  public disableDebug() {
    this._debug.set(false)
  }

  public reset() {
    this._branchTile.set(null)
    this._backgroundTile.set(null)
    this._borderColorTile.set(null)
  }
}

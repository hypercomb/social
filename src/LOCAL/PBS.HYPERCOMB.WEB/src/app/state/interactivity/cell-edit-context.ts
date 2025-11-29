import { Cell } from "src/app/cells/cell"
import { IHiveImage } from "src/app/core/models/i-hive-image"

export class CellEditContext {
  initialImageHash: string | undefined
  public get cellId(): number | undefined { return this.cell.cellId }
  public get kind(): string { return this.cell.kind }

  // transient editor fields
  public originalSmall?: IHiveImage 
  public originalLarge?: IHiveImage
  public modifiedSmall?: IHiveImage
  public modifiedLarge?: IHiveImage
  public imageDirty = false
  public backupPosition?: { x: number; y: number }

  constructor(
    public readonly cell: Cell
  ) { }

  setCell(cell: Cell): void {
    (this as any).cell = cell
  }
  
  undoStack: any[] = []
  redoStack: any[] = []
}

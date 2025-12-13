import { IHiveImage } from "src/app/core/models/i-hive-image"
import { Cell } from "src/app/models/cell"

export class CellEditContext {
  initialImageHash: string | undefined
  public get gene(): string | undefined { return this.cell.gene }

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

import { Injectable, inject } from "@angular/core"
import { IImportTransform } from "./i-import-transform"
import { DefaultImportTransform } from "./default-import-transform"
import { CellImportTransform } from "./cell-import-transform"

@Injectable({ providedIn: "root" })
export class ImportTransformRegistry {
  private readonly transforms: IImportTransform[] = [
    inject(CellImportTransform),
    inject(DefaultImportTransform),
  ]

  public getTransformsFor(table: string): IImportTransform[] {
    return this.transforms.filter(t => t.supports(table))!
  }

}

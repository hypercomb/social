import { Cell } from "src/app/cells/cell"
import { IZipData } from "./i-persistence-interfaces"

export interface IRestoreFilter {
    canFilter(zipData: IZipData): Promise<boolean>
    filter(zipData: IZipData): Promise<Cell[]>
}


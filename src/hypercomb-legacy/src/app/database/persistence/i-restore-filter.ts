import { Cell } from "src/app/models/cell-kind"
import { IZipData } from "./i-persistence-interfaces"

export interface IRestoreFilter {
    canFilter(zipData: IZipData): Promise<boolean>
    filter(zipData: IZipData): Promise<Cell[]>
}


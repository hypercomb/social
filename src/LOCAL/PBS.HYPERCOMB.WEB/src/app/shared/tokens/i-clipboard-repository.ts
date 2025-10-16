import { InjectionToken } from "@angular/core"
import { Cell } from "src/app/cells/cell"

export interface IClipboardRepository {
    addCell(cells: Clipboard[]): Promise<void>
    fetchHierarchy( sourceId: number): Promise<Cell[]>
    clearChildren: (rootId: number) => Promise<void>
}

export const CLIPBOARD_REPOSITORY = new InjectionToken<IClipboardRepository>('CLIPBOARD_REPOSITORY')
import { Injectable } from "@angular/core"
import { toCell, safeDate } from "src/app/core/mappers/to-cell"
import { toCellEntity } from "src/app/core/mappers/to-cell-entity"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { IEntityFactoryPort } from "../ports/i-entity-factory-port"
import { Cell, NewCell, Hive, Ghost, ClipboardCell, Pathway } from "src/app/cells/cell"

@Injectable({ providedIn: "root" })
export class CellFactory implements IEntityFactoryPort<CellEntity, Cell> {
    public map<T extends Cell | NewCell>(entity: CellEntity): T {
        return toCell(entity) as T
    }

    public unmap(domain: Cell | NewCell): CellEntity {
        return toCellEntity(domain)
    }

    public newCell(params: Partial<NewCell>): NewCell {
        return new NewCell({
            ...params,
            dateCreated: safeDate(new Date()),
            isDeleted: false,
        })
    }

    // Explicit creation methods for each type
    public createCell(params: Partial<NewCell> & { cellId: number }): Cell {
        return new Cell({
            ...params,
            kind: "Cell",
            cellId: params.cellId,
            dateCreated: safeDate(new Date()),
        })
    }

    public createHive(params: Partial<Cell> & { cellId: number }): Hive {
        return new Hive({
            ...params,
            kind: "Hive",
            cellId: params.cellId,
            dateCreated: safeDate(new Date()),
        })
    }

    public createGhost(params: Partial<NewCell> = {}): Ghost {
        return new Ghost({
            ...params,
            kind: "Ghost",
            dateCreated: safeDate(new Date()),
        })
    }

    public createClipboard(params: Partial<Cell> & { cellId: number }): ClipboardCell {
        return new ClipboardCell({
            ...params,
            kind: "Clipboard",
            cellId: params.cellId,
            dateCreated: safeDate(new Date()),
        })
    }

    public createPathway(params: Partial<Cell> & { cellId: number }): Pathway {
        return new Pathway({
            ...params,
            kind: "Pathway",
            cellId: params.cellId,
            dateCreated: safeDate(new Date()),
        })
    }

    public clone(original: Cell | NewCell, overrides: Partial<NewCell> = {}): NewCell {
        const { cellId, ...rest } = original as Cell
        return new NewCell({
            ...rest,
            ...overrides,
            dateCreated: safeDate(new Date()),
            isDeleted: false,
        })
    }

    public copy(original: Cell | NewCell): Cell | NewCell {
        if (original instanceof Cell) {
            // preserve everything, including id
            return new Cell({
                ...original,
                cellId: original.cellId!,  // force copy id
                dateCreated: original.dateCreated,
                updatedAt: safeDate(new Date()), // refresh updated timestamp
            })
        } else {
            // if it’s a NewCell, just mirror the properties
            return new NewCell({
                ...original,
                dateCreated: original.dateCreated ?? safeDate(new Date()),
            })
        }
    }

    public update(cell: Cell, updates: Partial<Cell>): Cell {
        return new Cell({
            ...cell,
            ...updates,
            updatedAt: safeDate(new Date()),
            ...(cell.cellId != null ? { cellId: cell.cellId } : {}), // only add if defined
        })
    }
}

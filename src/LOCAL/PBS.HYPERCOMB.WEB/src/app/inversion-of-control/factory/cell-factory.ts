import { inject, Injectable } from "@angular/core"
import { toCell, safeDate } from "src/app/core/mappers/to-cell"
import { toCellEntity } from "src/app/core/mappers/to-cell-entity"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { IEntityFactoryPort } from "../ports/i-entity-factory-port"
import { Cell, NewCell, Hive, Ghost, ClipboardCell, Pathway, CellKind } from "src/app/cells/cell"
import { ICreateCells } from "../tokens/tile-factory.token"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { COMB_IMG_FACTORY } from "src/app/shared/tokens/i-hive-images.token"
import { IHiveImage } from "src/app/core/models/i-hive-image"

@Injectable({ providedIn: "root" })
export class CellFactory implements IEntityFactoryPort<CellEntity, Cell>, ICreateCells {
    private readonly factory = inject(COMB_IMG_FACTORY)
    private readonly blobs = inject(BlobService)

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
    public async create(params: Partial<NewCell> & { cellId: number }, kind: CellKind): Promise<Cell> {
        const cell = new Cell({
            ...params,
            cellId: params.cellId,
            dateCreated: safeDate(new Date()),
        })
        cell.setKind(kind)
        return cell
    }

    public async createHive(params: Partial<Cell> & { cellId: number }): Promise<Hive> {
        return new Hive({
            ...params,
            kind: "Hive",
            cellId: params.cellId,
            dateCreated: safeDate(new Date()),
        })
    }

    public async createGhost(params: Partial<NewCell> = {}): Promise<Ghost>  {

        const blob = await this.blobs.getInitialBlob()
        const image =  <IHiveImage> await this.factory.create(blob, -1)  // use -1 as temp cellId
        return new Ghost({
            ...params,
            dateCreated: safeDate(new Date()),
            image,
        })
    }

    public async createClipboard(params: Partial<Cell> & { cellId: number }): Promise<ClipboardCell> {
        return new ClipboardCell({
            ...params,
            kind: "Clipboard",
            cellId: params.cellId ,
            dateCreated: safeDate(new Date()),
        })
    }

    public async createPathway(params: Partial<Cell> & { cellId: number }): Promise<Pathway> {
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

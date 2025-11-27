// src/app/common/tile-editor/tile-image/tile-image.component.ts
// SIH-compliant CellFactory

import { inject, Injectable } from "@angular/core"
import { toCell, safeDate } from "src/app/core/mappers/to-cell"
import { toCellEntity } from "src/app/core/mappers/to-cell-entity"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { IEntityFactoryPort } from "../ports/i-entity-factory-port"
import { Cell, NewCell, Hive, Ghost, ClipboardCell, Path, CellKind } from "src/app/cells/cell"
import { ICreateCells } from "../tokens/tile-factory.token"
import { ContextStack } from "src/app/core/controller/context-stack"
import { ImagePreloader } from "src/app/hive/rendering/image-preloader.service"

@Injectable({ providedIn: "root" })
export class CellFactory
  implements IEntityFactoryPort<CellEntity, Cell>, ICreateCells {

  private readonly stack = inject(ContextStack)
  private readonly preloader = inject(ImagePreloader)

  // map / unmap
  public map<T extends Cell | NewCell>(entity: CellEntity): T {
    return toCell(entity) as T
  }

  public unmap(domain: Cell | NewCell): CellEntity {
    return toCellEntity(domain)
  }

  // BASE new cell
  public newCell(params: Partial<NewCell>): NewCell {
    return new NewCell({
      ...params,
      dateCreated: safeDate(new Date()),
      isDeleted: false,
    })
  }

  // concrete Cell creation
  public async create(
    params: Partial<NewCell> & { cellId: number },
    kind: CellKind
  ): Promise<Cell> {
    const cell = new Cell({
      ...params,
      cellId: params.cellId,
      dateCreated: safeDate(new Date()),
    })
    cell.setKind(kind)
    return cell
  }

  public async createHive(
    params: Partial<Cell> & { cellId: number }
  ): Promise<Hive> {
    return new Hive({
      ...params,
      kind: "Hive",
      cellId: params.cellId,
      dateCreated: safeDate(new Date()),
    })
  }

  // ---------------------------------------------------------------------
  // FIXED GHOST CREATION
  // ---------------------------------------------------------------------
  public async createGhost(params: Partial<NewCell> = {}): Promise<Ghost> {
    const imageHash = this.preloader.getInitialTileHash()
    if (!imageHash) {
      throw new Error("initial tile hash was not preloaded")
    }

    return new Ghost({
      ...params,
      kind: "Ghost",
      hive: this.stack.hiveName(),
      imageHash,
      dateCreated: safeDate(new Date()),
      isDeleted: false
    })
  }

  public async createClipboard(
    params: Partial<Cell> & { cellId: number }
  ): Promise<ClipboardCell> {
    return new ClipboardCell({
      ...params,
      kind: "Clipboard",
      cellId: params.cellId,
      dateCreated: safeDate(new Date()),
    })
  }

  public async createPathway(
    params: Partial<Cell> & { cellId: number }
  ): Promise<Path> {
    return new Path({
      ...params,
      kind: "Path",
      cellId: params.cellId,
      dateCreated: safeDate(new Date()),
    })
  }

  // clones
  public clone(
    original: Cell | NewCell,
    overrides: Partial<NewCell> = {}
  ): NewCell {
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
      return new Cell({
        ...original,
        cellId: original.cellId,
        dateCreated: original.dateCreated,
        updatedAt: safeDate(new Date()),
      })
    } else {
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
      ...(cell.cellId != null ? { cellId: cell.cellId } : {}),
    })
  }
}

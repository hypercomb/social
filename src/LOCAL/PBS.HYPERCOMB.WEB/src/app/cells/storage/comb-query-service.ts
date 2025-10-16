import { Injectable, inject } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { DataOrchestratorBase } from "./data-orchestration-base"
import { ICombQueries } from "src/app/shared/tokens/i-comb-query.token"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"
import { HIVE_IMG_REPOSITORY } from "src/app/shared/tokens/i-hive-images.token"

@Injectable({ providedIn: "root" })
export class CombQueryService extends DataOrchestratorBase implements ICombQueries {
  private readonly store = inject(HIVE_STORE)
  private readonly factory = inject(CELL_FACTORY)
  private readonly images = inject(HIVE_IMG_REPOSITORY)

  constructor() {
    super()
  }

  // -----------------------------------------------------------
  // decorate helper (attach image to a cell if available)
  // -----------------------------------------------------------
  public async decorateWithImage(cell: Cell): Promise<Cell> {
    const image = await this.images.fetchByCell(cell.cellId!, 'small')
    if (image) {
      cell.image = image
    }
    return cell
  }

  public async decorateAll(cells: Cell[]): Promise<Cell[]> {
    return Promise.all(cells.map(c => this.decorateWithImage(c)))
  }

  // --------------------------------------------------
  // targeted lookups → return only (no staging)
  // -------------------------------------------------- 
  public async fetch(cellId: number): Promise<Cell | undefined> {
    const entity = await this.repository.fetch(cellId)
    if (!entity) return undefined
    const cell = <Cell>this.factory.map(entity)
    return this.decorateWithImage(cell)
  }

  public async fetchAll(): Promise<Cell[]> {
    const entities = await this.repository.fetchAll()
    const mapped = entities.map(e => <Cell>this.factory.map(e))
    return this.decorateAll(mapped)
  }

  public async exists(domain: Cell): Promise<boolean> {
    return this.repository.exists(domain.cellId!)
  }

  public async fetchCount(parent: Cell): Promise<number> {
    return this.store.cellcount()
  }

  public async fetchByIds(ids: number[]): Promise<Cell[]> {
    const entities = await this.repository.fetchByIds(ids)
    const mapped = entities.map(e => <Cell>this.factory.map(e))
    return this.decorateAll(mapped)
  }

  public async fetchByUniqueId(uniqueId: string): Promise<Cell | null> {
    const entity = await this.repository.fetchByUniqueId(uniqueId)
    if (!entity) return null
    const cell = <Cell>this.factory.map(entity)
    return this.decorateWithImage(cell)
  }

  public fetchRoot = async (): Promise<Cell | undefined> => {
    const entity = await this.repository.fetchRoot()
    if (!entity) return undefined
    const cell = <Cell>this.factory.map(entity)
    return this.decorateWithImage(cell)
  }
}

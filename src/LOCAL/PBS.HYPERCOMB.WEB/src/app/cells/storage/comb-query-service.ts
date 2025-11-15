import { Injectable, inject } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { DataOrchestratorBase } from "./data-orchestration-base"
import { ICombQueries } from "src/app/shared/tokens/i-comb-query.token"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"

@Injectable({ providedIn: "root" })
export class CombQueryService extends DataOrchestratorBase implements ICombQueries {

  private readonly store   = inject(HIVE_STORE)
  private readonly factory = inject(CELL_FACTORY)

  constructor() {
    super()
  }

  // -----------------------------------------------------------
  // return plain cells (no images)
  // -----------------------------------------------------------
  public async fetch(cellId: number): Promise<Cell | undefined> {
    const entity = await this.repository.fetch(cellId)
    return entity ? (this.factory.map(entity) as Cell) : undefined
  }

  public async fetchAll(): Promise<Cell[]> {
    const entities = await this.repository.fetchAll()
    return entities.map(e => this.factory.map(e) as Cell)
  }

  public async fetchByIds(ids: number[]): Promise<Cell[]> {
    const entities = await this.repository.fetchByIds(ids)
    return entities.map(e => this.factory.map(e) as Cell)
  }

  public async fetchByUniqueId(uniqueId: string): Promise<Cell | null> {
    const entity = await this.repository.fetchByUniqueId(uniqueId)
    return entity ? (this.factory.map(entity) as Cell) : null
  }

  public async fetchRoot(): Promise<Cell | undefined> {
    const entity = await this.repository.fetchRoot()
    return entity ? (this.factory.map(entity) as Cell) : undefined
  }

  public async exists(domain: Cell): Promise<boolean> {
    return this.repository.exists(domain.cellId!)
  }

  public async fetchCount(parent: Cell): Promise<number> {
    return this.store.cellcount()
  }
}

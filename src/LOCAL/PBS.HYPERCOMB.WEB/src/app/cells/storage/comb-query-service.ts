import { Injectable, inject } from "@angular/core"
import { DataOrchestratorBase } from "./data-orchestration-base"
import { ICombQueries } from "src/app/shared/tokens/i-honeycomb-query.token"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"
import { Cell } from "src/app/models/cell"

/**
 * CombQueryService (2025)
 * -----------------------------------------------------------
 * Pure repository-level read service.
 * • does NOT hydrate hives
 * • does NOT interact with HoneycombStore
 * • uses factory.map() for Cell reconstruction
 * • fully compatible with unified DataOrchestratorBase
 */
@Injectable({ providedIn: "root" })
export class CombQueryService extends DataOrchestratorBase implements ICombQueries {

  private readonly factory = inject(CELL_FACTORY)

  constructor() {
    super()
  }

  // -----------------------------------------------------------
  // FETCH ONE
  // -----------------------------------------------------------
  public async fetch(gene: string): Promise<Cell | undefined> {
    const entity = await this.repository.fetch(gene)
    return entity ? (this.factory.map(entity) as Cell) : undefined
  }

  // -----------------------------------------------------------
  // FETCH ALL
  // -----------------------------------------------------------
  public async fetchAll(): Promise<Cell[]> {
    const entities = await this.repository.fetchAll()
    return entities.map(e => this.factory.map(e) as Cell)
  }

  // -----------------------------------------------------------
  // FETCH BY IDS
  // -----------------------------------------------------------
  public async fetchByIds(ids: number[]): Promise<Cell[]> {
    if (!ids.length) return []
    const entities = await this.repository.fetchByIds(ids)
    return entities.map(e => this.factory.map(e) as Cell)
  }


  // -----------------------------------------------------------
  // EXISTS
  // -----------------------------------------------------------
  public async exists(cell: Cell): Promise<boolean> {
    return this.repository.exists(cell.gene!)
  }

  // -----------------------------------------------------------
  // COUNT CHILDREN
  // -----------------------------------------------------------
  public async fetchCount(parent: Cell): Promise<number> {
    // repository fetchChildCount is the authority
    return this.repository.fetchChildCount(parent.gene!)
  }
}

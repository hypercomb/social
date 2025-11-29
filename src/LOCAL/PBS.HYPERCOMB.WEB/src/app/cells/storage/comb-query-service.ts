import { Injectable, inject } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { DataOrchestratorBase } from "./data-orchestration-base"
import { ICombQueries } from "src/app/shared/tokens/i-comb-query.token"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"

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
  public async fetch(cellId: number): Promise<Cell | undefined> {
    const entity = await this.repository.fetch(cellId)
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
  // FETCH BY UNIQUE ID
  // -----------------------------------------------------------
  public async fetchByUniqueId(uniqueId: string): Promise<Cell | null> {
    const entity = await this.repository.fetchByUniqueId(uniqueId)
    return entity ? (this.factory.map(entity) as Cell) : null
  }

  // -----------------------------------------------------------
  // FETCH ROOT CELL
  // -----------------------------------------------------------
  public async fetchRoot(): Promise<Cell | undefined> {
    const entity = await this.repository.fetchRoot()
    return entity ? (this.factory.map(entity) as Cell) : undefined
  }

  // -----------------------------------------------------------
  // EXISTS
  // -----------------------------------------------------------
  public async exists(cell: Cell): Promise<boolean> {
    return this.repository.exists(cell.cellId!)
  }

  // -----------------------------------------------------------
  // COUNT CHILDREN
  // -----------------------------------------------------------
  public async fetchCount(parent: Cell): Promise<number> {
    // repository fetchChildCount is the authority
    return this.repository.fetchChildCount(parent.cellId!)
  }
}

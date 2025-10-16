import { Injectable } from "@angular/core"
import { DataServiceBase } from "../actions/service-base-classes"
import { Cell } from "../cells/cell"

// Interface defining all available database operations
export interface IDatabaseOperations {
  store(data: Cell): Promise<Cell>
  update(data: Cell, hiveId?: string): Promise<number>
  delete(data: Cell)
  deleteAll(data: Cell, hierarchy: Cell[])
  bulkAdd(newData: Cell[])
  bulkPut(cell: Cell[])
  updateByUnique(data: Cell): Promise<number | undefined>
  stub(): Promise<Cell>
}

@Injectable({ providedIn: 'root' })
export class DatabaseAdapter extends DataServiceBase implements IDatabaseOperations {

  // Implement all interface methods by delegating to database service
  public async store(data: Cell): Promise<Cell> {
    return this.tile_actions.store(data)
  }

  public async update(data: Cell, hiveId?: string): Promise<number> {
    return this.tile_actions.update(data, hiveId)
  }

  public async delete(data: Cell) {
    return this.tile_actions.delete(data)
  }

  public async deleteAll(data: Cell, hierarchy: Cell[]) {
    return this.tile_actions.deleteAll(data, hierarchy)
  }

  public async bulkAdd(newData: Cell[]) {
    return this.tile_actions.bulkAdd(newData)
  }

  public async bulkPut(cell: Cell[]) {
    return this.tile_actions.bulkPut(cell)
  }

  public async updateByUnique(data: Cell): Promise<number | undefined> {
    return this.tile_actions.updateByUnique(data)
  }

  public async stub(): Promise<Cell> {
    return this.tile_actions.stub()
  }
}


import { inject, Injectable } from "@angular/core"
import { CellEntity } from "../model/i-tile-entity"
import { ICellIdentifier } from "../model/i-tile-identifiers"
import { RepositoryBase } from "./repository.base"
import { ICellRepository } from "src/app/shared/tokens/i-cell-repository.token"
import { CellOptions } from "src/app/cells/models/cell-options"
import { DebugService } from "src/app/core/diagnostics/debug-service"
@Injectable()
export class CellRepository extends RepositoryBase<CellEntity> implements ICellRepository {

  private debug = inject(DebugService)

  async fetchByUniqueId(uniqueId: string): Promise<CellEntity | undefined> {
    if (!uniqueId) return undefined;
    return this.cell_db.where("uniqueId").equals(uniqueId).first();
  }

  fetchRoot = async (): Promise<CellEntity | undefined> => {
    const all = await this.cell_db.toArray()
    // Replaced console.log with debug service
    this.debug.log('all cells', all)
    const root = await this.cell_db
      .where("kind")
      .equals('Hive')   // if you decide to use a Root flag
      .first()
    return root
  }


  public async fetchById(id: number): Promise<CellEntity | undefined> {
    return this.cell_db.get(id);
  }

  public async fetchByIds(ids: number[]): Promise<CellEntity[]> {
    return this.cell_db.bulkGet(ids).then(rows => rows.filter((r): r is CellEntity => !!r));
  }

  public async fetchChildCount(cellId: number): Promise<number> {
    return this.cell_db
      .where("sourceId")
      .equals(cellId)
      .count();
  }


  public async fetchIdentifiers(): Promise<ICellIdentifier[]> {
    const rows = await this.cell_db.toArray();
    return rows
      .filter((r): r is CellEntity & { cellId: number } =>
        r.cellId != null && !(r.options & CellOptions.Deleted)
      )
      .map(r => ({
        cellId: r.cellId,
        hive: r.hive
      }));;
  }

  public async fetchCountBySourceId(sourceId: number): Promise<number> {
    return this.cell_db.where("sourceId").equals(sourceId).count();
  }

  public async exists(cellId: number): Promise<boolean> {
    if (!cellId) return false;
    return (await this.cell_db.get(cellId)) != null;
  }
}

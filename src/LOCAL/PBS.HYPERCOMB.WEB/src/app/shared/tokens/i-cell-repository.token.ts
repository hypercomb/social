import { InjectionToken } from "@angular/core"
import { ICellIdentifier } from "src/app/database/model/i-tile-identifiers"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { TileQueryOptions } from "src/app/database/query/query-types"

export interface IQueryHelper {
  findFirst<T = any>(opts: TileQueryOptions): Promise<T | undefined>
  get<T>(opts: TileQueryOptions): Promise<T[]>
  query<T = any>(options: TileQueryOptions): Promise<T[]>
}

export interface IRepostioryBase<TEntity> {
  add(entity: TEntity, imageBlob?: Blob): Promise<TEntity>
  update(entity: TEntity, imageBlob?: Blob) : Promise<number>
  delete(entity: TEntity): Promise<void>
  bulkPut(cells: TEntity[]): Promise<void>
  update(entity: TEntity): Promise<number>
  fetchAll(): Promise<TEntity[]>
}

export interface ICellRepository extends IRepostioryBase<CellEntity> {
  bulkDelete(ids: number[])

  fetch(cellId: number): Promise<CellEntity | undefined>
  fetchBySourceId(sourceId: number): Promise<CellEntity[]>
  fetchByIds(ids: number[]): Promise<CellEntity[]>
  fetchRoot(): Promise<CellEntity | undefined>
  fetchIdentifiers(): Promise<ICellIdentifier[]>
  exists(cellId: number): Promise<boolean>
  fetchByUniqueId(uniqueId: string): Promise<CellEntity | undefined>
}

export const CELL_REPOSITORY = new InjectionToken<ICellRepository>('CELL_REPOSITORY')
export const QUERY_HELPER = new InjectionToken<IQueryHelper>('QUERY_HELPER')
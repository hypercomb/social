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
  fetchChildCount(gene: string): Promise<number>
  bulkDelete(ids: string[])
  fetch(gene: string): Promise<CellEntity | undefined>
  fetchBySourceId(gene: string): Promise<CellEntity[]>
  fetchByIds(ids: string[]): Promise<CellEntity[]>
  fetchIdentifiers(): Promise<ICellIdentifier[]>
  exists(gene: string): Promise<boolean>
}

export const CELL_REPOSITORY = new InjectionToken<ICellRepository>('CELL_REPOSITORY')
export const QUERY_HELPER = new InjectionToken<IQueryHelper>('QUERY_HELPER')
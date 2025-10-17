import { InjectionToken } from "@angular/core"
import { IHiveImage } from "src/app/core/models/i-hive-image"

export interface ICombImageFactory { 
    create(blob: Blob, cellId: number): Promise<IHiveImage>
}

export interface IQueryImages {
    fetchByCell(cellId: number, table: "small" | "large"): Promise<IHiveImage | undefined>
    fetchByCells(cellIds: number[], table: "small" | "large"): Promise<IHiveImage[]>
    fetchAll(table: "small" | "large"): Promise<IHiveImage[]>
}
export interface IModifyImages {
    add(image: IHiveImage, table: "small" | "large"): Promise<number>
    delete(id: number, table: "small" | "large"): Promise<void>
}

export interface IImageRepository {
    initialize(): unknown
    fetchByCell(cellId: number, table: "small" | "large"): Promise<IHiveImage | undefined>
    fetchByCells(cellIds: number[], table: "small" | "large"): Promise<IHiveImage[]>
    fetchAll(table: "small" | "large"): Promise<IHiveImage[]>
    add(image: IHiveImage, table: "small" | "large"): Promise<number>
    delete(id: number, table: "small" | "large"): Promise<void>
}

/**
 * Injection tokens
 */
export const QUERY_IMG_SVC = new InjectionToken<IQueryImages>("QUERY_IMG_SVC")
export const MODIFY_IMG_SVC = new InjectionToken<IModifyImages>("MODIFY_IMG_SVC")
export const HIVE_IMG_REPOSITORY = new InjectionToken<IImageRepository>("HIVE_IMG_REPOSITORY")
export const COMB_IMG_FACTORY = new InjectionToken<ICombImageFactory>("COMB_IMG_FACTORY")
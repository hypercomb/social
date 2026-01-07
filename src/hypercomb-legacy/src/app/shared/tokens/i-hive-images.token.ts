import { InjectionToken } from "@angular/core"
import { IHiveImage } from "src/app/core/models/i-hive-image"

/**
 * Query interface: fetch by image ID, not cell ID.
 */
export interface IQueryImages {
    fetch(imageId: number, table: "small" | "large"): Promise<IHiveImage | undefined>
    fetchMany(imageIds: number[], table: "small" | "large"): Promise<IHiveImage[]>
    fetchAll(table: "small" | "large"): Promise<IHiveImage[]>
}

/**
 * Modify interface: add/update/delete
 */
export interface IModifyImages {
    add(image: IHiveImage, table: "small" | "large"): Promise<number>
    delete(id: number, table: "small" | "large"): Promise<void>
}

/**
 * Unified repository interface combining query + modify.
 * Still provided for backwards compatibility.
 */
export interface IImageRepository {
    initialize(): unknown

    fetch(imageId: number, table: "small" | "large"): Promise<IHiveImage | undefined>
    fetchMany(imageIds: number[], table: "small" | "large"): Promise<IHiveImage[]>
    fetchAll(table: "small" | "large"): Promise<IHiveImage[]>

    add(image: IHiveImage, table: "small" | "large"): Promise<number>
    delete(id: number, table: "large" | "small"): Promise<void>
}

/**
 * Injection tokens
 */
export const QUERY_IMG_SVC = new InjectionToken<IQueryImages>("QUERY_IMG_SVC")
export const MODIFY_IMG_SVC = new InjectionToken<IModifyImages>("MODIFY_IMG_SVC")
export const HIVE_IMG_REPOSITORY = new InjectionToken<IImageRepository>("HIVE_IMG_REPOSITORY")


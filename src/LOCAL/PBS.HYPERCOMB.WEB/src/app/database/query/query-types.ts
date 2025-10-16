import { CellOptions } from "src/app/cells/models/cell-options"
import { CellEntity } from "../model/i-tile-entity"

export type TileFilter = (row: any) => boolean


export interface TileQueryOptions {
    where?: Partial<CellEntity>
    all?: number[]
    any?: number[]
    none?: number[]
    orderBy?: string
}


// helpers
export const toMask = (v?: CellOptions | CellOptions[]): number =>
    Array.isArray(v) ? v.reduce((m, b) => m | b, 0) : (v ?? 0)

export const takeFlagMasksFromWhere = (where?: Partial<Record<string, any>>) => {
    if (!where) return { whereSansFlags: where, allMask: 0, anyMask: 0, noneMask: 0 }
    const { all, any, none, ...rest } = where as any
    return {
        whereSansFlags: rest as Partial<Record<string, any>>,
        allMask: toMask(all),
        anyMask: toMask(any),
        noneMask: toMask(none),
    }
}

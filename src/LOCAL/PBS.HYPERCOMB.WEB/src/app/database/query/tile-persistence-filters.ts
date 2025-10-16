import { CellOptions } from "src/app/cells/models/cell-options"

type TileFilter = (row: any) => boolean

// ---- overload option types ----
export interface EqualsOptions {
    equals: Partial<Record<string, any>>
    all?: CellOptions[]
    none?: CellOptions[]
}

export interface InOptions {
    in: Partial<Record<string, any[]>>
    all?: CellOptions[]
    none?: CellOptions[]
}

export interface RangeOptions {
    range: Partial<Record<string, { min?: any; max?: any }>>
    all?: CellOptions[]
    none?: CellOptions[]
}


export interface PagedResult<T> {
    items: T[]
    total: number
    page: number
    pageSize: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
    nextOffset?: number
    prevOffset?: number
}



// helpers: bitmask handling + flag extraction from 'where'
export const toMask = (v: number | number[] | undefined): number =>
    Array.isArray(v) ? v.reduce((m, b) => m | b, 0) : (v ?? 0)

export const takeFlagMasksFromWhere = (where?: Partial<Record<string, any>>) => {
    if (!where) return { whereSansFlags: where, allMask: 0, anyMask: 0, noneMask: 0 }

    // allow 'all' | 'any' | 'none' inside where per flattened dsl:
    // where: { all: [CellOptions.Active], none: [CellOptions.Deleted], ... }
    const { all, any, none, ...rest } = where as any
    return {
        whereSansFlags: rest as Partial<Record<string, any>>,
        allMask: toMask(all),
        anyMask: toMask(any),
        noneMask: toMask(none),
    }
}

// ---- overload option types ----
export interface EqualsOptions {
    equals: Partial<Record<string, any>>
    all?: CellOptions[]
    none?: CellOptions[]
}

export interface InOptions {
    in: Partial<Record<string, any[]>>
    all?: CellOptions[]
    none?: CellOptions[]
}

export interface RangeOptions {
    range: Partial<Record<string, { min?: any; max?: any }>>
    all?: CellOptions[]
    none?: CellOptions[]
}


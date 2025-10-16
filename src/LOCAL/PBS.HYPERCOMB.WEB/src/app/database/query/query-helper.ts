// tile-query.service.ts
import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "../database-service"
import { takeFlagMasksFromWhere, toMask } from "./tile-persistence-filters"
import { ServiceBase } from "src/app/core/mixins/abstraction/service-base"
import { IQueryHelper } from "src/app/shared/tokens/i-cell-repository.token"
import { CellEntity } from "../model/i-tile-entity"

// ─────────────────────────────────────────────
// query option types (simplified, no paging)
// ─────────────────────────────────────────────

export interface TileQueryOptions {
    where?: Partial<CellEntity>
    equals?: Partial<CellEntity>
    in?: Partial<Record<keyof CellEntity, any[]>>   // keep separate
    range?: Partial<Record<keyof CellEntity, [any, any]>>
    all?: number[]
    any?: number[]
    none?: number[]
    orderBy?: string
}


@Injectable({ providedIn: "root" })
export class QueryHelper extends ServiceBase implements IQueryHelper {
    private readonly database = inject(DatabaseService)

    // normalize ergonomic args into a single where clause
    // normalize ergonomic args to low-level options
    private normalize = (opts: TileQueryOptions): TileQueryOptions => {
        if ("equals" in opts) {
            const { equals, all, any, none, ...rest } = opts
            return { ...rest, where: { ...(opts as any).where, ...equals }, all, any, none }
        }
        if ("in" in opts) {
            const { in: inMap, all, any, none, ...rest } = opts
            return { ...rest, where: { ...(opts as any).where, ...inMap }, all, any, none }
        }
        if ("range" in opts) {
            const { range, all, any, none, ...rest } = opts
            return { ...rest, where: { ...(opts as any).where, ...range }, all, any, none }
        }

        return opts
    }

    // index-aware seeding (strip flags inside where)
    private seedByWhere(where?: Record<string, any>) {
        const table = this.database.db()!.table("data")
        const { whereSansFlags } = takeFlagMasksFromWhere(where)
        const w = whereSansFlags

        if (!w || Object.keys(w).length === 0) {
            return { collection: table.toCollection(), residual: [] as [string, any][] }
        }

        const entries = Object.entries(w)
        const keys = entries.map(([k]) => k)

        // example compound index
        if (keys.includes("hiveId") && keys.includes("isDeleted")) {
            const used = new Set(["hiveId", "isDeleted"])
            const residual = entries.filter(([k]) => !used.has(k)) as [string, any][]
            return {
                collection: table.where("[hiveId+isDeleted]").equals([(w as any).hiveId, (w as any).isDeleted]),
                residual,
            }
        }

        // fallback: filter in-memory
        return {
            collection: table.toCollection().filter(row => entries.every(([k, v]) => row[k] === v)),
            residual: [] as [string, any][],
        }
    }

    // ─────────────────────────────────────────────
    // core query
    // ─────────────────────────────────────────────

    public query = async <T = any>(opts: TileQueryOptions): Promise<T[]> => {
        const { all, any, none, where, orderBy } = opts

        // merge flag masks
        const { whereSansFlags, allMask, anyMask, noneMask } = takeFlagMasksFromWhere(where)
        const ALL = toMask(all ?? allMask)
        const ANY = toMask(any ?? anyMask)
        const NONE = toMask(none ?? noneMask)

        // index-aware seeding
        const seeded = this.seedByWhere(whereSansFlags)
        let collection = seeded.collection

        if (seeded.residual.length) {
            collection = collection.filter(row => seeded.residual.every(([k, v]) => row[k] === v))
        }

        // flag filters
        if (ALL) collection = collection.filter(row => (row.options & ALL) === ALL)
        if (ANY) collection = collection.filter(row => (row.options & ANY) !== 0)
        if (NONE) collection = collection.filter(row => (row.options & NONE) === 0)

        // sorting
        let results = await (collection.toArray() as Promise<T[]>)
        if (orderBy && orderBy.trim().length) {
            const parts = orderBy.trim().split(/\s+/)
            const raw = parts[0]
            const desc = raw.startsWith("-") || (parts[1]?.toLowerCase().startsWith("desc") ?? false)
            const field = raw.startsWith("-") ? raw.slice(1) : raw
            results = [...results].sort((a: any, b: any) =>
                a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0
            )
            if (desc) results.reverse()
        }

        return results
    }

    // ─────────────────────────────────────────────
    // public helpers
    // ─────────────────────────────────────────────
    public async get<T>(opts: TileQueryOptions): Promise<T[]> {

        return this.query<T>(this.normalize(opts))
    }

    public async findFirst<T = any>(opts: TileQueryOptions): Promise<T | undefined> {
        const result = await this.get<T>(this.normalize(opts))
        return result[0]
    }

    public async exists(opts: TileQueryOptions): Promise<boolean> {
        const result = await this.get(this.normalize(opts))
        return result.length > 0
    }

    public async delete(opts: TileQueryOptions): Promise<number> {
        const matches = await this.get<{ cellId: number }>(this.normalize(opts))
        const ids = matches.map(item => item.cellId).filter(Boolean)
        if (!ids.length) return 0
        await this.database.db()!.table("data").bulkDelete(ids)
        return ids.length
    }

    public async save<T extends { cellId: number }>(entity: T): Promise<T> {
        const id = await this.database.db()!.table("data").put(entity)
        return { ...entity, cellId: id }
    }
}

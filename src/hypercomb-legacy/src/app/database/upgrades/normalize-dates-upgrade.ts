
import { IDatabaseUpgrade } from './i-database-upgrade'
import type { Transaction } from 'dexie'
import DBTables from 'src/app/core/constants/db-tables'

export class NormalizeDatesUpgrade {
    readonly version = 73

    async apply(tx: Transaction) {
        // normalize tile times
        const cells: any[] = await tx.table(DBTables.Cells).toArray()
        for (const t of cells) {
            let changed = false
            if (typeof t.DateCreated === 'number') {
                t.DateCreated = new Date(t.DateCreated).toISOString()
                changed = true
            }
            if (typeof t.UpdatedAt === 'number') {
                t.UpdatedAt = new Date(t.UpdatedAt).toISOString()
                changed = true
            }
            if (typeof t.dateDeleted === 'number') {
                t.dateDeleted = new Date(t.dateDeleted).toISOString()
                changed = true
            }
            if (changed) {
                await tx.table(DBTables.Cells).put(t)
            }
        }

        // normalize tag times
        const tags: any[] = await tx.table(DBTables.Tags).toArray()
        for (const tag of tags) {
            let changed = false
            if (typeof tag.DateCreated === 'number') {
                tag.DateCreated = new Date(tag.DateCreated).toISOString()
                changed = true
            }
            if (typeof tag.UpdatedAt === 'number') {
                tag.UpdatedAt = new Date(tag.UpdatedAt).toISOString()
                changed = true
            }
            if (changed) {
                await tx.table(DBTables.Tags).put(tag)
            }
        }
    }
}

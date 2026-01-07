import type { Transaction } from "dexie"
import { IDatabaseUpgrade } from "./i-database-upgrade"
import DBTables from "src/app/core/constants/db-tables"

export class DropBlobUpgrade implements IDatabaseUpgrade {
    public readonly version = 95

    public async apply(tx: Transaction) {
        const table = tx.table(DBTables.Cells)
        await table.toCollection().modify(record => {
            delete (record as any).blob
        })
    }
}
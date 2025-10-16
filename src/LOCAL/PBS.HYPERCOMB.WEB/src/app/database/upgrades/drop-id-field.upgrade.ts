import type { Transaction } from 'dexie'
import type { IDatabaseUpgrade } from './i-database-upgrade'
import DBTables from 'src/app/core/constants/db-tables'

export class DropIdFieldUpgrade implements IDatabaseUpgrade {
    public readonly version = 68

    public async apply(tx: Transaction) {
        try {
            // Check if 'Id' field exists in any record
            const dataTable = tx.table<any>(DBTables.Cells)
            await dataTable.toCollection().modify((obj: any) => {
                if ('Id' in obj) {
                    delete obj.Id
                }
            })
        } catch (error) {
            console.error("Error dropping 'Id' field:", error)
        }   
    }
}
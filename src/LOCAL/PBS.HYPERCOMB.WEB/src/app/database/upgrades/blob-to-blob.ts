import type { Transaction } from "dexie"
import { IDatabaseUpgrade } from "./i-database-upgrade"

export class BlobToBlobUpgrade implements IDatabaseUpgrade {
    public readonly version = 72

    public async apply(tx: Transaction) {
        // const table = tx.table("images")
        // await table.toCollection().modify(record => {
        //     if ((record as any).Blob && !(record as any).blob) {
        //         (record as any).blob = (record as any).Blob
        //         delete (record as any).Blob
        //     }
        // })
    }
}
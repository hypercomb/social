// i-database-upgrade.ts
import type { Transaction } from "dexie"
import { ImageDatabase } from "../images/image-database"

export interface IDatabaseUpgrade {
    readonly version: number   // enforce explicit version
    apply(tx: Transaction, imageDb?: ImageDatabase): Promise<void>  // method to apply the upgrade
}

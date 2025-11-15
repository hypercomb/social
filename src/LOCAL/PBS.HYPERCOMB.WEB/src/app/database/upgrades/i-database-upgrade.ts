// i-database-upgrade.ts
import type { Transaction } from "dexie"

export interface IDatabaseUpgrade {
    readonly version: number   // enforce explicit version
    apply(tx: Transaction): Promise<void>  // method to apply the upgrade
}

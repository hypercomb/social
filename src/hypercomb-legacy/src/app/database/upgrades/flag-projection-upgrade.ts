// flag-projection-upgrade.ts
import type { Transaction } from "dexie"
import { IDatabaseUpgrade } from "./i-database-upgrade"
import { CellOptions } from "src/app/cells/models/cell-options"

export class FlagProjectionUpgrade implements IDatabaseUpgrade {
    public readonly version = 71

    public async apply(tx: Transaction) {
        const table = tx.table("data")

        await table.toCollection().modify(row => {
            const options: number = row.options ?? 0

            row.isActive = (options & CellOptions.Active) !== 0
            row.isBranch = (options & CellOptions.Branch) !== 0
            row.isDeleted = (options & CellOptions.Deleted) !== 0
            row.isHidden = (options & CellOptions.Hidden) !== 0
            row.isSelected = (options & CellOptions.Selected) !== 0
            row.isFocusedMode = (options & CellOptions.FocusedMode) !== 0
            row.isLocked = (options & CellOptions.Locked) !== 0
            row.isRecenter = (options & CellOptions.Recenter) !== 0
        })
    }
}

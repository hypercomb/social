import { Injectable } from '@angular/core'
import { Transaction } from 'dexie'
import { Constants } from 'src/app/helper/constants'
import { IDatabaseUpgrade } from './i-database-upgrade'
import { IPropertyMapper, TilePropertyMapper } from './tile-property-mapper'
import { Cell } from 'src/app/cells/cell'
import DBTables from 'src/app/core/constants/db-tables'

@Injectable({ providedIn: 'root' })
export class IsBranchUpgrade implements IDatabaseUpgrade {
    protected get propertyResolver(): IPropertyMapper<Cell> {
        return { sourceProperty: 'IsHypercell', targetProperty: 'isBranch' }
    }

    constructor(private tilePropertyMapper: TilePropertyMapper) { }
    version: number = 57
    apply(tx: Transaction) {

    }

    public complete = async (transaction: Transaction) => {
        await transaction.table(DBTables.Cells).toCollection().modify(itemToUpdate => {
            const from = new Cell(itemToUpdate)
            this.tilePropertyMapper.map(this.propertyResolver, from, itemToUpdate)
        })
    }
}
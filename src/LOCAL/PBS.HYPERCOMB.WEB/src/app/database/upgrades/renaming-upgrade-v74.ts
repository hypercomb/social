import { Injectable } from '@angular/core'
import { Transaction } from 'dexie'
import { IDatabaseUpgrade } from './i-database-upgrade'
import { IPropertyMapper, TilePropertyMapper } from './tile-property-mapper'
import { Cell } from 'src/app/cells/cell'
import DBTables from 'src/app/core/constants/db-tables'

@Injectable({ providedIn: 'root' })
export class NamingUpgradeNewSchema implements IDatabaseUpgrade {
    version: number = 75

    constructor(private tilePropertyMapper: TilePropertyMapper) { }

    // define all field mappings from old schema → new schema
    protected readonly propertyResolvers: IPropertyMapper<Cell>[] = [
        { sourceProperty: 'TileId', targetProperty: 'cellId' },
        { sourceProperty: 'Hive', targetProperty: 'hive' },
        { sourceProperty: 'Name', targetProperty: 'name' },
        { sourceProperty: 'SourceId', targetProperty: 'sourceId' },
        { sourceProperty: 'UniqueId', targetProperty: 'uniqueId' },
        { sourceProperty: 'DateCreated', targetProperty: 'dateCreated' },

        // style / appearance
        { sourceProperty: 'BackgroundColor', targetProperty: 'backgroundColor' },
        { sourceProperty: 'BorderColor', targetProperty: 'borderColor' },
        { sourceProperty: 'Link', targetProperty: 'link' },

        // flags (booleans)
        { sourceProperty: 'IsActive', targetProperty: 'isActive' },
        { sourceProperty: 'IsBranch', targetProperty: 'isBranch' },
        { sourceProperty: 'IsDeleted', targetProperty: 'isDeleted' },
        { sourceProperty: 'IsHidden', targetProperty: 'isHidden' }, 

        // catch-all (legacy Flag → options)
        { sourceProperty: 'Flag', targetProperty: 'options' }
    ]

    public apply = async (transaction: Transaction) => {
        const table = transaction.table(DBTables.Cells)

        await table.toCollection().modify(itemToUpdate => {
            
            const from = new { ...itemToUpdate }

            delete (itemToUpdate as any).WindowWidth
            delete (itemToUpdate as any).WindowHeight
            delete (itemToUpdate as any).BlobHash
            delete (itemToUpdate as any).isInitialized

            for (const resolver of this.propertyResolvers) {
                this.tilePropertyMapper.map(resolver, from, itemToUpdate)
            }

            // ensure defaults
            itemToUpdate.tagIds = itemToUpdate.tagIds ?? []
            itemToUpdate.options = itemToUpdate.options ?? 0

            if (itemToUpdate.dateCreated) {
                itemToUpdate.dateCreated = new Date(itemToUpdate.dateCreated).toISOString()
            }
            if (itemToUpdate.dateDeleted) {
                itemToUpdate.dateDeleted = new Date(itemToUpdate.dateDeleted).toISOString()
            }
            if (itemToUpdate.updatedAt) {
                itemToUpdate.updatedAt = new Date(itemToUpdate.updatedAt).toISOString()
            }

            // strip legacy props
            delete (itemToUpdate as any).IsRoot
            delete (itemToUpdate as any).IsStub
            delete (itemToUpdate as any).renamed
            delete (itemToUpdate as any).isInitialized
            delete (itemToUpdate as any).previousIndex
            delete (itemToUpdate as any).setDateDeleted
            delete (itemToUpdate as any).spriteX
            delete (itemToUpdate as any).spriteY
            delete (itemToUpdate as any).type

        })
    }

}

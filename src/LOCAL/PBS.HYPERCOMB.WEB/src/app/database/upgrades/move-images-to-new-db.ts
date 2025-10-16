import type { Transaction } from 'dexie'
import type { IDatabaseUpgrade } from './i-database-upgrade'
import DBTables from 'src/app/core/constants/db-tables'
import { ImageDatabase } from 'src/app/database/images/image-database'
import { IHiveImage } from 'src/app/core/models/i-hive-image'

export class MoveImagesToNewDatabaseUpgrade implements IDatabaseUpgrade {

  public readonly version = 105

  public async apply(tx: Transaction, imageDb?: ImageDatabase): Promise<void> {
    // grab all existing images from the old table
    const oldImages = await tx.table<IHiveImage>(DBTables.Images).toArray()
    if (!oldImages.length) return
    if(!imageDb) throw new Error("Image database not available")  
    
    // insert all old images into the new database

    const db = await imageDb.getDb()
    
    db.transaction('rw', db.table('small'), async () => {
      await db.table('small').bulkPut(oldImages)
    })

    // optional: clear the old table so you don’t import twice
    await tx.table(DBTables.Images).clear()
  }
}

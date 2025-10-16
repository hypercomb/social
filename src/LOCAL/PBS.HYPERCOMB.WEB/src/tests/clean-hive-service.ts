import { Injectable } from '@angular/core'
import { Database } from 'src/app/services/data/default-database/hypercomb-database'

@Injectable({
  providedIn: 'root'
})
export class CleanHiveService {
  constructor(
    private database: Database
  ) { }

  public initialize = async () => {
    try {

      const hiveName = 'next-hive'

      // Fetch hive items
      const hiveItems = await this.database.fetchByHive(hiveName, true)

      // Fetch hive and revision
      const hive = await this.database.db.table('hives').where({ Name: hiveName }).first()

      // Delete hive items
      for (const item of hiveItems) {
        await this.database.db.table('data').delete(item.cellId!)
      }

      // Delete hive
      if (hive) {
        await this.database.db.table('hives').delete(hive.id)
      }

      console.log('Deletion process completed.')
    } catch (error) {
      console.error('Error during deletion process:', error)
    }
  }
}



// i-database-manager.port.ts
import Dexie from 'dexie'

export interface IDatabaseManagerPort {
  /** the live Dexie instance */
  readonly db: Dexie
  /** open or re-open the database */
  initialize()
  /** delete & reset the database */
  clean()
}



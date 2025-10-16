// base-database.ts
import { inject } from '@angular/core'
import Dexie, { Table } from 'dexie'
import { DatabaseService } from './database-service'

/**
 * base infra class: exposes dexie instance + tables
 * no domain knowledge here
 */
export abstract class BaseDatabase {
  protected readonly dbProvider = inject(DatabaseService)

  public get db(): Dexie {
    return this.dbProvider.db
  }

  public get tables(): Table[] {
    return this.db.tables
  }
}



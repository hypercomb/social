import "dexie-export-import"
import { inject, Injectable, signal, untracked } from "@angular/core"
import Dexie, { Transaction } from "dexie"
import DBTables from "src/app/core/constants/db-tables"
import { allUpgrades } from "src/app/database/upgrades/all-upgrades"
import { DebugService } from "src/app/core/diagnostics/debug-service"

@Injectable({ providedIn: "root" })
export class DatabaseService {

  protected readonly debug = inject(DebugService)
  public readonly CURRENT_DATA_VERSION = 108

  // 🔑 active hive db
  private readonly _db = signal<Dexie | undefined>(undefined)
  public readonly db = this._db.asReadonly()

  // shared db
  private readonly _sharedDb = signal<Dexie | undefined>(undefined)
  public readonly sharedDb = this._sharedDb.asReadonly()


  private createHiveDatabase(): Dexie {
    const db = new Dexie("Database")

    const tokens = [
      "++cellId",
      "kind",
      "uniqueId",
      "dateCreated",
      // if you query by hive, add it once:
      // "hive",
      "sourceId",
      "smallImageId",
      "largeImageId",
      // boolean flags you truly filter on (each appears ONCE)
      "isDeleted", "isActive", "isBranch", "isHidden", "isFocusedMode", "isLocked",
      "isHive", "isPathway", "isRecenter",
    ]
    const cellSchema = tokens.join(",")

    db.version(this.CURRENT_DATA_VERSION)
      .stores({
        [DBTables.Cells]: cellSchema,
        [DBTables.Tags]: "++id,&slug,name"
      })
      .upgrade(tx => this.applyUpgrades(tx))
    this._db.set(db)
    return db
  }

  public async ensureHiveDb(): Promise<Dexie> {
    if (!this._db()) {
      this.createHiveDatabase()
    }
    return this._db()!
  }

  public async importHive(blob: Blob): Promise<void> {
    const db = this._db()
    await (db as Dexie).import(blob, {
      clearTablesBeforeImport: true,
      skipTables: [DBTables.Images]
    })
    this.debug.log('database', "✅ imported hive into Database")
  }

  public async isLive(): Promise<boolean> {
    const db = this._db();
    if (!db) return false;

    try {
      const count = await db.table(DBTables.Cells).count();
      return count > 0;
    } catch (err) {
      this.debug.warn('database', "⚠️ failed to check database live status:", err)
      return false;
    }
  }


  // ──────────────────────────────────────────────────────
  // Shared DB
  // ──────────────────────────────────────────────────────
  public async openShared(): Promise<Dexie> {
    if (!this._sharedDb()) {
      const db = new Dexie("hypercomb-shared")
      db.version(1).stores({
        settings: "++id,key"
      })
      await db.open()
      this._sharedDb.set(db)
    }
    return this._sharedDb()!
  }

  // ──────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────
  private async applyUpgrades(tx: Transaction): Promise<void> {
    const upgrades = allUpgrades.slice().sort((a, b) => a.version - b.version)
    for (const up of upgrades) {
      if (up.version <= this.CURRENT_DATA_VERSION) {
        await up.apply(tx)
      }
    }
  }

  public setDb = (db: Dexie) => {
    this._db.set(untracked(() => db))
  }
}

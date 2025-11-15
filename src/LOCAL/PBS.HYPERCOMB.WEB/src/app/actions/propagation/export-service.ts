// src/app/actions/propagation/export-service.ts
import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "src/app/database/database-service"
import { exportDB } from "dexie-export-import"
import { OpfsHiveService } from "src/app/hive/storage/opfs-hive-service"

@Injectable({ providedIn: "root" })
export class ExportService extends DatabaseService {
  private readonly database = inject(DatabaseService)
  private readonly opfsHive = inject(OpfsHiveService)

  // export current in-memory db as blob
  public async export(): Promise<Blob> {
    return await exportDB(this.database.db()!, { prettyJson: true })
  }

  // save current hive to opfs
  public async save(hiveName: string): Promise<void> {
    const blob = await this.export()
    await this.opfsHive.saveHive(hiveName, blob)
    this.debug.log("export", `hive '${hiveName}' saved to opfs`)
  }
}

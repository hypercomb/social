// src/app/actions/propagation/export-service.ts
import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "src/app/database/database-service"
import { exportDB } from "dexie-export-import"

@Injectable({ providedIn: "root" })
export class ExportService extends DatabaseService {
  private readonly database = inject(DatabaseService)

  // Export current in-memory DB as Blob
  public async export(): Promise<Blob> {
    return await exportDB(this.database.db()!, { prettyJson: true })
  }

  // Save current hive to OPFS
  public async save(hiveName: string): Promise<void> {
    const blob = await this.export()
    const root = await navigator.storage.getDirectory()
    const hivesDir = await root.getDirectoryHandle("hives", { create: true })
    const fileHandle = await hivesDir.getFileHandle(`${hiveName}.json`, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
    this.debug.log('export', `Hive '${hiveName}' saved to OPFS`)
  }
}
// src/app/actions/propagation/import-service.ts
import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "src/app/database/database-service"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { OpfsHiveService } from "src/app/hive/storage/opfs-hive-service"
import { OpfsImageService } from "src/app/hive/storage/opfs-image.service"

@Injectable({ providedIn: "root" })
export class DatabaseImportService {
  private readonly database = inject(DatabaseService)
  private readonly opfs = inject(OpfsHiveService)
  private readonly debug = inject(DebugService)
  private readonly images = inject(OpfsImageService)

  // load a hive by name → ensure it's ready → import into Dexie
  public importByName = async (fileName: string): Promise<void> => {
    // auto-promote if needed
    await this.opfs.ensureHiveReady(fileName)

    const hive = await this.opfs.loadHive(fileName)
    if (!hive || !hive.file) {
      this.debug.log("import", `⚠️ opfs hive not found: ${fileName}`)
      return
    }

    await this.importDirect(hive.file)
  }

  // import a database json blob directly using dexie-export-import
  public importDirect = async (blob: Blob): Promise<void> => {
    const db = this.database.db()
    if (!db) {
      this.debug.log("import", "❌ database not ready for import")
      return
    }

    performance.mark("import-start")

    // pure import, no transform
    await db.import(blob, {
      overwriteValues: true,
      acceptVersionDiff: true,
      clearTablesBeforeImport: true,
      skipTables: ["hierarchy"]
    })

    this.debug.log("import", "✅ imported normalized hive")

    performance.measure("import-duration", "import-start")
    const measure = performance.getEntriesByName("import-duration").pop()
    if (measure) {
      this.debug.log("import", `⏱️ import took ${measure.duration.toFixed(2)} ms`)
    }
  }

}

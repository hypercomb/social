import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "src/app/database/database-service"
import { exportDB } from "dexie-export-import"
import JSZip from "jszip"
import * as download from "downloadjs"

@Injectable({ providedIn: "root" })
export class DatabaseExportService extends DatabaseService {
  private readonly database = inject(DatabaseService)


  // export full Dexie database
  public async export(): Promise<Blob> {
    return await exportDB(this.database.db()!, { prettyJson: true })
  }

  // save current hive database to OPFS /hives/<hiveName>.json
  public async save(hiveName: string): Promise<void> {
    const blob = await this.export()
    const root = await navigator.storage.getDirectory()
    const hivesDir = await root.getDirectoryHandle("hives", { create: true })
    const fileHandle = await hivesDir.getFileHandle(`${hiveName}.json`, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()

    this.debug.log('import', `✅ Hive '${hiveName}' saved to OPFS at /hives/${hiveName}.json`)
  }

  // optional: bundle all hives to zip for backup
  public async exportGroupFromOpfs(): Promise<void> {
    const root = await navigator.storage.getDirectory()
    const hivesDir = await root.getDirectoryHandle("hives", { create: true })
    const zip = new JSZip()

    for await (const [name, handle] of hivesDir.entries()) {
      if (handle.kind !== "file") continue
      const fileHandle = handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      zip.file(name, await file.text())
    }

    const blob = await zip.generateAsync({ type: "blob" })
    download(blob, "hypercomb-hives.zip", "application/zip")
    this.debug.log('import', `✅ Exported all hives to zip`)
  }
}

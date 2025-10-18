import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "src/app/database/database-service"
import { ImportTransformRegistry } from "../../database/upgrades/transforms/import-transform.registry"
import { ImageDatabase } from "src/app/database/images/image-database"
import DBTables from "src/app/core/constants/db-tables"
import { Hive } from "src/app/cells/cell"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { OpfsHiveService } from "src/app/hive/storage/opfs-hive-service"

export interface IOpfsHiveRecord {
  name: string
  background: string
  importedAt: string
}

@Injectable({ providedIn: "root" })
export class DatabaseImportService {
  private readonly database = inject(DatabaseService)
  private readonly transforms = inject(ImportTransformRegistry)
  private readonly imageDb = inject(ImageDatabase)
  private readonly manager = inject(OpfsManager)
  private readonly opfs = inject(OpfsHiveService)
  private readonly debug = inject(DebugService)

  /**
   * Import a database JSON blob into Dexie with transforms applied.
   */
  public async import(blob: Blob): Promise<void> {
    const json = await blob.text()
    const parsed = JSON.parse(json)
    const { data } = parsed.data

    for (const table of data) {
      const tableName = table.tableName

      // skip if this table doesn't exist in Dexie
      const dexieTable = this.database.db()!.tables.find(t => t.name === tableName)
      if (!dexieTable) continue

      for (const row of table.rows as any[]) {
        let transformed: { value: any; key?: any } = { value: row }

        const transforms = this.transforms.getTransformsFor(tableName)
        for (const transform of transforms) {
          transformed = transform.transform(tableName, transformed.value, transformed.key)
        }

        if (!transformed.value?.isDeleted) {
          await dexieTable.put(transformed.value, transformed.key)
        }
      }
    }
    this.debug.log('import', `✅ imported ${data.length} tables with transforms`)
  }

  public async importByName(fileName: string): Promise<void> {
    const hive = await this.opfs.loadHive(fileName)
    if (!hive || !hive.file) {
      this.debug.log('import', `⚠️ OPFS hive not found: ${fileName}, skipping importByName`)
      return
    }
    await this.importDirect(hive.file)
  }
  /**
   * Import a database JSON blob directly using Dexie-export-import.
   */
  public async importDirect(blob: Blob): Promise<void> {
    const transform = (table: string, value: any, key?: any): { value: any; key?: any } => {
      if (table !== DBTables.Cells) return { value, key }
      if (!(value?.blob instanceof Blob)) return { value, key }

      const blobCopy = value.blob
      delete value.blob

      ;(async () => {
        try {
          const [mainDb, imageDb] = [this.database.db()!, await this.imageDb.getDb()]
          let image = await imageDb.table(DBTables.SmallImages)
            .where({ cellId: value.cellId }).first()

          if (!image) {
            const result = await imageDb.table(DBTables.SmallImages).add({
              hive: value.hive,
              cellId: value.cellId,
              blob: blobCopy
            })
            const smallImageId = result as number

            await mainDb.transaction('rw', mainDb.table(table), async tx => {
              const cell = await tx.table(table).get(value.cellId)
              if (cell) {
                cell.smallImageId = smallImageId
                await tx.table(table).update(cell.cellId, cell)
              } else {
                await tx.table(table).add({
                  cellId: value.cellId,
                  hive: value.hive,
                  smallImageId
                })
              }
            })
          }
        } catch (err) {
          this.debug.log('import', "import transactional image insert failed:", err)
        }
      })()

      return { value, key }
    }

    performance.mark("import-start")
    await this.database.db()!.import(blob, {
      overwriteValues: true,
      acceptVersionDiff: true,
      clearTablesBeforeImport: true,
      skipTables: ["hierarchy"],
      transform
    })
    this.debug.log('import', `✅ imported database directly with Dexie-import-export`)

    performance.measure("import-duration", "import-start")
    const measure = performance.getEntriesByName("import-duration").pop()
    if (measure) {
      this.debug.log('import', `⏱️ import took ${measure.duration.toFixed(2)} ms`)
    }
  }

  // ─────────────────────────────────────────────
  // clear folder recursively
  // ─────────────────────────────────────────────
  public clearExistingFolder = async (dir: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      try {
        await dir.removeEntry(name, { recursive: handle.kind === "directory" })
        this.debug.log('import', `🗑️ removed ${name}`)
      } catch (err) {
        this.debug.log('import', `⚠️ failed to remove ${name}:`, err)
      }
    }
  }

  /**
   * Import group of hives directly to OPFS and update opfs-hives.json
   */
  public async importGroupToOpfs(files: FileList): Promise<void> {
    if (!files?.length) return

    const root = await this.manager.getRoot()
    const hivesDir = await root.getDirectoryHandle("hives", { create: true })
    const imagesDir = await root.getDirectoryHandle("hive-images", { create: true })

    // clear previous folder
    await this.clearExistingFolder(hivesDir)

    const imported: IOpfsHiveRecord[] = await this.opfs.getRegistry()

    for (const file of Array.from(files)) {
      this.debug.log('import', `📂 processing ${file.name}...`)
      const start = performance.now()
      try {
        const jsonText = await file.text()
        const json = JSON.parse(jsonText)
        const hive = <Hive>json.data.data[0].rows[0]

        const blobData = json?.data?.data?.[0]?.rows?.[0]?.blob
        if (blobData) {
          let blob: Blob | null = null
          if (blobData.data && blobData.type) {
            const byteArray = Uint8Array.from(atob(blobData.data), c => c.charCodeAt(0))
            blob = new Blob([byteArray], { type: blobData.type })
          } else if (blobData instanceof Blob) {
            blob = blobData
          }

          if (blob) {
            const ext = blob.type?.split("/")[1] || "bin"
            const imageName = `${file.name.replace('.json', '')}.${ext}`
            const imageHandle = await imagesDir.getFileHandle(imageName, { create: true })
            const writableImg = await imageHandle.createWritable()
            await writableImg.write(blob)
            await writableImg.close()
            this.debug.log('import', `🖼️ saved ${imageName} to /hive-images/`)
          }
        }

        const hiveFileName = file.name.endsWith(".json") ? file.name : `${file.name}.json`
        const fileHandle = await hivesDir.getFileHandle(hiveFileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(jsonText)
        await writable.close()

        // update record list
        imported.push({
          name: hiveFileName,
          background: hive.backgroundColor,
          importedAt: new Date().toISOString()
        })

        const end = performance.now()
        this.debug.log('import', `✅ ${file.name} imported in ${(end - start).toFixed(2)} ms`)
      } catch (err) {
        this.debug.log('import', `❌ failed to import ${file.name}:`, err)
      }
    }

    // deduplicate by name (keep last)
    const unique = Array.from(new Map(imported.map(h => [h.name, h])).values())

    await this.manager.writeRegistry(unique)
    this.debug.log('import', `📘 saved ${unique.length} unique hive records to opfs-hives.json`)
  }

}

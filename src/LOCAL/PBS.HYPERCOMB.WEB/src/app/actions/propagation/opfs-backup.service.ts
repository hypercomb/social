// src/app/common/opfs/opfs-backup.service.ts
import { Injectable, inject } from "@angular/core"
import JSZip from "jszip"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Injectable({ providedIn: "root" })
export class OpfsBackupService {
  private readonly opfs = inject(OpfsManager)

  private async hivesDir() {
    return await this.opfs.ensureDirs(["hives"])
  }

  private async smallImagesDir() {
    return await this.opfs.ensureDirs(["hive-images", "small"])
  }
  
  private normalize(name: string) {
    return name.endsWith(".json") ? name : `${name}.json`
  }

  // ───────────────────────────────────────────────
  // Export a single hive + its referenced small images
  // ───────────────────────────────────────────────
  public async exportHiveAsZip(hiveName: string): Promise<Blob> {
    const fileName = this.normalize(hiveName)
    const hives = await this.hivesDir()
    const smallImages = await this.smallImagesDir()

    const zip = new JSZip()

    // read hive JSON
    const hiveHandle = await this.opfs.getFile(hives, fileName)
    const hiveFile = await this.opfs.readFile(hiveHandle)
    const jsonText = await hiveFile.text()
    zip.file(fileName, jsonText)

    // parse → collect hashes
    const json = JSON.parse(jsonText)
    const rows = json?.data?.data?.[0]?.rows ?? []
    const hashes = new Set<string>()

    for (const row of rows) {
      if (typeof row.smallImageId === 'string') {
        hashes.add(row.smallImageId)
      }
    }

    // list small image entries
    const imageEntries = await this.opfs.listEntries(smallImages)

    // include only referenced images
    for (const { name, handle } of imageEntries) {
      if (!hashes.has(name)) continue
      if (handle.kind !== 'file') continue

      const file = await this.opfs.readFile(handle as FileSystemFileHandle)
      zip.file(`images/small/${name}`, file)
    }

    return await zip.generateAsync({ type: "blob" })
  }

  // ───────────────────────────────────────────────
  // Export ALL hives + ALL small images
  // ───────────────────────────────────────────────
  public async exportAllAsZip(): Promise<Blob> {
    const hives = await this.hivesDir()
    const images = await this.smallImagesDir()

    const zip = new JSZip()

    // hives
    const hiveEntries = await this.opfs.listEntries(hives)
    for (const { name, handle } of hiveEntries) {
      if (handle.kind !== "file") continue
      const file = await this.opfs.readFile(handle as FileSystemFileHandle)
      zip.file(`hives/${name}`, await file.text())
    }

    // small images
    const imgEntries = await this.opfs.listEntries(images)
    for (const { name, handle } of imgEntries) {
      if (handle.kind !== "file") continue
      const file = await this.opfs.readFile(handle as FileSystemFileHandle)
      zip.file(`images/small/${name}`, file)
    }

    return await zip.generateAsync({ type: "blob" })
  }

  // ───────────────────────────────────────────────
  // Native "Save As…" dialog
  // ───────────────────────────────────────────────
  public async saveBlobWithNativeDialog(blob: Blob, suggestedName: string) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "ZIP archive",
            accept: { "application/zip": [".zip"] }
          }
        ]
      })

      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()

    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("save dialog failed", err)
      }
    }
  }
}

// src/app/common/opfs/opfs-backup.service.ts
import { Injectable } from "@angular/core"
import JSZip from "jszip"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Injectable({ providedIn: "root" })
export class OpfsBackupService {
  private readonly opfs = new OpfsManager()

  /** --------------------------------------------------------------
   *  Export a **single** hive + optional background image.
   *  Returns the generated ZIP **Blob**.
   *  -------------------------------------------------------------- */
  public async exportHiveAsZip(hiveName: string): Promise<Blob> {
    const root = await this.opfs.getRoot()
    const hivesDir = await this.opfs.getDir("hives")
    const imagesDir = await this.opfs.getDir("hive-images")

    const zip = new JSZip()

    // 1. DB JSON
    const dbHandle = await hivesDir.getFileHandle(hiveName)
    const dbFile = await this.opfs.readFile(dbHandle)
    zip.file(hiveName, await dbFile.text())

    // 2. Background image (if any)
    try {
      const baseName = hiveName.replace(/\.json$/i, "")
      for await (const [imgName, imgHandle] of imagesDir.entries()) {
        if (imgHandle.kind === "file" && imgName.startsWith(baseName)) {
          const imgFile = await this.opfs.readFile(imgHandle as FileSystemFileHandle)
          zip.file(`background/${imgName}`, imgFile)
          break
        }
      }
    } catch {
      // no image – ignore
    }

    return await zip.generateAsync({ type: "blob" })
  }

  /** --------------------------------------------------------------
   *  Export **all** hives + all images.
   *  Returns the generated ZIP **Blob**.
   *  -------------------------------------------------------------- */
  public async exportAllAsZip(): Promise<Blob> {
    const root = await this.opfs.getRoot()
    const hivesDir = await this.opfs.getDir("hives")
    const imagesDir = await this.opfs.getDir("hive-images")

    const zip = new JSZip()

    // ---- hives -------------------------------------------------
    for await (const [name, handle] of hivesDir.entries()) {
      if (handle.kind !== "file") continue
      const file = await this.opfs.readFile(handle as FileSystemFileHandle)
      zip.file(`hives/${name}`, await file.text())
    }

    // ---- images ------------------------------------------------
    for await (const [name, handle] of imagesDir.entries()) {
      if (handle.kind !== "file") continue
      const file = await this.opfs.readFile(handle as FileSystemFileHandle)
      zip.file(`images/${name}`, file)
    }

    return await zip.generateAsync({ type: "blob" })
  }

  // -----------------------------------------------------------------
  // Helper: open a native “Save As” dialog using the File System Access API
  // -----------------------------------------------------------------
  public async saveBlobWithNativeDialog(
    blob: Blob,
    suggestedName: string
  ): Promise<void> {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "ZIP archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (err: any) {
      // User cancelled or browser doesn't support the API
      if (err.name !== "AbortError") {
        console.error("Save dialog failed:", err)
      }
    }
  }
}
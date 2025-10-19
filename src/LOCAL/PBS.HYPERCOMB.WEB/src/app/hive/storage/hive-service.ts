// src/app/hives/hive-service.ts
import { Injectable, inject } from "@angular/core"
import { HypercombData } from "src/app/actions/hypercomb-data"
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token"
import { IDexieHive } from "../hive-models"
import { OpfsHiveService } from "./opfs-hive-service"

@Injectable({ providedIn: "root" })
export class HiveService extends HypercombData {
  private readonly opfs = inject(OpfsHiveService)
  private readonly controller = inject(HIVE_CONTROLLER_ST)

  private lastActivatedName: string | null = null // 🔑 track last hive

  // store mutations
  public next = () => this.controller.next()
  public prev = () => this.controller.prev()

  public setActive = (hiveName: string): void => {
    // only trigger if new hive
    if (this.lastActivatedName !== hiveName) {
      this.controller.setActive(hiveName)
    }
  }

  public async moveHiveToHistory(hiveName: string): Promise<void> {
    const opfsRoot = await navigator.storage.getDirectory();
    const hiveDir = await opfsRoot.getDirectoryHandle('hive');
    const historyDir = await opfsRoot.getDirectoryHandle('history', { create: true });

    // Find the file
    const hiveFile = await hiveDir.getFileHandle(hiveName);

    // Create a timestamp
    const now = new Date();
    const datestamp = now.toISOString().replace(/[:.]/g, '-')
    const historyFileName = `${hiveName}]-[${datestamp}`

    // Copy file contents
    const file = await hiveFile.getFile()
    const historyFile = await historyDir.getFileHandle(historyFileName, { create: true });
    const writable = await historyFile.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();

    // Remove the original
    await hiveDir.removeEntry(hiveName);
  }


  public async rename(): Promise<IDexieHive> {
    // const oldFilename = `${old.name}.json`
    // const newFilename = `${newName}.json`

    // const oldFileHandle = await hivesDir.getFileHandle(oldFilename)
    // const file = await oldFileHandle.getFile()
    // const text = await file.text()

    // const newHandle = await hivesDir.getFileHandle(newFilename, { create: true })
    // const writable = await newHandle.createWritable()
    // await writable.write(text)
    // await writable.close()

    // await hivesDir.removeEntry(oldFilename)

    // const updated: IDexieHive = { name: newName, file: { ...old.file, name: newName } }
    // this.controller.replace(old.name, updated)

    // return updated
    throw new Error("Renaming hives is not yet implemented.")
  }

  public async removeHive(hive: IDexieHive): Promise<void> {
    const hivesDir = await this.opfs.getHivesDir()
    const filename = `${hive.name}.json`
    await hivesDir.removeEntry(filename)
    this.controller.remove(hive.name)
  }
}

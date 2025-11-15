// src/app/hives/hive-service.ts
import { Injectable, inject } from "@angular/core"
import { HypercombData } from "src/app/actions/hypercomb-data"
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token"
import { IDexieHive } from "../hive-models"
import { OpfsHiveService } from "./opfs-hive-service"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Injectable({ providedIn: "root" })
export class HiveService extends HypercombData {
  private readonly opfsHives = inject(OpfsHiveService)
  private readonly opfs = inject(OpfsManager)
  private readonly controller = inject(HIVE_CONTROLLER_ST)

  private lastActivatedName: string | null = null

  // store navigation
  public next = () => this.controller.next()
  public prev = () => this.controller.prev()

  public setActive = (hiveName: string) => {
    if (this.lastActivatedName !== hiveName) {
      this.controller.setActive(hiveName)
      this.lastActivatedName = hiveName
    }
  }

  // ───────────────────────────────────────────────────────────────
  // move hive.json → history/<hive.json]-[ISO timestamp>
  // fully aligned with OpfsManager and your directory layout
  // ───────────────────────────────────────────────────────────────
  public async moveHiveToHistory(hiveName: string) {
    const fileName = hiveName.endsWith(".json") ? hiveName : `${hiveName}.json`

    const root = await this.opfs.root()
    const hivesDir = await root.getDirectoryHandle("hives", { create: true })
    const historyDir = await root.getDirectoryHandle("history", { create: true })

    const hiveHandle = await hivesDir.getFileHandle(fileName)
    const hiveFile = await hiveHandle.getFile()

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const historyName = `${fileName}]-[${timestamp}`

    const outHandle = await historyDir.getFileHandle(historyName, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(await hiveFile.arrayBuffer())
    await writable.close()

    // remove from /hives
    await hivesDir.removeEntry(fileName)

    // update registry through OpfsHiveService
    const registry = await this.opfsHives.getRegistry()
    await this.opfsHives.updateRegistry(registry.filter(r => r.name !== fileName))

    this.controller.remove(hiveName.replace(/\.json$/, ""))
  }

  // ───────────────────────────────────────────────────────────────
  // rename not implemented
  // ───────────────────────────────────────────────────────────────
  public async rename() {
    throw new Error("Renaming hives is not yet implemented")
  }

  // ───────────────────────────────────────────────────────────────
  // delete hive (delegates to OpfsHiveService)
  // ───────────────────────────────────────────────────────────────
  public async removeHive(hive: IDexieHive) {
    await this.opfsHives.deleteHive(hive.name)
    this.controller.remove(hive.name)
  }
}

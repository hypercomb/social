// hypercomb-legacy/src/app/hive/storage/opfs-image.service.ts

import { Injectable, inject } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Injectable({ providedIn: "root" })
export class OpfsImageService {
  private readonly opfs = inject(OpfsManager)

  public smallDir = async () =>
    await this.opfs.ensureDirs(["hive-images", "small"])

  public largeDir = async () =>
    await this.opfs.ensureDirs(["hive-images", "large"])

  public tempDir = async () =>
    await this.opfs.ensureDirs(["hive-images", "temp"])


  // save small
  public async saveSmall(name: string, blob: Blob): Promise<void> {
    const dir = await this.smallDir()
    await this.opfs.writeFile(dir, name, blob)
  }

  // save large
  public async saveLarge(name: string, blob: Blob): Promise<void> {
    const dir = await this.largeDir()
    await this.opfs.writeFile(dir, name, blob)
  }

  // move old large → temp folder
  public async moveLargeToTemp(oldName: string): Promise<void> {
    const fromDir = await this.largeDir()
    const toDir = await this.tempDir()
    await this.opfs.moveFileIfExists(fromDir, toDir, oldName)
  }

  public async loadSmall(name: string): Promise<Blob | null> {
    try {
      const dir = await this.smallDir()
      const fh = await this.opfs.getFile(dir, name)
      return await this.opfs.readFile(fh)
    } catch {
      return null
    }
  }

  public async loadLarge(name: string): Promise<Blob | null> {
    try {
      const dir = await this.largeDir()
      const fh = await this.opfs.getFile(dir, name)
      return await this.opfs.readFile(fh)
    } catch {
      return null
    }
  }
}

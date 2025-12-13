// src/app/hive/storage/resource-manager.ts
import { Injectable, inject } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { HashService } from "./storage/hashing-service"

export interface StagedResource {
  hash: string
  data: Blob | string
}

@Injectable({ providedIn: "root" })
export class ResourceManager {

  private readonly opfs = inject(OpfsManager)

  // in-memory only
  private staged = new Map<string, StagedResource>()

  // -----------------------------------------------------
  // overload definitions
  // -----------------------------------------------------
  public async stage(data: string): Promise<string>
  public async stage(data: Blob): Promise<string>

  // -----------------------------------------------------
  // shared implementation
  // -----------------------------------------------------
  public async stage(data: Blob | string): Promise<string> {
    const hash = await this.computeHash(data)

    // already staged → skip
    if (!this.staged.has(hash)) {
      this.staged.set(hash, { hash, data })
    }

    return hash
  }

  // -----------------------------------------------------
  // type-aware hashing
  // -----------------------------------------------------
  private async computeHash(data: Blob | string): Promise<string> {
    if (typeof data === "string") {
      // text → hash value directly
      return HashService.hash(data)
    }

    // Blob → convert and hash bytes
    return HashService.hashBlob(data)
  }

  // -----------------------------------------------------
  // check if a resource exists on disk
  // -----------------------------------------------------
  private async exists(hiveGene: string, hash: string): Promise<boolean> {
    const dir = await this.opfs.ensureDirs(["hives", hiveGene])

    try {
      await dir.getFileHandle(hash)
      return true
    } catch {
      return false
    }
  }

  // -----------------------------------------------------
  // commit staged resources to OPFS
  // -----------------------------------------------------
  public async commit(hiveGene: string): Promise<void> {
    const dir = await this.opfs.ensureDirs(["hives", hiveGene])

    for (const { hash, data } of this.staged.values()) {
      if (await this.exists(hiveGene, hash)) continue
      await this.opfs.writeFile(dir, hash, data)
    }

    this.staged.clear()
  }

  // -----------------------------------------------------
  // load resource by hash
  // -----------------------------------------------------
  public async load(hiveGene: string, hash: string): Promise<Blob> {
    const dir = await this.opfs.ensureDirs(["hives", hiveGene])
    const fh = await dir.getFileHandle(hash)
    return await fh.getFile()
  }

  // -----------------------------------------------------
  // clear staging
  // -----------------------------------------------------
  public clear(): void {
    this.staged.clear()
  }
}

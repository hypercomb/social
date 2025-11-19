// src/app/hive/storage/opfs-image.service.ts
import { Injectable, inject } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Injectable({ providedIn: "root" })
export class OpfsImageService {
  private readonly opfs = inject(OpfsManager)

  public async ensureSmallDir() {
    return await this.opfs.ensureDirs(["hive-images", "small"])
  }

  private smallDir = async () =>
    await this.opfs.ensureDirs(["hive-images", "small"])

  private largeDir = async () =>
    await this.opfs.ensureDirs(["hive-images", "large"])

  // sha-256
  public async hashName(blob: Blob): Promise<string> {
    try {
      const buf = await blob.arrayBuffer()
      const hash = await crypto.subtle.digest("SHA-256", buf)
      const name = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
      return `${name}.${blob.type.split("/")[1] || "webp"}`
    }
    catch (err) {
      return 'invalid-image-name'
    }

  }

  public async saveSmall(name: string, blob: Blob): Promise<void> {
    const dir = await this.smallDir()
    await this.opfs.writeFile(dir, name, blob)
  }

  public async saveLarge(name: string, blob: Blob): Promise<void> {
    const dir = await this.largeDir()
    await this.opfs.writeFile(dir, name, blob)
  }

  public async loadSmall(name: string): Promise<Blob | null> {
    const dir = await this.smallDir()

    // try full filename first (hash.ext)
    try {
      const fh = await this.opfs.getFile(dir, name)
      return await this.opfs.readFile(fh)
    } catch { }

    // try legacy bare hash
    const legacy = name.split('.')[0]
    try {
      const fh = await this.opfs.getFile(dir, legacy)
      return await this.opfs.readFile(fh)
    } catch { }

    return null
  }

  public async loadLarge(hash: string): Promise<Blob | null> {
    try {
      const dir = await this.largeDir()
      const fh = await this.opfs.getFile(dir, hash)
      return await this.opfs.readFile(fh)
    } catch {
      return null
    }
  }


}

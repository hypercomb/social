// src/app/hive/storage/resource-manager.ts
import { Injectable, inject } from '@angular/core'
import { OpfsManager } from 'src/app/common/opfs/opfs-manager'
import { Signature, HashService } from 'src/app/hive/storage/hash.service'

// -----------------------------------------------------
// staged resource (instruction payload or artifact)
// -----------------------------------------------------
export interface StagedResource {
  signature: Signature
  data: Blob | string
}

@Injectable({ providedIn: 'root' })
export class ResourceManager {

  private readonly opfs = inject(OpfsManager)

  // in-memory write-ahead buffer (intent only)
  private staged = new Map<Signature, StagedResource>()

  // -----------------------------------------------------
  // stage resource (compute signature, no IO yet)
  // -----------------------------------------------------
  public async stage(data: string): Promise<Signature>
  public async stage(data: Blob): Promise<Signature>

  public async stage(data: Blob | string): Promise<Signature> {
    const signature = await HashService.signature(data)

    if (!this.staged.has(signature)) {
      this.staged.set(signature, { signature, data })
    }

    return signature
  } 

  // -----------------------------------------------------
  // commit staged resources to global store
  // -----------------------------------------------------
  public async commit(): Promise<void> {
    if (this.staged.size === 0) return

    const dir = await this.opfs.ensureDirs(['resources'])

    for (const { signature, data } of this.staged.values()) {
      if (await this.exists(dir, signature)) continue
      await this.opfs.writeFile(dir, signature, data)
    }

    this.staged.clear()
  }

  // -----------------------------------------------------
  // load resource by signature (global)
  // -----------------------------------------------------
  public async load(signature: Signature): Promise<Blob> {
    const dir = await this.opfs.ensureDirs(['resources'])
    const handle = await dir.getFileHandle(signature)
    return await handle.getFile()
  }

  // -----------------------------------------------------
  // helpers
  // -----------------------------------------------------
  private async exists(
    dir: FileSystemDirectoryHandle,
    signature: Signature
  ): Promise<boolean> {
    try {
      await dir.getFileHandle(signature)
      return true
    } catch {
      return false
    }
  }

  // -----------------------------------------------------
  // clear staged (abort intent)
  // -----------------------------------------------------
  public clear(): void {
    this.staged.clear()
  }
}

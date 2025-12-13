// src/app/hive/storage/opfs-hive-service.ts
import { Injectable, inject, signal } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Injectable({ providedIn: "root" })
export class HiveService {

  private readonly opfs = inject(OpfsManager)
  // root /hives directory
  private hivesDir = async (): Promise<FileSystemDirectoryHandle> =>
    await this.opfs.ensureDirs(["hives"])

  // ─────────────────────────────────────────────
  // list hive folders → genome hashes
  // ─────────────────────────────────────────────
  public list = async (): Promise<string[]> => {
    const dir = await this.hivesDir()
    const entries = await this.opfs.listEntries(dir)

    return entries
      .filter(e => e.handle.kind === "directory")
      .map(e => e.name)
  }

  // ─────────────────────────────────────────────
  // create hive folder structure
  // /hives/<genomeHash>/{genome,cells}
  // ─────────────────────────────────────────────
  public create = async (genomeHash: string): Promise<void> => {
    await this.opfs.ensureDirs(["hives", genomeHash, "genome"])
    await this.opfs.ensureDirs(["hives", genomeHash, "cells"])
  }

  // ─────────────────────────────────────────────
  // load hive → directory handles
  // ─────────────────────────────────────────────
  public load = async (genomeHash: string) => {
    const hive = await this.opfs.ensureDirs(["hives", genomeHash])
    const genome = await this.opfs.ensureDirs(["hives", genomeHash, "genome"])
    const cells = await this.opfs.ensureDirs(["hives", genomeHash, "cells"])

    return { hive, genome, cells }
  }

  // ─────────────────────────────────────────────
  // delete hive safely → move to /trash/hives/<hash>
  // ─────────────────────────────────────────────
  public delete = async (genomeHash: string): Promise<void> => {
    const hives = await this.hivesDir()
    const trash = await this.opfs.ensureDirs(["trash", "hives"])

    const source = await hives.getDirectoryHandle(genomeHash)
    const target = await trash.getDirectoryHandle(genomeHash, { create: true })

    await this.move(source, target)

    await hives.removeEntry(genomeHash, { recursive: true })
  }

  // recursive directory move
  private move = async (source: FileSystemDirectoryHandle, dest: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [name, handle] of source.entries()) {
      if (handle.kind === "file") {
        const fileHandle = handle as FileSystemFileHandle
        const file = await fileHandle.getFile()
        const buffer = await file.arrayBuffer()
        const blob = new Blob([buffer])

        await this.opfs.writeFile(dest, name, blob)
        continue
      }

      if (handle.kind === "directory") {
        const dirHandle = handle as FileSystemDirectoryHandle
        const childDest = await dest.getDirectoryHandle(name, { create: true })
        await this.move(dirHandle, childDest)
      }
    }
  }

  // ─────────────────────────────────────────────
  // existence check
  // ─────────────────────────────────────────────
  public hasHive = async (genomeHash: string): Promise<boolean> => {
    try {
      const dir = await this.hivesDir()
      await dir.getDirectoryHandle(genomeHash, { create: false })
      return true
    } catch {
      return false
    }
  }

}

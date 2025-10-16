import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class OpfsManager {
  // ─────────────────────────────────────────────
  // root access
  // ─────────────────────────────────────────────
  public async getRoot(): Promise<FileSystemDirectoryHandle> {
    return await navigator.storage.getDirectory()
  }

  // ─────────────────────────────────────────────
  // directory utilities
  // ─────────────────────────────────────────────
  public async getDir(path: string, opts: { create?: boolean } = {}): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot()
    return await root.getDirectoryHandle(path, opts)
  }

  public async listEntries(dir: FileSystemDirectoryHandle): Promise<{ name: string; handle: FileSystemHandle }[]> {
    const entries: { name: string; handle: FileSystemHandle }[] = []
    for await (const [name, handle] of dir.entries()) entries.push({ name, handle })
    return entries
  }

  public async clearDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      await this.deleteEntry(dir, name, handle.kind === "directory")
    }
  }

  public async deleteEntry(dir: FileSystemDirectoryHandle, name: string, recursive = false): Promise<void> {
    await dir.removeEntry(name, { recursive })
  }

  // ─────────────────────────────────────────────
  // file utilities
  // ─────────────────────────────────────────────
  public async getFile(dir: FileSystemDirectoryHandle, name: string, opts: { create?: boolean } = {}): Promise<FileSystemFileHandle> {
    return await dir.getFileHandle(name, opts)
  }

  public async readFile(fileHandle: FileSystemFileHandle): Promise<File> {
    return await fileHandle.getFile()
  }

  public async writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> {
    const fileHandle = await dir.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
  }

  // ─────────────────────────────────────────────
  // hive registry helpers (opfs-hives.json)
  // ─────────────────────────────────────────────
  public async readRegistry(): Promise<any[]> {
    try {
      const root = await this.getRoot()
      const fileHandle = await root.getFileHandle("opfs-hives.json")
      const file = await fileHandle.getFile()
      return JSON.parse(await file.text()) as any[]
    } catch {
      return []
    }
  }

  public async writeRegistry(records: any[]): Promise<void> {
    const root = await this.getRoot()
    const fileHandle = await root.getFileHandle("opfs-hives.json", { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(records, null, 2))
    await writable.close()
  }
}

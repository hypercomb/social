// src/app/common/opfs/opfs-manager.ts
import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class OpfsManager {

  public async root(): Promise<FileSystemDirectoryHandle> {
    return await navigator.storage.getDirectory();
  }

  // recursive ensure
  public async ensureDirs(path: string[]): Promise<FileSystemDirectoryHandle> {
    let dir = await this.root();
    for (const segment of path) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    return dir;
  }

  // basic listing
  public async listEntries(
    dir: FileSystemDirectoryHandle
  ): Promise<{ name: string; handle: FileSystemHandle }[]> {
    const out: { name: string; handle: FileSystemHandle }[] = [];
    for await (const [name, handle] of dir.entries()) out.push({ name, handle });
    return out;
  }

  // read/write
  public async getFile(
    dir: FileSystemDirectoryHandle,
    name: string,
    opts: { create?: boolean } = {}
  ): Promise<FileSystemFileHandle> {
    return await dir.getFileHandle(name, opts);
  }

  public async readFile(handle: FileSystemFileHandle): Promise<File> {
    return await handle.getFile();
  }

  public async writeFile(
    dir: FileSystemDirectoryHandle,
    name: string,
    data: Blob | string
  ): Promise<void> {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  // delete
  public async deleteEntry(
    dir: FileSystemDirectoryHandle,
    name: string,
    recursive = false
  ): Promise<void> {
    await dir.removeEntry(name, { recursive });
  }

  // atomic move if exists
  public async moveFileIfExists(
    fromDir: FileSystemDirectoryHandle,
    toDir: FileSystemDirectoryHandle,
    name: string
  ): Promise<boolean> {
    try {
      const file = await fromDir.getFileHandle(name);
      const blob = await (await file.getFile()).arrayBuffer();
      await this.writeFile(toDir, name, new Blob([blob]));
      await fromDir.removeEntry(name);
      return true;
    } catch {
      return false;
    }
  }

  // registry
  public async readRegistry(): Promise<any[]> {
    try {
      const root = await this.root();
      const fh = await root.getFileHandle("opfs-hives.json");
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch {
      return [];
    }
  }

  public async writeRegistry(records: any[]): Promise<void> {
    const root = await this.root();
    const fh = await root.getFileHandle("opfs-hives.json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(records, null, 2));
    await w.close();
  }
}

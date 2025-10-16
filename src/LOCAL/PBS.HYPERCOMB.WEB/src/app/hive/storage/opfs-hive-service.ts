import { Injectable, inject } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { IDexieHive } from "src/app/hive/hive-models"

@Injectable({ providedIn: "root" })
export class OpfsHiveService {
    private readonly opfs = inject(OpfsManager)

    // get or create the main hives directory
    public async getHivesDir(): Promise<FileSystemDirectoryHandle> {
        return await this.opfs.getDir("hives", { create: true })
    }


    // list all hive files (.json)
    public async listHives(): Promise<IDexieHive[]> {
        const dir = await this.getHivesDir()
        const entries = await this.opfs.listEntries(dir)
        return entries
            .filter(e => e.handle.kind === "file" && e.name.endsWith(".json"))
            .map(e => ({ name: e.name.replace(/\.json$/, ""), file: undefined }))
    }

    // load a single hive file as a DexieHive
    public async loadHive(name: string): Promise<IDexieHive | null> {
        const dir = await this.getHivesDir()
        try {
            const fileHandle = await dir.getFileHandle(`${name}.json`)
            const file = await fileHandle.getFile()
            return { name, file }
        } catch {
            return null
        }
    }


    // write a hive file back to disk
    public async saveHive(name: string, data: Blob | string): Promise<void> {
        const dir = await this.getHivesDir()
        await this.opfs.writeFile(dir, `${name}.json`, data)
    }

    // check existence
    public async hasHive(name: string): Promise<boolean> {
        const dir = await this.getHivesDir()
        try {
            await dir.getFileHandle(`${name}.json`)
            return true
        } catch {
            return false
        }
    }

    // remove a hive
    public async deleteHive(name: string): Promise<void> {
        const dir = await this.getHivesDir()
        await this.opfs.deleteEntry(dir, `${name}.json`)
    }

    // optional: read/write hive registry
    public async getRegistry(): Promise<any[]> {
        return await this.opfs.readRegistry()
    }

    public async updateRegistry(records: any[]): Promise<void> {
        await this.opfs.writeRegistry(records)
    }
}

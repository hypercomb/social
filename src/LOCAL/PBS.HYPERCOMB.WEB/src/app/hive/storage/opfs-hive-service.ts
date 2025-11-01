import { Injectable, inject } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { IDexieHive } from "src/app/hive/hive-models"
import { DebugService } from "src/app/core/diagnostics/debug-service"

@Injectable({ providedIn: "root" })
export class OpfsHiveService {
    private readonly opfs = inject(OpfsManager)
    private readonly debug = inject(DebugService)
    // get or create the main hives directory
    public async getHivesDir(): Promise<FileSystemDirectoryHandle> {
        const dir = await this.opfs.getDir("hives", { create: true })
        this.debug.log("OpfsHiveService: hives directory ready")
        return dir
    }

    // list all hive files (.json)
    public async listHives(): Promise<IDexieHive[]> {
        const dir = await this.getHivesDir()
        const entries = await this.opfs.listEntries(dir)
        const hives = entries
            .filter(e => e.handle.kind === "file" && e.name.endsWith(".json"))
            .map(e => ({
                name: e.name.replace(/\.json$/, ""),
                file: undefined
            } as IDexieHive))

        this.debug.log(`OpfsHiveService: listed ${hives.length} hive(s)`)
        return hives
    }

    // load a single hive file as a DexieHive
    public async loadHive(name: string): Promise<IDexieHive | null> {
        const dir = await this.getHivesDir()
        try {
            const fileHandle = await dir.getFileHandle(`${name}.json`)
            const file = await fileHandle.getFile()
            this.debug.log(`OpfsHiveService: loaded hive ${name}`)
            return { name, file }
        } catch {
            this.debug.log(`OpfsHiveService: failed to load hive ${name}`)
            return null
        }
    }

    // write a hive file back to disk
    public async saveHive(name: string, data: Blob | string): Promise<void> {
        const dir = await this.getHivesDir()
        await this.opfs.writeFile(dir, `${name}.json`, data)
        this.debug.log(`OpfsHiveService: saved hive ${name}`)
    }

    // check existence
    public async hasHive(name: string): Promise<boolean> {
        const dir = await this.getHivesDir()
        try {
            await dir.getFileHandle(`${name}.json`)
            this.debug.log(`OpfsHiveService: hive ${name} exists`)
            return true
        } catch {
            this.debug.log(`OpfsHiveService: hive ${name} not found`)
            return false
        }
    }

    // remove a hive
    public async deleteHive(name: string): Promise<void> {
        const dir = await this.getHivesDir()
        await this.opfs.deleteEntry(dir, `${name}.json`)
        this.debug.log(`OpfsHiveService: deleted hive ${name}`)
    }
    
    public async getFirstHive(): Promise<IDexieHive | null> {
        const dir = await this.getHivesDir()

        for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
            if (handle.kind === "file" && name.endsWith(".json")) {
                const file = await (handle as FileSystemFileHandle).getFile()
                return { name: name.replace(/\.json$/, ""), file }
            }
        }

        return null // no hives found
    }


    // optional: read/write hive registry
    public async getRegistry(): Promise<any[]> {
        const registry = await this.opfs.readRegistry()
        this.debug.log(`OpfsHiveService: registry read (${registry.length} records)`)
        return registry
    }

    public async updateRegistry(records: any[]): Promise<void> {
        await this.opfs.writeRegistry(records)
        this.debug.log(`OpfsHiveService: registry updated (${records.length} records)`)
    }
}

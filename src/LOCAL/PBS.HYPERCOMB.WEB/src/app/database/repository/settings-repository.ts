import { computed, Injectable } from "@angular/core"
import { RepositoryBase } from "./repository.base"
import DBTables from "src/app/core/constants/db-tables"
import { Table } from "dexie"

@Injectable({ providedIn: "root" })
export class SettingsRepository extends RepositoryBase<any> {

    public readonly settingsDb = computed(() => this.database.sharedDb())

    public get = async <T>(key: string): Promise<T | undefined> => {
        const db = this.settingsDb() // unwrap the computed signal
        const table = db?.table(DBTables.Settings) as Table<{ key: string, value: any }> | undefined

        if (!table) return undefined
        const record = await table.get(key)
        return record?.value as T
    }

    // ─────────────────────────────────────────────
    // set setting by key
    // ─────────────────────────────────────────────
    public put = async <T>(key: string, value: T): Promise<void> => {
        const table = this.settingsDb()?.table(DBTables.Settings) as Table<{ key: string, value: any }> | undefined
        if (!table) return
        await table.put({ key, value })
    }
} 
// actions/import-databases-to-opfs.action.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "../action.base"
import { ActionContext } from "../action-contexts"
import { DatabaseImportService } from "src/app/actions/propagation/import-service"

@Injectable({ providedIn: "root" })
export class ImportDatabasesToOpfs extends ActionBase<ActionContext> {
    private readonly importer = inject(DatabaseImportService)
    public static ActionId = "database.import-to-opfs"
    public id = ImportDatabasesToOpfs.ActionId

    public override label = "Import Databases to OPFS"
    public override description = "Import one or more database JSON files and store them under /hives/ in OPFS"
    public override category = "Destructive"
    public override risk: "danger" = "danger"

    public override run = async (_payload: ActionContext): Promise<void> => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "application/json"
        input.multiple = true

        input.onchange = async () => {
            if (input.files && input.files.length > 0) {
                await this.importer.importGroupToOpfs(input.files)
            }
            const hives = await this.listOpfsHives()
        }

        input.click()
    }

    public async listOpfsHives(): Promise<string[]> {
        const root = await navigator.storage.getDirectory()
        const hivesDir = await root.getDirectoryHandle("hives", { create: true })
        const result: string[] = []

        for await (const [name, handle] of hivesDir.entries()) {
            if (handle.kind === "file" && name.endsWith(".json")) {
                result.push(name)
            }
        }

        return result
    }
}

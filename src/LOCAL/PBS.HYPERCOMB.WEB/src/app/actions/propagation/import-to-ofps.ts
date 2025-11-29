// actions/import-databases-to-opfs.action.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "../action.base"
import { ActionContext } from "../action-contexts"
import { OpfsHiveService } from "src/app/hive/storage/opfs-hive-service"

@Injectable({ providedIn: "root" })
export class ImportDatabasesToOpfs extends ActionBase<ActionContext> {
  private readonly hives = inject(OpfsHiveService)

  public static ActionId = "database.import-to-opfs"
  public id = ImportDatabasesToOpfs.ActionId

  public override label = "Import Databases to OPFS"
  public override description =
    "Import one or more database JSON files and store them under /hives/ in OPFS"
  public override category = "Destructive"
  public override risk: "danger" = "danger"

  public override run = async (_payload: ActionContext): Promise<void> => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json"
    input.multiple = true

    input.onchange = async () => {
      if (input.files && input.files.length > 0) {
        const files = Array.from(input.files)
        await this.hives.import(files) 
      }
      // optionally list hives for debug:
      // const hives = await this.hives.listHives()
      // this.debug.log('import', `opfs now has ${hives.length} hive(s)`)
    }

    input.click()
  }
}

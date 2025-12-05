import { Injectable, inject } from "@angular/core"
import { HIVE_STATE } from "src/app/shared/tokens/i-hive-store.token"
import { HiveResolutionType } from "../../hive-models"
import { HiveScout } from "../../hive-scout"
import { HiveLoaderBase, IHiveLoader } from "../hive-loader.base"
import { DatabaseImportService } from "src/app/actions/propagation/import-service"

@Injectable({ providedIn: "root" })
export class NewHiveLoader extends HiveLoaderBase implements IHiveLoader {


    public enabled(scout: HiveScout): boolean {
        // Only enable if database is empty and scout is first hive
        return scout.type === HiveResolutionType.New
    }

    public async load(scout: HiveScout) {


    }
}

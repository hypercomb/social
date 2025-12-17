import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../hive-resolution-type"
import { HiveScout } from "../hive-scout"

import { HiveResolverBase } from "./hive-resolver.base"
import { HiveService } from "src/app/core/hive/hive-service"

@Injectable({ providedIn: "root" })
export class OpfsHiveResolver extends HiveResolverBase {
    private readonly hivesvc = inject(HiveService)
    public override type = HiveResolutionType.Opfs


    public override enabled = async (hiveName: string): Promise<boolean> => {
        const name = hiveName?.trim()
        if (!name) return false

        const exists = await this.hivesvc.hasHive(name)
        if (!exists) return false

        return exists
    }

    public override async resolve(hiveName: string): Promise<HiveScout | null> {
        this.logResolution(`OpfsHiveResolver resolving ${hiveName}`)
        return HiveScout.opfs(hiveName)
    }
}

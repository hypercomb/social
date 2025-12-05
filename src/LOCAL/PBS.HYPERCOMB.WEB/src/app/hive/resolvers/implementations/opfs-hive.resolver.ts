import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../../hive-models"
import { HiveScout } from "../../hive-scout"
import { OpfsHiveService } from "../../storage/opfs-hive-service"
import { HiveResolverBase } from "../../resolvers/hive-resolver.base"

@Injectable({ providedIn: "root" })
export class OpfsHiveResolver extends HiveResolverBase {
    private readonly opfs = inject(OpfsHiveService)
    public override type = HiveResolutionType.Opfs

    public override enabled = async (hiveName: string): Promise<boolean> => {
        const name = hiveName?.trim()
        if (!name) return false

        const exists = await this.opfs.hasHive(name)
        if (!exists) return false

        return exists
    }

    public override async resolve(hiveName: string): Promise<HiveScout | null> {
        this.logResolution(`OpfsHiveResolver resolving ${hiveName}`)
        return HiveScout.opfs(hiveName)
    }
}

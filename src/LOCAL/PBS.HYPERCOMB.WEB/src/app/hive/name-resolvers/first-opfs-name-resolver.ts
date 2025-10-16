import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { HIVE_STATE } from "src/app/shared/tokens/i-hive-store.token"

@Injectable({ providedIn: "root" })
export class FirstOpfsNameResolver extends HiveLoaderBase {
    private readonly hivestate = inject(HIVE_STATE)
    private readonly query = inject(QUERY_HIVE_SVC)
    public override type = HiveResolutionType.Opfs

    public override enabled = async (hiveName: string): Promise<boolean> => {
        this.logResolution(`FirstOpfsNameResolver enabled for ${hiveName}`)
        const hive = await this.query.fetchHive()
        const first = this.hivestate.first()

        // Enable only if there is no hive yet (first load)
        return !hive && !!first
    }

    public override async resolve(hiveName: string): Promise<HiveScout | null> {
        this.logResolution(`FirstOpfsNameResolver resolving ${hiveName}`)
        return HiveScout.firstOpfsHive(hiveName)
    }
}

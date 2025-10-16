import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { HiveLoaderBase } from "./hive-loader.base"

@Injectable({ providedIn: 'root' })
export class LiveDbNameResolver extends HiveLoaderBase {
    private readonly query = inject(QUERY_HIVE_SVC)

    public readonly type = HiveResolutionType.LiveDb

    public override enabled = async (hiveName: string): Promise<boolean> => {
        this.debug.log('name-resolution', `LiveDbNameResolver enabled for ${hiveName}`)
        const hive = await this.query.fetchHive()!
        const live = !!hive && hiveName === hive.hive
        this.debug.log('name-resolution', `LiveDbNameResolver enabled result for ${hiveName}: ${live}`)
        return !!hive && hiveName === hive.hive
    }

    public override async resolve(hiveName: string): Promise<HiveScout> {
        this.debug.log('name-resolution', `LiveDbNameResolver resolving ${hiveName}`)
        // create a scout for the live db hive
        const cell = await this.query.fetchHive()!
        const scout = HiveScout.liveDb(cell!.hive)
        this.debug.log('name-resolution', `LiveDbNameResolver resolved ${hiveName}`)
        return scout
    }

}

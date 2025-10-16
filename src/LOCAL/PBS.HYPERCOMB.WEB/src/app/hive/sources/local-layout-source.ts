import { Injectable } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { LayoutSourceBase } from "./layout-source-base"

@Injectable({ providedIn: 'root' })
export class LocalLayoutSource extends LayoutSourceBase {

    public getTiles = async (state): Promise<Cell[]> => {

        // // break out if at the root // if (id == this.layout.baseId) return
        // const current = this.stack.current()!

        // // get the local data.
        // const { Hive: hiveName, TileId: sourceId } = current
        // const data = await this.tile_queries.fetchByHiveIdentifier(hiveName, sourceId!)
        // return data.filter(d => !d.isHive)
        
        throw new Error('Method not implemented.')
    }

    public canLayout = async (): Promise<boolean> => {
        // const { sourceKey } = this.ls
        // // break out if at the root // if (id == this.layout.baseId) return
        // const context = this.cs.HiveId
        // const key = context || sourceKey
        // // return !!key && !this.state.hasMode(HypercombMode.ViewingClipboard)
        // return !!key
        throw new Error('Method not implemented.')
    }
}



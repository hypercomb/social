// src/app/inversion-of-control/factory/hive-factory.ts
// changes: do not override create(); add createHive(); delegate map/unmap to base

import { Injectable } from "@angular/core"
import { IEntityFactoryPort } from "../inversion-of-control/ports/i-entity-factory-port"
import { CellEntity } from "../database/model/i-tile-entity"
import { CellFactory } from "../inversion-of-control/factory/cell-factory"
import { Hive } from "../cells/cell"

@Injectable({ providedIn: "root" })
export class HiveFactory extends CellFactory implements IEntityFactoryPort<CellEntity, Hive> {

    // domain → persistence: delegate then force hive flag
    public override unmap = (domain: Hive): CellEntity => {
        const entity = super.unmap(domain)
        return { ...entity }
    }
}

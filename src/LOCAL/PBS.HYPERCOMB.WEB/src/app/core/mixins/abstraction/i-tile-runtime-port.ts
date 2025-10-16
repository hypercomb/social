// ports/i-tile-runtime-port.ts

import { Injectable } from "@angular/core"
import { DataServiceBase } from "src/app/actions/service-base-classes"

export abstract class TileRuntimePort extends DataServiceBase {
  abstract getHashCode(uniqueId: string): string
}

@Injectable({ providedIn: 'root' })
export class TileRuntimeAdapter extends TileRuntimePort {

  public override getHashCode(uniqueId: string): string {
    return this.service.getHashCode(uniqueId).toString()
  }
}



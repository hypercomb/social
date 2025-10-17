// ports/i-tile-runtime-port.ts

import { Injectable } from "@angular/core"
import { HypercombData } from "src/app/actions/hypercomb-data"

export abstract class TileRuntimePort extends HypercombData {
  abstract getHashCode(uniqueId: string): string
}

@Injectable({ providedIn: 'root' })
export class TileRuntimeAdapter extends TileRuntimePort {

  public override getHashCode(uniqueId: string): string {
    return this.service.getHashCode(uniqueId).toString()
  }
}



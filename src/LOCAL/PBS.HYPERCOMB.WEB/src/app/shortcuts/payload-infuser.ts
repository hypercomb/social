import { inject, Injectable } from "@angular/core";
import { Tile } from "../cells/models/tile";
import { HONEYCOMB_STORE } from "../shared/tokens/i-honeycomb-store.token";
import { PayloadBase } from "../actions/action-contexts";
import { Cell } from "../models/cell";

@Injectable({ providedIn: 'root' })
export class PayloadInfuser { 
    private readonly store = inject(HONEYCOMB_STORE)

    public infuse(payload: PayloadBase, context?: Tile | Cell){
        if(context instanceof Tile){
            (<any>payload).cell = this.store.lookupData(context.cellId)
        }
        else if(context instanceof Cell){
            (<any>payload).cell = context
        }
    }
}
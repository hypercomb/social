import { inject, Injectable } from "@angular/core";
import { Cell } from "../cells/cell";
import { Tile } from "../cells/models/tile";
import { COMB_STORE } from "../shared/tokens/i-comb-store.token";
import { BaseContext } from "../actions/action-contexts";

@Injectable({ providedIn: 'root' })
export class PayloadInfuser { 
    private readonly store = inject(COMB_STORE)

    public infuse(payload: BaseContext, context?: Tile | Cell){
        if(context instanceof Tile){
            (<any>payload).cell = this.store.lookupData(context.cellId)
        }
        else if(context instanceof Cell){
            (<any>payload).cell = context
        }
    }
}
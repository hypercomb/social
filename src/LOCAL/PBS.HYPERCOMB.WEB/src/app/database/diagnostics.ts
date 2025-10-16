import { Injectable, Injector } from '@angular/core'
import { DataServiceBase } from './pixi-data-service-base'

@Injectable({
    providedIn: 'root'
})
export class Diagnostics extends DataServiceBase {
    constructor(injector: Injector) {
        super(injector)
    }

    public run = async () => {
        // const data = await this.tile_queries.fetchByHiveIdentifier("news")
    }
}


import { Injectable, Injector } from '@angular/core'
import { HypercombData } from './pixi-data-service-base'

@Injectable({
    providedIn: 'root'
})
export class Diagnostics extends HypercombData {
    constructor(injector: Injector) {
        super(injector)
    }

    public run = async () => {
        // const data = await this.tile_queries.fetchByHiveIdentifier("news")
    }
}


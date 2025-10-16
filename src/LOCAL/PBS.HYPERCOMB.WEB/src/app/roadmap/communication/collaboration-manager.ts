import { Injectable, Type, Injector } from "@angular/core"
import { HandleHiveSynchronization } from "./handlers/handle-hive-synchronization"
import { HandleStartCollaboration } from "./handlers/handle-start-collaboration"
import { HandleTileUpdate } from "./handlers/handle-tile-update"

@Injectable({
    providedIn: 'root'
})
export class CollaborationManager {
    protected get HandleHiveSynchronization(): HandleHiveSynchronization { return this.injector.get<HandleHiveSynchronization>(HandleHiveSynchronization as Type<HandleHiveSynchronization>) }
    public get HandleStartCollaboration(): HandleStartCollaboration { return this.injector.get<HandleStartCollaboration>(HandleStartCollaboration as Type<HandleStartCollaboration>) }
    protected get HandleTileUpdate(): HandleTileUpdate { return this.injector.get<HandleTileUpdate>(HandleTileUpdate as Type<HandleTileUpdate>) }
    

    constructor(private injector: Injector) {
        this.HandleTileUpdate.register()
        this.HandleStartCollaboration.register()
        this.HandleHiveSynchronization.register()
    }
}



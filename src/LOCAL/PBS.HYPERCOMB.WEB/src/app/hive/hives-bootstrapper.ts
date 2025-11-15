import { Injectable, inject } from "@angular/core"
import { HIVE_CONTROLLER_ST } from "../shared/tokens/i-hive-store.token"
import { OpfsHiveService } from "./storage/opfs-hive-service"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"

@Injectable({ providedIn: 'root' })
export class HiveBootstrapService extends Hypercomb {

    private readonly opfs = inject(OpfsHiveService)
    private readonly controller = inject(HIVE_CONTROLLER_ST)
    private initialized = false

    public async initOnce(): Promise<void> {
        if (this.initialized) return
        this.initialized = true
        const hives = await this.opfs.listHives()
        this.controller.hydrate(hives)
    }
}

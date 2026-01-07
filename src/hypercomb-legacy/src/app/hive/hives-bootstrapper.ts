import { Injectable, inject } from "@angular/core"
import { HIVE_CONTROLLER_ST } from "../shared/tokens/i-hive-store.token"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"
import { HiveService } from "../core/hive/hive-service"

@Injectable({ providedIn: 'root' })
export class HiveBootstrapService extends Hypercomb {

    private readonly hivesvc = inject(HiveService)
    private readonly controller = inject(HIVE_CONTROLLER_ST)
    private initialized = false

    public async initOnce(): Promise<void> {
        if (this.initialized) return
        this.initialized = true
        const hives = await this.hivesvc.list()
        this.controller.hydrate(hives)
    }
}

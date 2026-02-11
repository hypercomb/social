import { inject } from "@angular/core"
import { Store } from "../app/core/store"
import { Drone } from "@hypercomb/core"

export class OpfsImporter {

    public readonly store = inject(Store)
    
    public import = async (): Promise<Drone | null> => {
        const manifest = await this.store.getDevManifest()
        if (!manifest) return null
         
    }
}
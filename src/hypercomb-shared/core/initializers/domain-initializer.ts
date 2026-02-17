import { inject, Injectable } from "@angular/core"
import { DevInitializer } from "./dev-initializer.service"
import { ServerInitializer } from "./server-initializer.service"
import { DevManifest } from "../store"

export interface IDomainInitializer {
    enabled: (input: string) => Promise<boolean>
    initialize: (input: string) => Promise<void>
}
@Injectable({ providedIn: 'root' })
export class DomainInitializer {

    public initializers: IDomainInitializer[] = [inject(DevInitializer), inject(ServerInitializer)]
    public initialize = async (manifest: DevManifest): Promise<void> => {
        const domain =  manifest.domains
        const input = `${domain}/__layers__/${manifest.root}`

        for (const instance of this.initializers) {
            if (await instance.enabled(input)) {
                await instance.initialize(input)
                return
            }
        }
    }
}